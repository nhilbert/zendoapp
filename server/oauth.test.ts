import { describe, expect, it } from 'vitest'
import { createHash, randomBytes } from 'node:crypto'
import { openDb } from './db.ts'
import { Repo } from './repo.ts'
import { createApp } from './app.ts'
import { mcpRoutes } from './mcp.ts'
import { OAuthServer, type OAuthConfig } from './oauth.ts'

const CALLBACK = 'https://claude.ai/api/mcp/auth_callback'

function setup(cfg: Partial<OAuthConfig> = {}) {
  const db = openDb(':memory:')
  const repo = new Repo(db)
  const oauth = new OAuthServer(db, { baseUrl: new URL('http://127.0.0.1:5174'), ...cfg })
  const app = createApp({ repo, mcp: mcpRoutes(repo, { oauth }), oauth: { routes: oauth.routes(), admin: oauth.adminRoutes() } })
  return { app, oauth, repo }
}

const LOCAL = { host: '127.0.0.1:5174' }
const form = (o: Record<string, string>) => ({ method: 'POST', headers: { ...LOCAL, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o).toString() })
const pkce = () => {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

async function register(app: ReturnType<typeof setup>['app'], redirect_uris = [CALLBACK]) {
  const res = await app.request('/oauth/register', { method: 'POST', headers: { ...LOCAL, 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris }) })
  return { status: res.status, body: (await res.json()) as { client_id: string } }
}

/** Runs authorize → consent → code; returns the redirect URL. */
async function authorize(app: ReturnType<typeof setup>['app'], clientId: string, challenge: string, headers: Record<string, string> = LOCAL, redirect = CALLBACK) {
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', resource: 'http://127.0.0.1:5174/mcp' })
  const page = await app.request(`/oauth/authorize?${q}`, { headers })
  if (page.status !== 200) return { status: page.status, url: page.headers.get('location') }
  const html = await page.text()
  const request = /name="request" value="([^"]+)"/.exec(html)![1]
  const res = await app.request('/oauth/authorize', { ...form({ request, decision: 'allow' }), headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' } })
  return { status: res.status, url: res.headers.get('location'), html }
}

async function connect(ctx: ReturnType<typeof setup>) {
  const { body } = await register(ctx.app)
  const { verifier, challenge } = pkce()
  const { url } = await authorize(ctx.app, body.client_id, challenge)
  const code = new URL(url!).searchParams.get('code')!
  const res = await ctx.app.request('/oauth/token', form({ grant_type: 'authorization_code', code, redirect_uri: CALLBACK, client_id: body.client_id, code_verifier: verifier }))
  return { clientId: body.client_id, tokens: (await res.json()) as { access_token: string; refresh_token: string; expires_in: number } }
}

const callMcp = (app: ReturnType<typeof setup>['app'], token?: string) =>
  app.request('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'inbox_list', arguments: {} } }),
  })

