import { afterEach, describe, expect, it, vi } from 'vitest'
import { RequestTimeout, ServiceUnavailable, api } from '@/sync/api'
import { aiErrorText } from './errors'

// Plain Node: window timers and a fake fetch, stubbed per test.
afterEach(() => vi.unstubAllGlobals())
const respond = (status: number, body: unknown) => vi.stubGlobal('fetch', async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))

// Regression from the code review (#2): week-proposal failures all read "the Zendo server is not reachable".
describe('AI errors reach the user as what they are', () => {
  it('keeps a Zendo AI error apart from an unreachable server', async () => {
    vi.stubGlobal('window', { setTimeout, clearTimeout })
    respond(500, { error: 'ai_truncated' })
    await expect(api('/api/ai/week')).rejects.toThrow('ai_truncated')
    respond(502, {}) // the dev proxy or Caddy: the server is down
    await expect(api('/api/ai/week')).rejects.toBeInstanceOf(ServiceUnavailable)
  })

  it('reports a timeout as such, while sync still treats it as unavailable', async () => {
    vi.stubGlobal('window', { setTimeout, clearTimeout })
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))))
    const err = await api('/api/ai/week', { timeoutMs: 5 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RequestTimeout)
    expect(err).toBeInstanceOf(ServiceUnavailable)
    vi.stubGlobal('fetch', async () => Promise.reject(new TypeError('Failed to fetch')))
    const down = await api('/api/state').catch((e: unknown) => e)
    expect(down).toBeInstanceOf(ServiceUnavailable)
    expect(down).not.toBeInstanceOf(RequestTimeout)
  })

  it('maps every server code to its own text', () => {
    const t = (k: string) => `<${k}>`
    expect(aiErrorText(new Error('ai_refused'), t)).toBe('<clarify.ai.errRefused>')
    expect(aiErrorText(new Error('ai_truncated'), t)).toBe('<clarify.ai.errTruncated>')
    expect(aiErrorText(new Error('ai_bad_response'), t)).toBe('<clarify.ai.errBadResponse>')
    expect(aiErrorText(new Error('ai_unreachable'), t)).toBe('<clarify.ai.errUnreachable>')
    expect(aiErrorText(new RequestTimeout(), t)).toBe('<clarify.ai.errTimeout>')
    expect(aiErrorText(new ServiceUnavailable(), t)).toBe('<clarify.ai.errServer>')
  })
})
