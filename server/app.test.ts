import { describe, expect, it } from 'vitest'
import { openDb } from './db.ts'
import { Repo } from './repo.ts'
import { createApp } from './app.ts'

const H = { 'x-zendo': '1', host: '127.0.0.1:5174', 'content-type': 'application/json' }

describe('API', () => {
  const app = createApp({ repo: new Repo(openDb(':memory:')) })
  it('rejects requests without the Zendo header or from foreign origins', async () => {
    expect((await app.request('/api/state', { headers: { host: '127.0.0.1:5174' } })).status).toBe(403)
    expect((await app.request('/api/state', { headers: { ...H, origin: 'https://evil.example' } })).status).toBe(403)
    expect((await app.request('/api/state', { headers: { ...H, host: 'zendo.example.com' } })).status).toBe(403)
    expect((await app.request('/api/health')).status).toBe(200)
  })
  it('round-trips state and changes', async () => {
    const empty = await (await app.request('/api/state', { headers: H })).json()
    expect(empty.initialized).toBe(false)
    const put = await app.request('/api/state', { method: 'PUT', headers: H, body: JSON.stringify({ version: 4, inbox: [], projects: [], tasks: [{ id: 't', title: 'x' }], events: [], blocks: [], reviews: [] }) })
    expect(put.status).toBe(200)
    const post = await app.request('/api/changes', { method: 'POST', headers: H, body: JSON.stringify({ upserts: { tasks: [{ id: 'u', title: 'y' }] }, deletes: { tasks: ['t'] } }) })
    expect((await post.json()).upserted).toBe(1)
    const state = await (await app.request('/api/state', { headers: H })).json()
    expect(state.initialized).toBe(true)
    expect(state.tasks).toEqual([{ id: 'u', title: 'y' }])
    const bad = await app.request('/api/changes', { method: 'POST', headers: H, body: JSON.stringify({ upserts: { tasks: [{ nope: 1 }] } }) })
    expect(bad.status).toBe(400)
    const capture = await app.request('/api/inbox', { method: 'POST', headers: H, body: JSON.stringify({ text: 'from curl' }) })
    expect(capture.status).toBe(201)
    expect((await (await app.request('/api/state', { headers: H })).json()).inbox[0].text).toBe('from curl')
  })
  it('answers 503 not_configured for the calendar when no app registration exists', async () => {
    const { calendarRoutes } = await import('./calendar.ts')
    const withCal = createApp({ repo: new Repo(openDb(':memory:')), calendar: calendarRoutes({ timezone: 'UTC', dataDir: '/tmp' }) })
    const res = await withCal.request('/api/calendar/status', { headers: H })
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe('not_configured')
  })
})
