import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
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
  it('accepts the configured public URL when hosted behind a proxy', async () => {
    const hosted = createApp({ repo: new Repo(openDb(':memory:')), publicUrl: new URL('https://zendo.example.com') })
    const pub = { ...H, host: 'zendo.example.com', origin: 'https://zendo.example.com' }
    expect((await hosted.request('/api/state', { headers: pub })).status).toBe(200)
    expect((await hosted.request('/api/state', { headers: { ...pub, origin: 'https://evil.example' } })).status).toBe(403)
    expect((await hosted.request('/api/state', { headers: { ...pub, origin: 'http://zendo.example.com' } })).status).toBe(403)
    expect((await hosted.request('/api/state', { headers: { ...pub, host: 'other.example.com' } })).status).toBe(403)
    expect((await hosted.request('/api/state', { headers: { ...pub, 'x-zendo': '' } })).status).toBe(403)
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
    const { calendarService } = await import('./calendar.ts')
    const repo = new Repo(openDb(':memory:'))
    const withCal = createApp({ repo, calendar: calendarService({ timezone: 'UTC', dataDir: '/tmp' }, repo).routes })
    const res = await withCal.request('/api/calendar/status', { headers: H })
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe('not_configured')
  })
})

describe('UI files', () => {
  const dist = mkdtempSync(path.join(tmpdir(), 'zendo-dist-'))
  mkdirSync(path.join(dist, 'assets'))
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Zendo</title>')
  writeFileSync(path.join(dist, 'assets', 'ai-NEW.js'), 'export {}')
  const app = createApp({ repo: new Repo(openDb(':memory:')), staticDir: dist })

  it('serves the page for app routes and existing assets as they are', async () => {
    expect(await (await app.request('/clarify')).text()).toContain('<title>Zendo')
    expect((await app.request('/assets/ai-NEW.js')).status).toBe(200)
  })

  it('answers 404 for an asset of an earlier build instead of the page', async () => {
    const res = await app.request('/assets/ai-OLD.js')
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).not.toContain('text/html')
  })
})
