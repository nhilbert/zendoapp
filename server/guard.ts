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

export function guard(publicUrl?: URL) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    if (!isTrusted(c.req.raw.headers, c.req.url, publicUrl)) return c.json({ error: 'forbidden' }, 403)
    await next()
  }
}
