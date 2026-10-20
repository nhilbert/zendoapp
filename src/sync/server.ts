import type { CalendarEvent, InboxItem, PlanBlock, Project, Review, Settings, Task } from '@/domain/types'
import { useStore, type DataSnapshot } from '@/store/useStore'
import { useSync, type Counts } from '@/store/useSync'
import { looksLikeSample } from '@/domain/sample'
import { NotConfigured, ServiceUnavailable, api } from './api'

/**
 * Keeps the Zustand store and the local server in step.
 *  - On start: server state wins when the server has data; otherwise the local
 *    data (browser cache, sample or prototype data) is pushed as the initial state.
 *  - Afterwards every store change is diffed per collection and sent as
 *    upserts/deletes, debounced and merged, with retries while offline.
 *  - On window focus the state is refreshed when the server reports a change.
 * The browser cache (zustand persist) stays as an offline fallback.
 */
export const COLLECTIONS = ['inbox', 'projects', 'tasks', 'events', 'blocks', 'reviews'] as const
type Col = (typeof COLLECTIONS)[number]
interface Identified {
  id: string
}
export interface Collections {
  inbox: InboxItem[]
  projects: Project[]
  tasks: Task[]
  events: CalendarEvent[]
  blocks: PlanBlock[]
  reviews: Review[]
}
export interface Changes {
  upserts: Partial<Record<Col, Identified[]>>
  deletes: Partial<Record<Col, string[]>>
  settings?: Settings
}
interface ServerState extends Collections {
  version: number
  settings: Settings | null
  initialized: boolean
  changedAt: string | null
}

/** Reference-based diff: records are immutable in the store, so a changed reference means a changed record. */
export function diffCollections(prev: Collections, next: Collections): Changes | null {
  const upserts: Changes['upserts'] = {}
  const deletes: Changes['deletes'] = {}
  let any = false
  for (const c of COLLECTIONS) {
    const a = prev[c] as Identified[]
    const b = next[c] as Identified[]
    if (a === b) continue
    const prevById = new Map(a.map((x) => [x.id, x]))
    const nextIds = new Set<string>()
    const ups: Identified[] = []
    for (const item of b) {
      nextIds.add(item.id)
      if (prevById.get(item.id) !== item) ups.push(item)
    }
    const dels = a.filter((x) => !nextIds.has(x.id)).map((x) => x.id)
    if (ups.length) {
      upserts[c] = ups
      any = true
    }
    if (dels.length) {
      deletes[c] = dels
      any = true
    }
  }
  return any ? { upserts, deletes } : null
}

const RETRY_MS = [2000, 5000, 15000, 30000]
const DEBOUNCE_MS = 300
/** Set once this browser has agreed with the server; from then on the server wins on start. */
export const FLAG_SYNCED = 'zendo.synced'
/** Set when main.tsx seeded the sample on a fresh browser; such a store never counts as the user's data. */
export const FLAG_FRESH = 'zendo.fresh'
/** A copy of this browser's data taken before the first sync decision – downloadable from Settings. */
export const PRE_SYNC_BACKUP = 'zendo.pre-sync-backup'

const storage = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v)
    } catch {
      /* ignore */
    }
  },
  remove: (k: string) => {
    try {
      localStorage.removeItem(k)
    } catch {
      /* ignore */
    }
  },
}

const counts = (s: { projects: unknown[]; tasks: unknown[]; inbox: unknown[] }): Counts => ({ projects: s.projects.length, tasks: s.tasks.length, inbox: s.inbox.length })

let resolver: ((choice: 'browser' | 'server') => Promise<void>) | null = null
/** Called by the conflict dialog. */
export const resolveConflict = (choice: 'browser' | 'server'): Promise<void> => resolver?.(choice) ?? Promise.resolve()

