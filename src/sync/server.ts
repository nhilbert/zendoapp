import type { CalendarEvent, InboxItem, PlanBlock, Project, Review, Settings, Task } from '@/domain/types'
import { useStore, type DataSnapshot } from '@/store/useStore'
import { useSync, type Counts, type Replaced } from '@/store/useSync'
import { looksLikeSample } from '@/domain/sample'
import { canonical } from '@/domain/merge'
import { withSingleNext } from '@/domain/taskRules'
import { NotConfigured, ServiceUnavailable, SignInRequired, api } from './api'

/**
 * Keeps the Zustand store and the local server in step.
 *  - On start: server state wins when the server has data; otherwise the local
 *    data (browser cache, sample or prototype data) is pushed as the initial state.
 *  - Afterwards every store change is diffed per collection and sent as
 *    upserts/deletes, debounced and merged, with retries while offline.
 *  - On window focus the state is refreshed when the server reports a change. Each send also says
 *    which stamp it replaced on the server: when that is not the state this browser holds, somebody
 *    else wrote in between (an agent, the calendar job, another device) and the state is pulled.
 *  - Pulled state never hides unconfirmed changes: they stay on top until the server has them.
 *  - Each changed record carries the version it started from (its base), so the server merges it with
 *    what changed there meanwhile (src/domain/merge.ts) instead of overwriting; what the merge decided
 *    against one side is kept in useSync.replaced until the user has looked at it.
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
/** The record as this browser knew it before its first unconfirmed edit (null = created here), and the time of the last edit. */
export interface Base {
  record: Identified | null
  editedAt: string
}
export interface Changes {
  upserts: Partial<Record<Col, Identified[]>>
  deletes: Partial<Record<Col, string[]>>
  settings?: Settings
  bases?: Partial<Record<Col, Record<string, Base>>>
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

/** The bases of a change: each changed or deleted record as it was before (prev), edited now. */
export function basesFor(prev: Collections, ch: Changes, editedAt: string): Changes['bases'] {
  const out: NonNullable<Changes['bases']> = {}
  for (const c of COLLECTIONS) {
    const ids = [...(ch.upserts[c] ?? []).map((r) => r.id), ...(ch.deletes[c] ?? [])]
    if (!ids.length) continue
    const before = new Map((prev[c] as Identified[]).map((r) => [r.id, r]))
    out[c] = Object.fromEntries(ids.map((id) => [id, { record: before.get(id) ?? null, editedAt }]))
  }
  return out
}

/** Pending changes merged per record: the latest upsert or delete of an id wins; its first base stays. */
interface Queue {
  upserts: Map<Col, Map<string, Identified>>
  deletes: Map<Col, Set<string>>
  bases: Map<Col, Map<string, Base>>
  settings?: Settings
}
const newQueue = (): Queue => ({ upserts: new Map(), deletes: new Map(), bases: new Map(), settings: undefined })
const countQueue = (q: Queue) => [...q.upserts.values()].reduce((n, m) => n + m.size, 0) + [...q.deletes.values()].reduce((n, s) => n + s.size, 0) + (q.settings ? 1 : 0)
function addToQueue(q: Queue, ch: Changes): void {
  for (const c of COLLECTIONS) {
    for (const item of ch.upserts?.[c] ?? []) {
      if (!q.upserts.has(c)) q.upserts.set(c, new Map())
      q.upserts.get(c)!.set(item.id, item)
      q.deletes.get(c)?.delete(item.id)
    }
    for (const id of ch.deletes?.[c] ?? []) {
      if (!q.deletes.has(c)) q.deletes.set(c, new Set())
      q.deletes.get(c)!.add(id)
      q.upserts.get(c)?.delete(id)
    }
  }
  for (const c of COLLECTIONS) {
    for (const [id, base] of Object.entries(ch.bases?.[c] ?? {})) {
      if (!q.bases.has(c)) q.bases.set(c, new Map())
      const known = q.bases.get(c)!.get(id)
      q.bases.get(c)!.set(id, known ? { record: known.record, editedAt: base.editedAt > known.editedAt ? base.editedAt : known.editedAt } : base)
    }
  }
  if (ch.settings) q.settings = ch.settings
}
function queueToChanges(q: Queue): Changes | null {
  if (!countQueue(q)) return null
  const out: Changes = { upserts: {}, deletes: {} }
  for (const [c, m] of q.upserts) if (m.size) out.upserts[c] = [...m.values()]
  for (const [c, s] of q.deletes) if (s.size) out.deletes[c] = [...s]
  for (const [c, m] of q.bases) {
    const queued = (id: string) => q.upserts.get(c)?.has(id) || q.deletes.get(c)?.has(id)
    const entries = [...m].filter(([id]) => queued(id))
    if (entries.length) (out.bases ??= {})[c] = Object.fromEntries(entries)
  }
  if (q.settings) out.settings = q.settings
  return out
}

/** Stored pending changes, keeping only well-formed entries (records with a string id, string ids to delete). */
export function readPending(raw: string | null): Changes {
  const out: Changes = { upserts: {}, deletes: {} }
  let saved: Partial<Changes> | null = null
  try {
    saved = raw ? (JSON.parse(raw) as Partial<Changes>) : null
  } catch {
    return out
  }
  if (!saved || typeof saved !== 'object') return out
  for (const c of COLLECTIONS) {
    const ups = saved.upserts?.[c]
    if (Array.isArray(ups)) {
      const ok = ups.filter((x): x is Identified => !!x && typeof x === 'object' && typeof (x as Identified).id === 'string')
      if (ok.length) out.upserts[c] = ok
    }
    const dels = saved.deletes?.[c]
    if (Array.isArray(dels)) {
      const ok = dels.filter((id): id is string => typeof id === 'string')
      if (ok.length) out.deletes[c] = ok
    }
  }
  if (saved.settings && typeof saved.settings === 'object') out.settings = saved.settings
  // Bases are an optimisation for the merge: a malformed one is dropped and that record simply overwrites.
  for (const c of COLLECTIONS) {
    const byId = saved.bases?.[c]
    if (!byId || typeof byId !== 'object') continue
    const ok = Object.entries(byId).filter(
      ([, b]) => !!b && typeof b === 'object' && typeof b.editedAt === 'string' && (b.record === null || (!!b.record && typeof b.record === 'object' && typeof b.record.id === 'string')),
    )
    if (ok.length) (out.bases ??= {})[c] = Object.fromEntries(ok)
  }
  return out
}

const RETRY_MS = [2000, 5000, 15000, 30000]
const DEBOUNCE_MS = 300
/** Set once this browser has agreed with the server; from then on the server wins on start. */
export const FLAG_SYNCED = 'zendo.synced'
/** Set when main.tsx seeded the sample on a fresh browser; such a store never counts as the user's data. */
export const FLAG_FRESH = 'zendo.fresh'
/** A copy of this browser's data taken before the first sync decision – downloadable from Settings. */
export const PRE_SYNC_BACKUP = 'zendo.pre-sync-backup'
/** Changes the server has not confirmed yet (offline, expired sign-in); kept across reloads and sent first on start. */
export const PENDING_CHANGES = 'zendo.pending-changes'
/** Set while an imported snapshot still has to replace the server's data; survives a reload. */
export const FULL_PUSH = 'zendo.full-push'

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

/** Do both hold the same records with the same content? Calendar events are left out: the server re-imports them. */
export function sameContent(a: Collections, b: Collections): boolean {
  const key = (xs: Identified[]) => canonical([...xs].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)))
  return (['projects', 'tasks', 'inbox', 'blocks', 'reviews'] as const).every((c) => key(a[c]) === key(b[c]))
}

