import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '@/domain/types'

// Plain Node: fake browser storage and window timers, and a fake Zendo server behind fetch.
const mem = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size
  },
})
vi.stubGlobal('window', { setTimeout, clearTimeout, addEventListener: () => {}, removeEventListener: () => {} })

type Mode = 'ok' | 'login' | 'hold' | 'holdGet' | 'holdPut'
const server = {
  tasks: [] as { id: string; title: string }[],
  changedAt: '2026-10-20T00:00:00.000Z',
  mode: 'ok' as Mode,
  posts: 0,
  puts: 0,
  release: null as null | ((r: Response) => void),
}
/** A write by somebody else (an agent, the calendar job, another device). */
const outsideWrite = (t: { id: string; title: string }) => {
  server.tasks = [...server.tasks.filter((x) => x.id !== t.id), t]
  server.changedAt = new Date(Date.parse(server.changedAt) + 1000).toISOString()
}
const hold = () => new Promise<Response>((resolve) => (server.release = resolve))
const state = () => ({ version: 4, initialized: true, changedAt: server.changedAt, inbox: [], projects: [], tasks: server.tasks, events: [], blocks: [], reviews: [], settings: null })
vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
  if (server.mode === 'login') return new Response(JSON.stringify({ error: 'login_required' }), { status: 401 })
  if (url === '/api/state' && !init?.method) {
    const snap = state() // taken when the request arrives, answered when released
    if (server.mode === 'holdGet') return hold().then(() => Response.json(snap))
    return Response.json(snap)
  }
  if (url === '/api/state' && init?.method === 'PUT') {
    const body = String(init.body)
    const apply = () => {
      server.tasks = (JSON.parse(body) as { tasks: { id: string; title: string }[] }).tasks.map(({ id, title }) => ({ id, title }))
      server.puts += 1
      server.changedAt = new Date(Date.parse(server.changedAt) + 1000).toISOString()
      return Response.json({ ok: true, changedAt: server.changedAt })
    }
    if (server.mode === 'holdPut') return hold().then(apply)
    return apply()
  }
  if (url === '/api/changes' && init?.method === 'POST') {
    if (server.mode === 'hold') return hold()
    const previousChangedAt = server.changedAt
    const ch = JSON.parse(String(init.body)) as { upserts?: { tasks?: { id: string; title: string }[] }; deletes?: { tasks?: string[] } }
    for (const t of ch.upserts?.tasks ?? []) server.tasks = [...server.tasks.filter((x) => x.id !== t.id), t]
    for (const id of ch.deletes?.tasks ?? []) server.tasks = server.tasks.filter((x) => x.id !== id)
    server.posts += 1
    server.changedAt = new Date(Date.parse(server.changedAt) + 1000).toISOString()
    return Response.json({ ok: true, changedAt: server.changedAt, previousChangedAt })
  }
  return new Response('{}', { status: 404 })
})

let mod: typeof import('./server')
let useStore: typeof import('@/store/useStore').useStore
let useSync: typeof import('@/store/useSync').useSync
beforeAll(async () => {
  mod = await import('./server')
  useStore = (await import('@/store/useStore')).useStore
  useSync = (await import('@/store/useSync')).useSync
})
beforeEach(() => {
  useSync.setState({ status: 'connecting', pending: 0, message: undefined })
  server.mode = 'ok'
  server.release = null
})

const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort()
const addTask = (id: string, title: string) => useStore.setState((s) => ({ tasks: [...s.tasks.filter((t) => t.id !== id), { id, title } as Task] }))
const pending = () => mod.readPending(localStorage.getItem(mod.PENDING_CHANGES))