describe('OAuth for /mcp', () => {
  it('points unauthenticated clients to the metadata', async () => {
    const { app } = setup()
    const res = await callMcp(app)
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain('resource_metadata="http://127.0.0.1:5174/.well-known/oauth-protected-resource/mcp"')
    const prm = await (await app.request('/.well-known/oauth-protected-resource/mcp')).json()
    expect(prm).toMatchObject({ resource: 'http://127.0.0.1:5174/mcp', authorization_servers: ['http://127.0.0.1:5174'] })
    const as = await (await app.request('/.well-known/oauth-authorization-server')).json()
    expect(as.code_challenge_methods_supported).toEqual(['S256'])
    expect(as.registration_endpoint).toBe('http://127.0.0.1:5174/oauth/register')
  })

  it('runs the full flow: register, consent, token, call, refresh with rotation', async () => {
    const ctx = setup()
    const { clientId, tokens } = await connect(ctx)
    expect(tokens.expires_in).toBe(3600)
    expect((await callMcp(ctx.app, tokens.access_token)).status).toBe(200)
    const refresh = async (rt: string) => ctx.app.request('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: rt, client_id: clientId }))
    const r1 = await refresh(tokens.refresh_token)
    expect(r1.status).toBe(200)
    const t2 = (await r1.json()) as { access_token: string; refresh_token: string }
    expect(t2.refresh_token).not.toBe(tokens.refresh_token)
    expect((await callMcp(ctx.app, tokens.access_token)).status).toBe(401) // the old access token went with the rotation
    expect((await callMcp(ctx.app, t2.access_token)).status).toBe(200)
    expect((await refresh(tokens.refresh_token)).status).toBe(400) // reuse is refused
    expect(ctx.oauth.connections().map((c) => c.name)).toEqual(['Claude'])
  })

  it('revokes the whole family when an old refresh token is replayed later', async () => {
    const ctx = setup()
    const { clientId, tokens } = await connect(ctx)
    const r1 = (await (await ctx.app.request('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId }))).json()) as { access_token: string }
    const realNow = Date.now
    Date.now = () => realNow() + 60_000
    try {
      expect((await ctx.app.request('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId }))).status).toBe(400)
      expect((await callMcp(ctx.app, r1.access_token)).status).toBe(401)
    } finally {
      Date.now = realNow
    }
  })

  it('rejects wrong verifiers, reused codes, foreign redirects and unknown clients', async () => {
    const ctx = setup()
    expect((await register(ctx.app, ['https://evil.example/cb'])).status).toBe(400)
    const { body } = await register(ctx.app, [CALLBACK, 'http://127.0.0.1/callback'])
    const { verifier, challenge } = pkce()
    const { url } = await authorize(ctx.app, body.client_id, challenge)
    const code = new URL(url!).searchParams.get('code')!
    const bad = await ctx.app.request('/oauth/token', form({ grant_type: 'authorization_code', code, redirect_uri: CALLBACK, client_id: body.client_id, code_verifier: pkce().verifier }))
    expect(bad.status).toBe(400)
    const again = await ctx.app.request('/oauth/token', form({ grant_type: 'authorization_code', code, redirect_uri: CALLBACK, client_id: body.client_id, code_verifier: verifier }))
    expect(again.status).toBe(400) // the code was consumed by the failed attempt
    const loop = await authorize(ctx.app, body.client_id, challenge, LOCAL, 'http://127.0.0.1:43123/callback')
    expect(loop.html).toContain('program on this computer')
    expect(new URL(loop.url!).port).toBe('43123')
    const foreign = await ctx.app.request(`/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: body.client_id, redirect_uri: 'https://claude.com/api/mcp/auth_callback', code_challenge: challenge, code_challenge_method: 'S256' })}`, { headers: LOCAL })
    expect(foreign.status).toBe(400)
    expect((await ctx.app.request('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: 'x', client_id: 'nope' }))).status).toBe(401)
  })

  it('locally only a browser on this machine may approve', async () => {
    const ctx = setup()
    const { body } = await register(ctx.app)
    const r = await authorize(ctx.app, body.client_id, pkce().challenge, { host: 'zendo.example.com' })
    expect(r.status).toBe(403)
  })

  it('hosted, only allowed users from the login proxy header may approve', async () => {
    const ctx = setup({ baseUrl: new URL('https://zendo.example.com'), allowedUsers: ['Norman@Example.de'], userHeader: 'X-Auth-Request-Email' })
    const reg = await ctx.app.request('/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [CALLBACK] }) })
    const { client_id } = (await reg.json()) as { client_id: string }
    const host = { host: 'zendo.example.com' }
    const q = (challenge: string) => new URLSearchParams({ response_type: 'code', client_id, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256', resource: 'https://zendo.example.com/mcp' })
    expect((await ctx.app.request(`/oauth/authorize?${q('c'.repeat(43))}`, { headers: host })).status).toBe(403)
    expect((await ctx.app.request(`/oauth/authorize?${q('c'.repeat(43))}`, { headers: { ...host, 'x-auth-request-email': 'other@example.de' } })).status).toBe(403)
    expect((await ctx.app.request(`/oauth/authorize?${q('c'.repeat(43))}`, { headers: { ...host, 'x-auth-request-email': 'norman@example.de' } })).status).toBe(200)
    const wrongResource = new URLSearchParams({ response_type: 'code', client_id, redirect_uri: CALLBACK, code_challenge: 'c'.repeat(43), code_challenge_method: 'S256', resource: 'https://other.example/mcp' })
    const res = await ctx.app.request(`/oauth/authorize?${wrongResource}`, { headers: { ...host, 'x-auth-request-email': 'norman@example.de' } })
    expect(new URL(res.headers.get('location')!).searchParams.get('error')).toBe('invalid_target')
  })

  it('lists connections for Settings and disconnects them', async () => {
    const ctx = setup()
    const { clientId, tokens } = await connect(ctx)
    const H = { 'x-zendo': '1', host: '127.0.0.1:5174' }
    const list = await (await ctx.app.request('/api/mcp/connections', { headers: H })).json()
    expect(list.connections).toMatchObject([{ id: clientId, name: 'Claude', user: 'local' }])
    expect((await ctx.app.request(`/api/mcp/connections/${clientId}`, { method: 'DELETE', headers: H })).status).toBe(200)
    expect((await callMcp(ctx.app, tokens.access_token)).status).toBe(401)
    expect(ctx.oauth.connections()).toEqual([])
  })
})
