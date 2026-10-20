import { describe, expect, it } from 'vitest'
import { openDb } from './db.ts'
import { Repo } from './repo.ts'
import { createApp } from './app.ts'
import { aiRoutes, resolveAi } from './ai.ts'
import { parseClarifySuggestion } from '../src/ai/clarify.ts'

const H = { 'x-zendo': '1', host: '127.0.0.1:5174', 'content-type': 'application/json' }

describe('AI on the server', () => {
  it('resolves provider and model from the environment', () => {
    expect(resolveAi({})).toBeNull()
    expect(resolveAi({ anthropicKey: 'k' })).toMatchObject({ provider: 'anthropic', model: 'claude-opus-5-5' })
    expect(resolveAi({ openaiKey: 'k' })).toMatchObject({ provider: 'openai', model: 'gpt-5' })
    expect(resolveAi({ anthropicKey: 'a', openaiKey: 'o', provider: 'openai', model: 'x' })).toMatchObject({ provider: 'openai', model: 'x' })
    expect(resolveAi({ provider: 'anthropic' })).toBeNull()
  })
  it('answers 503 without a key and builds the prompt from the database', async () => {
    const repo = new Repo(openDb(':memory:'))
    repo.applyChanges({
      upserts: {
        projects: [
          { id: 'a', name: 'Strategy', status: 'active' },
          { id: 'b', name: 'Keynote', status: 'planned' },
          { id: 'c', name: 'Old', status: 'archived' },
        ],
      },
    })
    const off = createApp({ repo, ai: aiRoutes(repo, null) })
    expect((await off.request('/api/ai/clarify', { method: 'POST', headers: H, body: JSON.stringify({ text: 'x' }) })).status).toBe(503)
    expect(await (await off.request('/api/ai/status', { headers: H })).json()).toEqual({ configured: false, provider: null, model: null })

    let seenUser = ''
    const fake = { provider: 'anthropic' as const, model: 'test', complete: async (_s: string, u: string) => ((seenUser = u), '{"kind":"task","title":"Call Jana","projectName":"Strategy","estimateMinutes":30,"priority":"high","dueDate":"2026-10-30"}') }
    const on = createApp({ repo, ai: aiRoutes(repo, fake) })
    const res = await on.request('/api/ai/clarify', { method: 'POST', headers: H, body: JSON.stringify({ text: 'Jana anrufen', locale: 'de' }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ kind: 'task', title: 'Call Jana', projectName: 'Strategy', estimateMinutes: 30, priority: 'high', dueDate: '2026-10-30' })
    expect(seenUser).toContain('"Strategy"')
    expect(seenUser).toContain('"Keynote"')
    expect(seenUser).not.toContain('Old')
    expect(seenUser).toContain('Jana anrufen')
    expect((await on.request('/api/ai/clarify', { method: 'POST', headers: H, body: JSON.stringify({}) })).status).toBe(400)
  })
  it('parses fenced or sloppy model output defensively', () => {
    const s = parseClarifySuggestion('```json\n{"kind":"bogus","title":" T ","priority":"urgent","dueDate":"next week","estimateMinutes":-5}\n```')
    expect(s).toMatchObject({ kind: 'task', title: 'T', priority: null, dueDate: null, estimateMinutes: null })
    expect(() => parseClarifySuggestion('no json here')).toThrow()
  })
})
