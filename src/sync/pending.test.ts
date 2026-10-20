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

type Mode = 'ok' | 'login' | 'hold'
const server = {
  tasks: [] as { id: string; title: string }[],
  changedAt: '2026-10-20T00:00:00.000Z',
  mode: 'ok' as Mode,
  posts: 0,
  release: null as null | ((r: Response) => void),
}
const state = () => ({ version: 4, initialized: true, changedAt: server.changedAt, inbox: [], projects: [], tasks: server.tasks, events: [], blocks: [], reviews: [], settings: null })
vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
  if (server.mode === 'login') return new Response(JSON.stringify({ error: 'login_required' }), { status: 401 })
  if (url === '/api/state' && !init?.method) return Response.json(state())
  if (url === '/api/changes' && init?.method === 'POST') {
    if (server.mode === 'hold') return new Promise<Response>((resolve) => (server.release = resolve))
    const ch = JSON.parse(String(init.body)) as { upserts?: { tasks?: { id: string; title: string }[] }; deletes?: { tasks?: string[] } }
    for (const t of ch.upserts?.tasks ?? []) server.tasks = [...server.tasks.filter((x) => x.id !== t.id), t]
    for (const id of ch.deletes?.tasks ?? []) server.tasks = server.tasks.filter((x) => x.id !== id)
    server.posts += 1
    server.changedAt = new Date(Date.parse(server.changedAt) + 1000).toISOString()
    return Response.json({ ok: true, changedAt: server.changedAt })
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
    expect(mod.readPending('{"upserts":{"tasks":[{"id":"a"},{"nope":1},null],"bogus":[1]},"deletes":{"tasks":["x",3]}}')).toEqual({ upserts: { tasks: [{ id: 'a' }] }, deletes: { tasks: ['x'] } })
    expect(mod.readPending('not json')).toEqual({ upserts: {}, deletes: {} })
    expect(mod.readPending(null)).toEqual({ upserts: {}, deletes: {} })
  })
})
