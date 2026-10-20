import { describe, expect, it } from 'vitest'
import { openDb } from './db.ts'
import { Repo } from './repo.ts'
import { createApp } from './app.ts'
import { aiRoutes, resolveAi } from './ai.ts'
import { CLARIFY_SCHEMA, parseClarifySuggestion } from '../src/ai/clarify.ts'
import { WEEK_SCHEMA } from '../src/ai/week.ts'
import type { CompleteOptions } from './ai.ts'

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

describe('AI week proposal', () => {
  const setup = () => {
    const repo = new Repo(openDb(':memory:'))
    repo.applyChanges({
      upserts: {
        projects: [
          { id: 'a', name: 'Strategy', status: 'active', dueDate: '2026-10-28' },
          { id: 'h', name: 'Hidden hobby', status: 'active', private: true },
          { id: 'old', name: 'Old', status: 'archived' },
        ],
        tasks: [{ id: 't1', title: 'Draft the board deck', projectId: 'a', status: 'next', priority: 'normal', estimateMinutes: 120, notes: [], order: 1 }],
      },
    })
    return repo
  }
  const answer = JSON.stringify({
    summary: 'Two strategy days.',
    blocks: [
      { date: '2026-10-21', projectId: 'a', size: 0.5, note: 'Board deck', reason: 'Due next week' },
      { date: '2026-10-19', projectId: 'a', size: 0.5, note: null, reason: 'In the past' },
      { date: '2026-10-22', projectId: 'h', size: 0.5, note: null, reason: 'Private' },
    ],
  })

  it('plans from the browser date on, leaves private projects out and sends no task titles', async () => {
    const repo = setup()
    let seen: { user: string; options?: CompleteOptions } = { user: '' }
    const fake = { provider: 'anthropic' as const, model: 'test', complete: async (_s: string, user: string, options: CompleteOptions) => ((seen = { user, options }), answer) }
    const app = createApp({ repo, ai: aiRoutes(repo, fake) })
    const res = await app.request('/api/ai/week', { method: 'POST', headers: H, body: JSON.stringify({ start: '2026-10-19', days: 7, today: '2026-10-21', now: '09:30', locale: 'de' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.blocks).toEqual([{ date: '2026-10-21', projectId: 'a', size: 0.5, note: 'Board deck', reason: 'Due next week' }])
    expect(body.dropped).toBe(2)
    expect(seen.options).toEqual({ schema: WEEK_SCHEMA, effort: 'medium' })
    expect(seen.user).toContain('Range: 2026-10-21 to 2026-10-25')
    expect(seen.user).toContain('now 09:30')
    expect(seen.user).toContain('"Strategy"')
    expect(seen.user).not.toContain('Hidden hobby')
    expect(seen.user).not.toContain('Old')
    expect(seen.user).not.toContain('Draft the board deck')
  })

  it('includes private projects when they are shown, and validates the request', async () => {
    const repo = setup()
    let seenUser = ''
    const fake = { provider: 'anthropic' as const, model: 'test', complete: async (_s: string, user: string) => ((seenUser = user), answer) }
    const app = createApp({ repo, ai: aiRoutes(repo, fake) })
    const res = await app.request('/api/ai/week', { method: 'POST', headers: H, body: JSON.stringify({ start: '2026-10-19', days: 7, today: '2026-10-19', includePrivate: true }) })
    expect((await res.json()).blocks.map((b: { projectId: string }) => b.projectId)).toEqual(['a', 'a', 'h'])
    expect(seenUser).toContain('Hidden hobby')
    expect((await app.request('/api/ai/week', { method: 'POST', headers: H, body: '{}' })).status).toBe(400)
    const off = createApp({ repo, ai: aiRoutes(repo, null) })
    expect((await off.request('/api/ai/week', { method: 'POST', headers: H, body: JSON.stringify({ start: '2026-10-19' }) })).status).toBe(503)
  })

  it('asks Clarify for low effort with its own schema', async () => {
    const repo = setup()
    let options: CompleteOptions | undefined
    const fake = { provider: 'anthropic' as const, model: 'test', complete: async (_s: string, _u: string, o: CompleteOptions) => ((options = o), '{"kind":"task","title":"x"}') }
    await createApp({ repo, ai: aiRoutes(repo, fake) }).request('/api/ai/clarify', { method: 'POST', headers: H, body: JSON.stringify({ text: 'x' }) })
    expect(options).toEqual({ schema: CLARIFY_SCHEMA, effort: 'low' })
  })
})