describe('pending changes', () => {
  it('sends changes left over from before a reload, then takes the server state', async () => {
    useStore.getState().clearAll()
    server.tasks = [{ id: 't1', title: 'on the server' }]
    localStorage.setItem(mod.FLAG_SYNCED, '1')
    localStorage.setItem(mod.PENDING_CHANGES, JSON.stringify({ upserts: { tasks: [{ id: 't2', title: 'made offline' }] }, deletes: {} }))
    const stop = mod.startSync()
    await vi.waitFor(() => expect(useSync.getState().status).toBe('online'))
    stop()
    expect(ids(server.tasks)).toEqual(['t1', 't2'])
    expect(ids(useStore.getState().tasks)).toEqual(['t1', 't2'])
    expect(localStorage.getItem(mod.PENDING_CHANGES)).toBeNull()
  })

  it('keeps changes made after the sign-in expired and sends them after signing in again', async () => {
    const stop = mod.startSync()
    await vi.waitFor(() => expect(useSync.getState().status).toBe('online'))
    server.mode = 'login'
    addTask('t3', 'after expiry')
    await vi.waitFor(() => expect(useSync.getState().status).toBe('signin'), { timeout: 3000 })
    stop()
    expect(ids(pending().upserts.tasks ?? [])).toEqual(['t3'])

    // "Sign in again" reloads the page: a new sync session with the stored changes.
    server.mode = 'ok'
    useSync.setState({ status: 'connecting' })
    const stop2 = mod.startSync()
    await vi.waitFor(() => expect(useSync.getState().status).toBe('online'))
    stop2()
    expect(ids(server.tasks)).toContain('t3')
    expect(localStorage.getItem(mod.PENDING_CHANGES)).toBeNull()
  })

  it('never lets a failed send overwrite a newer edit of the same record', async () => {
    const stop = mod.startSync()
    await vi.waitFor(() => expect(useSync.getState().status).toBe('online'))
    server.mode = 'hold'
    addTask('t4', 'first version')
    await vi.waitFor(() => expect(server.release).not.toBeNull(), { timeout: 3000 })
    expect(pending().upserts.tasks).toEqual([{ id: 't4', title: 'first version' }]) // in flight, still stored
    addTask('t4', 'second version')
    server.release!(new Response('{}', { status: 503 }))
    await vi.waitFor(() => expect(useSync.getState().status).toBe('offline'))
    stop()
    expect(pending().upserts.tasks).toEqual([{ id: 't4', title: 'second version' }])
    server.release = null
  })

  it('ignores malformed stored entries', () => {
    expect(mod.readPending(null)).toEqual({ upserts: {}, deletes: {} })
    expect(mod.readPending('{"upserts":{"tasks":[{"id":"a"},{"nope":1},null],"bogus":[1]},"deletes":{"tasks":["x",3]}}')).toEqual({ upserts: { tasks: [{ id: 'a' }] }, deletes: { tasks: ['x'] } })
    expect(mod.readPending('not json')).toEqual({ upserts: {}, deletes: {} })
    expect(mod.readPending(null)).toEqual({ upserts: {}, deletes: {} })
  })
})

