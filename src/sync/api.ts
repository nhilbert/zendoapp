/** Fetch wrapper for the local Zendo server (reached through the Vite proxy in dev, same origin in production). */
export class ServiceUnavailable extends Error {
  constructor() {
    super('service_unavailable')
  }
}
export class NotConfigured extends Error {
  constructor() {
    super('not_configured')
  }
}

export async function api<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), init?.timeoutMs ?? 8000)
  let res: Response
  try {
    res = await fetch(path, { ...init, signal: controller.signal, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}), 'x-zendo': '1' } })
  } catch {
    throw new ServiceUnavailable()
  } finally {
    window.clearTimeout(timer)
  }
  // 502/504 come from the Vite proxy when the server is not running.
  if (res.status === 502 || res.status === 504) throw new ServiceUnavailable()
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    if (res.status === 503 && body.error === 'not_configured') throw new NotConfigured()
    if (res.status === 503) throw new ServiceUnavailable()
    throw new Error(body.error ?? `${res.status} ${res.statusText}`)
  }
  return (await res.json()) as T
}
