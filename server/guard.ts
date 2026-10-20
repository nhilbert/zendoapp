import type { Context, Next } from 'hono'

/**
 * Only Zendo itself may talk to the API: requests must carry the custom header
 * the app sets (a cross-site page cannot add it without a CORS preflight, which
 * this server never grants), reach a loopback host, and – when a browser sends
 * an Origin – come from a loopback origin.
 */
export function isTrusted(headers: Headers, url: string): boolean {
  const hostHeader = headers.get('host') ?? new URL(url).host
  const host = hostHeader.replace(/:\d+$/, '')
  if (host !== '127.0.0.1' && host !== 'localhost') return false
  const origin = headers.get('origin')
  if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return false
  return headers.get('x-zendo') === '1'
}

export async function guard(c: Context, next: Next): Promise<Response | void> {
  if (!isTrusted(c.req.raw.headers, c.req.url)) return c.json({ error: 'forbidden' }, 403)
  await next()
}