describe('writes from elsewhere', () => {
  const titles = () => Object.fromEntries(useStore.getState().tasks.map((t) => [t.id, t.title]))
  const online = async () => {
    useStore.getState().clearAll()
    server.tasks = [{ id: 'w1', title: 'start' }]
    localStorage.removeItem(mod.PENDING_CHANGES)
    localStorage.setItem(mod.FLAG_SYNCED, '1')
    const stop = mod.startSync()
    await vi.waitFor(() => expect(useSync.getState().status).toBe('online'))
    return stop
  }

  it('pulls an outside write that landed before an own edit', async () => {
    const stop = await online()
    outsideWrite({ id: 'w2', title: 'by an agent' })
    addTask('w3', 'mine')
    await vi.waitFor(() => expect(titles()).toEqual({ w1: 'start', w2: 'by an agent', w3: 'mine' }), { timeout: 3000 })
    stop()
  })

  it('refreshNow sends queued changes first, then pulls', async () => {
    const stop = await online()
    outsideWrite({ id: 'w4', title: 'calendar job' })
    addTask('w5', 'queued') // still in the debounce when the pull is asked for
    await mod.refreshNow()
    expect(titles()).toMatchObject({ w4: 'calendar job', w5: 'queued' })
    expect(ids(server.tasks)).toContain('w5')
    stop()
  })

  it('keeps an edit made while a pull is on its way', async () => {
    const stop = await online()
    outsideWrite({ id: 'w6', title: 'outside' })
    server.mode = 'holdGet'
    const pull = mod.refreshNow()
    await vi.waitFor(() => expect(server.release).not.toBeNull())
    addTask('w1', 'edited during the pull')
    server.mode = 'ok'
    server.release!(new Response())
    await pull
    expect(titles().w1).toBe('edited during the pull')
    await vi.waitFor(() => expect(server.tasks.find((t) => t.id === 'w1')?.title).toBe('edited during the pull'), { timeout: 3000 })
    await vi.waitFor(() => expect(titles()).toMatchObject({ w1: 'edited during the pull', w6: 'outside' }), { timeout: 3000 })
    stop()
  })

  it('sends an edit made while an import uploads', async () => {
    const stop = await online()
    server.mode = 'holdPut'
    const snap = { ...useStore.getState().exportData(), tasks: [{ id: 'i1', title: 'imported' } as Task] }
    useStore.getState().importData(snap)
    await vi.waitFor(() => expect(server.release).not.toBeNull())
    addTask('i2', 'during the upload')
    server.mode = 'ok'
    server.release!(new Response())
    await vi.waitFor(() => expect(ids(server.tasks)).toEqual(['i1', 'i2']), { timeout: 3000 })
    await mod.refreshNow()
    expect(ids(useStore.getState().tasks)).toEqual(['i1', 'i2'])
    expect(localStorage.getItem(mod.FULL_PUSH)).toBeNull()
    stop()
  })
})

describe('first contact', () => {
  it('asks when the same records hold different content', async () => {
    useStore.getState().clearAll()
    localStorage.removeItem(mod.FLAG_SYNCED)
    localStorage.removeItem(mod.FLAG_FRESH)
    localStorage.removeItem(mod.PRE_SYNC_BACKUP)
    server.tasks = [{ id: 'c1', title: 'server title' }]
    addTask('c1', 'browser title')
    const stop = mod.startSync()
    await vi.waitFor(() => expect(useSync.getState().status).toBe('conflict'))
    expect(localStorage.getItem(mod.PRE_SYNC_BACKUP)).toContain('browser title')
    await mod.resolveConflict('server')
    stop()
    expect(useStore.getState().tasks.map((t) => t.title)).toEqual(['server title'])
  })
})

describe('helpers', () => {
  it('overlay puts unconfirmed changes on top of server records', () => {
    const server = [{ id: 'a', v: 1 }, { id: 'b', v: 1 }, { id: 'c', v: 1 }]
    const out = mod.overlay(server, new Map([['b', { id: 'b', v: 2 }], ['d', { id: 'd', v: 1 }]]), new Set(['c']))
    expect(out).toEqual([{ id: 'a', v: 1 }, { id: 'b', v: 2 }, { id: 'd', v: 1 }])
    expect(mod.overlay(server, undefined, undefined)).toBe(server)
  })
  it('sameContent ignores key order and record order, not values', () => {
    const base = { inbox: [], projects: [], events: [], blocks: [], reviews: [] }
    const a = { ...base, tasks: [{ id: 'x', title: 't', status: 'next' }, { id: 'y', title: 'u' }] } as never
    const b = { ...base, tasks: [{ id: 'y', title: 'u' }, { status: 'next', title: 't', id: 'x' }] } as never
    const c = { ...base, tasks: [{ id: 'y', title: 'u' }, { id: 'x', title: 't', status: 'done' }] } as never
    expect(mod.sameContent(a, b)).toBe(true)
    expect(mod.sameContent(a, c)).toBe(false)
  })
})