/** The server's records with the unconfirmed changes on top (upserts replace or add, deletes remove). */
export function overlay<T extends Identified>(records: T[], upserts: Map<string, Identified> | undefined, deletes: Set<string> | undefined): T[] {
  if (!upserts?.size && !deletes?.size) return records
  const out = records.filter((r) => !deletes?.has(r.id)).map((r) => (upserts?.get(r.id) as T | undefined) ?? r)
  const known = new Set(records.map((r) => r.id))
  for (const [id, r] of upserts ?? []) if (!known.has(id)) out.push(r as T)
  return out
}

let resolver: ((choice: 'browser' | 'server') => Promise<void>) | null = null
/** Called by the conflict dialog. */
export const resolveConflict = (choice: 'browser' | 'server'): Promise<void> => resolver?.(choice) ?? Promise.resolve()

let refresher: (() => Promise<void>) | null = null
/** Pull the server state now if it changed (used after server-side jobs such as a calendar sync). */
export const refreshNow = (): Promise<void> => refresher?.() ?? Promise.resolve()

/** What merges decided against one side, until the user has looked at it (kept across reloads). */
export const REPLACED = 'zendo.replaced'
const MAX_REPLACED = 30
const saveReplaced = (list: Replaced[]) => {
  if (list.length) storage.set(REPLACED, JSON.stringify(list))
  else storage.remove(REPLACED)
  useSync.getState().set({ replaced: list })
}
function loadReplaced(): Replaced[] {
  try {
    const list = JSON.parse(storage.get(REPLACED) ?? '[]') as Replaced[]
    return Array.isArray(list) ? list.filter((r) => r && typeof r.id === 'string' && (COLLECTIONS as readonly string[]).includes(r.collection)) : []
  } catch {
    return []
  }
}
/** Newest first; a newer report on the same values of a record replaces the older one. */
function noteReplaced(incoming: Replaced[]): void {
  const key = (r: Replaced) => `${r.collection}:${r.id}:${r.kind}:${(r.fields ?? []).join(',')}`
  const fresh = new Set(incoming.map(key))
  saveReplaced([...incoming, ...useSync.getState().replaced.filter((r) => !fresh.has(key(r)))].slice(0, MAX_REPLACED))
}

