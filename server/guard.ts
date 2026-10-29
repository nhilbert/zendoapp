import { createHash, timingSafeEqual } from 'node:crypto'
import type { Context, Next } from 'hono'

/**
 * Only Zendo itself may talk to the API: requests must carry the custom header
 * the app sets (a cross-site page cannot add it without a CORS preflight, which
 * this server never grants), reach a loopback host or the configured public URL
 * (ZENDO_PUBLIC_URL, when hosted behind a reverse proxy), and – when a browser
 * sends an Origin – come from one of those origins.
 */
export function isTrusted(headers: Headers, url: string, publicUrl?: URL): boolean {
  const hostHeader = headers.get('host') ?? new URL(url).host
  const host = hostHeader.replace(/:\d+$/, '')
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== publicUrl?.hostname) return false
  const origin = headers.get('origin')
  if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin) && origin !== publicUrl?.origin) return false
  return headers.get('x-zendo') === '1'
}

/**
 * Hosted behind the login proxy (docs/architecture.md, section 11): only Caddy can reach Zendo, and it sets the
 * signed-in e-mail after the login (stripping any such header a client sends). The API answers only that
 * e-mail. One exception: POST /api/inbox with the capture token, so the Revenue Tracker can add inbox items
 * through the proxy without a browser session – and can do nothing else.
 */
export interface Access {
  users: string[]
  userHeader: string
  captureToken?: string
}

const digest = (v: string) => createHash('sha256').update(v).digest()

export function isAllowed(method: string, path: string, headers: Headers, access?: Access): boolean {
  if (!access?.users.length) return true
  const email = headers.get(access.userHeader)?.trim().toLowerCase()
  if (email && access.users.includes(email)) return true
  const bearer = /^Bearer (.+)$/.exec(headers.get('authorization') ?? '')?.[1]
  return !!(access.captureToken && bearer && method === 'POST' && path === '/api/inbox' && timingSafeEqual(digest(bearer), digest(access.captureToken)))
}

export function guard(publicUrl?: URL, access?: Access) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    if (!isTrusted(c.req.raw.headers, c.req.url, publicUrl)) return c.json({ error: 'forbidden' }, 403)
    if (!isAllowed(c.req.method, c.req.path, c.req.raw.headers, access)) return c.json({ error: 'login_required' }, 401)
    await next()
  }
}