export function startSync(): () => void {
  const sync = useSync.getState().set
  let applying = false // true while server state is written into the store (no echo back)
  let needsFullPush = false
  let flushing = false
  let timer: number | undefined
  let retries = 0
  let lastChangedAt: string | null = null
  let stopped = false
  const queue = { upserts: new Map<Col, Map<string, Identified>>(), deletes: new Map<Col, Set<string>>(), settings: undefined as Settings | undefined }

  const queued = () => [...queue.upserts.values()].reduce((n, m) => n + m.size, 0) + [...queue.deletes.values()].reduce((n, s) => n + s.size, 0) + (queue.settings ? 1 : 0)

  const enqueue = (ch: Changes) => {
    for (const c of COLLECTIONS) {
      for (const item of ch.upserts[c] ?? []) {
        if (!queue.upserts.has(c)) queue.upserts.set(c, new Map())
        queue.upserts.get(c)!.set(item.id, item)
        queue.deletes.get(c)?.delete(item.id)
      }
      for (const id of ch.deletes[c] ?? []) {
        if (!queue.deletes.has(c)) queue.deletes.set(c, new Set())
        queue.deletes.get(c)!.add(id)
        queue.upserts.get(c)?.delete(id)
      }
    }
    if (ch.settings) queue.settings = ch.settings
    sync({ pending: queued() })
  }

  const takeQueue = (): Changes | null => {
    if (!queued()) return null
    const out: Changes = { upserts: {}, deletes: {} }
    for (const [c, m] of queue.upserts) if (m.size) out.upserts[c] = [...m.values()]
    for (const [c, s] of queue.deletes) if (s.size) out.deletes[c] = [...s]
    if (queue.settings) out.settings = queue.settings
    queue.upserts.clear()
    queue.deletes.clear()
    queue.settings = undefined
    return out
  }

  const applyServerState = (s: ServerState) => {
    applying = true
    try {
      const current = useStore.getState()
      useStore.setState({
        inbox: s.inbox,
        projects: s.projects,
        tasks: s.tasks,
        events: s.events,
        blocks: s.blocks,
        reviews: s.reviews,
        settings: s.settings ?? current.settings,
        seeded: true,
      })
    } finally {
      applying = false
    }
    lastChangedAt = s.changedAt
  }

  const snapshot = (): DataSnapshot => useStore.getState().exportData()

  const fail = (err: unknown) => {
    const status = err instanceof ServiceUnavailable || err instanceof NotConfigured ? (useSync.getState().status === 'online' || useSync.getState().status === 'offline' ? 'offline' : 'local') : useSync.getState().status
    sync({ status, message: err instanceof Error ? err.message : String(err), pending: queued() })
    scheduleRetry()
  }

  const scheduleRetry = () => {
    if (stopped) return
    const wait = RETRY_MS[Math.min(retries, RETRY_MS.length - 1)]
    retries += 1
    window.clearTimeout(timer)
    timer = window.setTimeout(() => void flush(), wait)
  }

  const flush = async (): Promise<void> => {
    if (stopped || flushing) return
    flushing = true
    try {
      if (needsFullPush) {
        await api('/api/state', { method: 'PUT', body: JSON.stringify(snapshot()) })
        needsFullPush = false
        queue.upserts.clear()
        queue.deletes.clear()
        queue.settings = undefined
      }
      const ch = takeQueue()
      if (ch) {
        try {
          const r = await api<{ changedAt: string }>('/api/changes', { method: 'POST', body: JSON.stringify(ch) })
          lastChangedAt = r.changedAt
        } catch (err) {
          enqueue(ch) // keep for the next attempt
          throw err
        }
      }
      retries = 0
      sync({ status: 'online', lastSync: new Date().toISOString(), pending: 0, message: undefined })
    } catch (err) {
      fail(err)
    } finally {
      flushing = false
      if (!stopped && queued() && retries === 0) schedule()
    }
  }

  const schedule = () => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => void flush(), DEBOUNCE_MS)
  }

  /** Does this browser hold data the user created (not an untouched sample, not a fresh seed)? */
  const localHasOwnData = (): boolean => {
    const s = useStore.getState()
    const records = s.projects.length + s.tasks.length + s.inbox.length + s.events.length + s.blocks.length
    if (!records) return false
    if (storage.get(FLAG_FRESH)) return false
    return !looksLikeSample(s.projects)
  }
  const sameIds = (server: ServerState): boolean => {
    const s = useStore.getState()
    const ids = (xs: Identified[]) => xs.map((x) => x.id).sort().join(',')
    return ids(s.projects) === ids(server.projects) && ids(s.tasks) === ids(server.tasks) && ids(s.inbox) === ids(server.inbox)
  }
  const pushLocal = async () => {
    await api('/api/state', { method: 'PUT', body: JSON.stringify(snapshot()) })
    queue.upserts.clear()
    queue.deletes.clear()
    queue.settings = undefined
    needsFullPush = false
  }
  const agreed = () => {
    storage.set(FLAG_SYNCED, '1')
    storage.remove(FLAG_FRESH)
  }

  /**
   * First contact. Server wins when it has data – except when this browser has never
   * synced before and holds its own data that differs: then a copy is kept and the
   * user decides (conflict dialog). An empty server receives what this browser has.
   */
  const handshake = async (): Promise<void> => {
    try {
      const server = await api<ServerState>('/api/state', { timeoutMs: 5000 })
      if (server.initialized) {
        if (!storage.get(FLAG_SYNCED) && localHasOwnData() && !sameIds(server)) {
          if (!storage.get(PRE_SYNC_BACKUP)) storage.set(PRE_SYNC_BACKUP, JSON.stringify(snapshot()))
          resolver = async (choice) => {
            resolver = null
            try {
              if (choice === 'browser') await pushLocal()
              else applyServerState(await api<ServerState>('/api/state'))
              agreed()
              retries = 0
              sync({ status: 'online', lastSync: new Date().toISOString(), pending: 0, message: undefined, conflict: undefined })
            } catch (err) {
              sync({ status: 'local', conflict: undefined, message: err instanceof Error ? err.message : String(err) })
              timer = window.setTimeout(() => void handshake(), 15000)
            }
          }
          sync({ status: 'conflict', conflict: { local: counts(useStore.getState()), server: counts(server) } })
          return
        }
        if (queued() || needsFullPush) await flush()
        const fresh = queued() ? await api<ServerState>('/api/state') : server
        applyServerState(fresh)
      } else {
        await pushLocal()
      }
      agreed()
      retries = 0
      sync({ status: 'online', lastSync: new Date().toISOString(), pending: queued(), message: undefined })
    } catch (err) {
      sync({ status: 'local', message: err instanceof Error ? err.message : String(err) })
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void handshake(), 15000)
    }
  }

  const refresh = async (): Promise<void> => {
    if (useSync.getState().status !== 'online' || queued() || flushing) return
    try {
      const server = await api<ServerState>('/api/state', { timeoutMs: 5000 })
      if (server.initialized && server.changedAt !== lastChangedAt) applyServerState(server)
    } catch {
      /* ignore – next change will surface the problem */
    }
  }

  // Store subscription: diff every change into the queue.
  const unsubscribe = useStore.subscribe((next, prev) => {
    if (applying) return
    const ch = diffCollections(prev, next) ?? { upserts: {}, deletes: {} }
    if (prev.settings !== next.settings) ch.settings = next.settings
    if (!Object.keys(ch.upserts).length && !Object.keys(ch.deletes).length && !ch.settings) return
    enqueue(ch)
    if (useSync.getState().status === 'online') schedule()
  })

  // A JSON import replaces everything: send the whole snapshot instead of a diff.
  const originalImport = useStore.getState().importData
  useStore.setState({
    importData: (snap) => {
      applying = true
      try {
        originalImport(snap)
      } finally {
        applying = false
      }
      needsFullPush = true
      void flush()
    },
  })

  const onFocus = () => void refresh()
  window.addEventListener('focus', onFocus)
  void handshake()

  return () => {
    stopped = true
    unsubscribe()
    window.removeEventListener('focus', onFocus)
    window.clearTimeout(timer)
    useStore.setState({ importData: originalImport })
  }
}