/** "Fine": forget a report. */
export function dismissReplaced(r: Replaced): void {
  saveReplaced(useSync.getState().replaced.filter((x) => x !== r))
}

/** Undo a merge decision through the store, so it syncs like any edit: restore the replaced values, or delete the kept record. */
export function restoreReplaced(r: Replaced): void {
  const s = useStore.getState()
  if (r.kind === 'kept') {
    if (r.collection === 'inbox') s.removeInboxItem(r.id)
    else if (r.collection === 'projects') s.deleteProject(r.id)
    else if (r.collection === 'tasks') s.deleteTask(r.id)
    else if (r.collection === 'events') s.deleteEvent(r.id)
    else if (r.collection === 'blocks') s.removeBlock(r.id)
    else useStore.setState({ reviews: s.reviews.filter((x) => x.id !== r.id) })
  } else {
    const records = s[r.collection] as Identified[]
    const target = records.find((x) => x.id === r.id) as (Identified & Record<string, unknown>) | undefined
    if (target) {
      const next: Identified & Record<string, unknown> = { ...target }
      for (const f of r.fields ?? []) {
        const v = r.replaced?.[f]
        if (v === undefined) delete next[f]
        else next[f] = v
      }
      if ('updatedAt' in target) next.updatedAt = new Date().toISOString()
      let list = records.map((x) => (x.id === r.id ? next : x))
      if (r.collection === 'tasks' && next.status === 'next') {
        const task = next as unknown as Task
        list = withSingleNext(list as Task[], task.id, task.projectId)
      }
      useStore.setState({ [r.collection]: list } as Partial<Collections>)
    }
  }
  dismissReplaced(r)
}

export function startSync(): () => void {
  const sync = useSync.getState().set
  let applying = false // true while server state is written into the store (no echo back)
  let needsFullPush = !!storage.get(FULL_PUSH)
  let flushRun: Promise<void> | null = null // the send in progress
  let ready = false // the first-contact decision is made; until then nothing is sent
  let timer: number | undefined
  let retries = 0
  let lastChangedAt: string | null = null // the server stamp of the state this browser holds
  let pullWanted = false // somebody else wrote since: pull once the own changes are out
  let refreshRun: Promise<void> | null = null // the pull in progress
  let pullAgain = false // asked for while a pull ran: its state may predate the reason
  let writes = 0 // confirmed sends; a pull that overlaps one is discarded
  let stopped = false
  const queue = newQueue()
  let inflight: Changes | null = null // taken from the queue, sent, not yet confirmed

  const queued = () => countQueue(queue)

  /** Mirror of everything unconfirmed (in flight + queued) in browser storage, so a reload cannot lose it. */
  const persistPending = () => {
    const all = newQueue()
    if (inflight) addToQueue(all, inflight)
    const rest = queueToChanges(queue)
    if (rest) addToQueue(all, rest)
    const pending = queueToChanges(all)
    if (pending) storage.set(PENDING_CHANGES, JSON.stringify(pending))
    else storage.remove(PENDING_CHANGES)
  }

  const enqueue = (ch: Changes) => {
    addToQueue(queue, ch)
    persistPending()
    sync({ pending: queued() })
  }

  const clearQueue = () => {
    queue.upserts.clear()
    queue.deletes.clear()
    queue.bases.clear()
    queue.settings = undefined
    persistPending()
  }

  const takeQueue = (): Changes | null => {
    const out = queueToChanges(queue)
    queue.upserts.clear()
    queue.deletes.clear()
    queue.bases.clear()
    queue.settings = undefined
    return out
  }

  const applyServerState = (s: ServerState) => {
    // Unconfirmed changes (in flight or queued) are not in the server's state yet: keep them on top.
    const mine = newQueue()
    if (inflight) addToQueue(mine, inflight)
    const rest = queueToChanges(queue)
    if (rest) addToQueue(mine, rest)
    const top = <T extends Identified>(c: Col, records: T[]) => overlay(records, mine.upserts.get(c), mine.deletes.get(c))
    applying = true
    try {
      const current = useStore.getState()
      useStore.setState({
        inbox: top('inbox', s.inbox),
        projects: top('projects', s.projects),
        tasks: top('tasks', s.tasks),
        events: top('events', s.events),
        blocks: top('blocks', s.blocks),
        reviews: top('reviews', s.reviews),
        settings: mine.settings ?? s.settings ?? current.settings,
        seeded: true,
      })
    } finally {
      applying = false
    }
    lastChangedAt = s.changedAt
  }

  const snapshot = (): DataSnapshot => useStore.getState().exportData()

  const fail = (err: unknown) => {
    const current = useSync.getState().status
    const status =
      err instanceof SignInRequired
        ? 'signin'
        : err instanceof ServiceUnavailable || err instanceof NotConfigured
          ? current === 'online' || current === 'offline' || current === 'signin' ? 'offline' : 'local'
          : current
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

  /** Replaces the server's data with this browser's. Edits made while it uploads stay queued for afterwards. */
  const pushSnapshot = async () => {
    const snap = snapshot()
    clearQueue() // everything queued so far is in the snapshot
    const r = await api<{ changedAt: string }>('/api/state', { method: 'PUT', body: JSON.stringify(snap) })
    lastChangedAt = r.changedAt
    writes += 1
    needsFullPush = false
    storage.remove(FULL_PUSH)
  }

  /** One send at a time; a call while one runs joins it (anything queued meanwhile follows in its finally). */
  const flush = (): Promise<void> => {
    if (stopped || !ready) return Promise.resolve()
    flushRun ??= sendAll().finally(() => {
      flushRun = null
      if (stopped) return
      if ((queued() || needsFullPush) && retries === 0) schedule()
      else if (pullWanted && !refreshRun && !queued() && !needsFullPush) void refresh()
    })
    return flushRun
  }

  const sendAll = async (): Promise<void> => {
    try {
      if (needsFullPush) await pushSnapshot()
      const ch = takeQueue()
      if (ch) {
        inflight = ch
        try {
          const r = await api<{ changedAt: string; previousChangedAt?: string | null; adjusted?: number; replaced?: Replaced[] }>('/api/changes', {
            method: 'POST',
            body: JSON.stringify(ch),
          })
          // Only this send since the state we hold, stored as sent: still up to date. Otherwise pull what the others wrote.
          if (r.previousChangedAt === lastChangedAt && !r.adjusted) lastChangedAt = r.changedAt
          else pullWanted = true
          if (r.replaced?.length) noteReplaced(r.replaced)
          writes += 1
          inflight = null
          persistPending()
        } catch (err) {
          // Keep for the next attempt, behind anything changed meanwhile (newer edits of the same record win).
          const newer = takeQueue()
          addToQueue(queue, ch)
          if (newer) addToQueue(queue, newer)
          inflight = null
          persistPending()
          throw err
        }
      }
      retries = 0
      sync({ status: 'online', lastSync: new Date().toISOString(), pending: 0, message: undefined })
    } catch (err) {
      fail(err)
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
      const firstContact = !storage.get(FLAG_SYNCED) && localHasOwnData()
      // Whatever is decided, this browser's data is kept once before the first sync.
      if (firstContact && !storage.get(PRE_SYNC_BACKUP)) storage.set(PRE_SYNC_BACKUP, JSON.stringify(snapshot()))
      if (server.initialized) {
        if (firstContact && !sameContent(useStore.getState(), server)) {
          resolver = async (choice) => {
            resolver = null
            try {
              ready = true
              if (choice === 'browser') await pushSnapshot()
              else {
                // the user chose the server's data; this browser's unsent changes and import are dropped
                clearQueue()
                needsFullPush = false
                storage.remove(FULL_PUSH)
                applyServerState(await api<ServerState>('/api/state'))
              }
              agreed()
              retries = 0
              sync({ status: 'online', lastSync: new Date().toISOString(), pending: 0, message: undefined, conflict: undefined })
            } catch (err) {
              ready = false
              sync({ status: 'local', conflict: undefined, message: err instanceof Error ? err.message : String(err) })
              timer = window.setTimeout(() => void handshake(), 15000)
            }
          }
          sync({ status: 'conflict', conflict: { local: counts(useStore.getState()), server: counts(server) } })
          return
        }
        // Unsent changes (e.g. from before a reload) go out first; then the server state, which now includes them.
        ready = true
        const hadPending = queued() > 0 || needsFullPush
        if (hadPending) {
          await flush()
          if (queued() || needsFullPush) throw useSync.getState().status === 'signin' ? new SignInRequired() : new ServiceUnavailable()
        }
        applyServerState(hadPending ? await api<ServerState>('/api/state') : server)
      } else {
        ready = true
        await pushSnapshot()
      }
      agreed()
      retries = 0
      pullWanted = false
      sync({ status: 'online', lastSync: new Date().toISOString(), pending: queued(), message: undefined })
      if (queued() || needsFullPush) schedule() // edits made during the handshake
    } catch (err) {
      ready = false
      // A browser that has synced before (e.g. opened offline from the saved app) only waits for the server.
      const status = err instanceof SignInRequired ? 'signin' : err instanceof ServiceUnavailable && storage.get(FLAG_SYNCED) ? 'offline' : 'local'
      sync({ status, message: err instanceof Error ? err.message : String(err) })
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void handshake(), 15000)
    }
  }

  /** Pull the server state if it changed: own changes go out first, so the pulled state includes them. */
  const refresh = (): Promise<void> => {
    if (refreshRun) {
      pullAgain = true
      return refreshRun
    }
    refreshRun = pull().finally(() => (refreshRun = null))
    return refreshRun
  }

  const pull = async (): Promise<void> => {
    pullAgain = false
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        if (stopped || useSync.getState().status !== 'online') return
        if (flushRun || queued() || needsFullPush) {
          pullWanted = true
          await flush()
          continue
        }
        const before = writes
        pullWanted = false
        const server = await api<ServerState>('/api/state', { timeoutMs: 5000 })
        // A send confirmed meanwhile is not in this state, and an import must not be replaced by it: ask again.
        if (writes !== before || flushRun || needsFullPush) {
          pullWanted = true
          continue
        }
        if (server.initialized && server.changedAt !== lastChangedAt) applyServerState(server)
        if (!pullAgain) return
        pullAgain = false
      }
    } catch (err) {
      // An expired sign-in is shown right away (before the next edit); other problems surface with the next change.
      if (err instanceof SignInRequired) {
        sync({ status: 'signin', message: err.message })
        window.clearTimeout(timer)
        timer = window.setTimeout(() => void handshake(), 15000)
      }
    }
  }

  // Store subscription: diff every change into the queue.
  const unsubscribe = useStore.subscribe((next, prev) => {
    if (applying) return
    const ch = diffCollections(prev, next) ?? { upserts: {}, deletes: {} }
    if (prev.settings !== next.settings) ch.settings = next.settings
    if (!Object.keys(ch.upserts).length && !Object.keys(ch.deletes).length && !ch.settings) return
    ch.bases = basesFor(prev, ch, new Date().toISOString())
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
      storage.set(FULL_PUSH, '1')
      void flush()
    },
  })

  // Changes the server never confirmed before the last reload go out first (handshake → flush).
  addToQueue(queue, readPending(storage.get(PENDING_CHANGES)))
  sync({ pending: queued(), replaced: loadReplaced() })

  refresher = refresh
  const onFocus = () => void refresh()
  window.addEventListener('focus', onFocus)
  void handshake()

  return () => {
    stopped = true
    refresher = null
    unsubscribe()
    window.removeEventListener('focus', onFocus)
    window.clearTimeout(timer)
    useStore.setState({ importData: originalImport })
  }
}
