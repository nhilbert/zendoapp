import { Hono } from 'hono'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { exec } from 'node:child_process'
import path from 'node:path'
import { PublicClientApplication, type AccountInfo, type AuthenticationResult } from '@azure/msal-node'
import { mapGraphEvents, type GraphEvent } from './graph-map.ts'

export interface CalendarConfig {
  clientId?: string
  tenantId?: string
  timezone: string
  dataDir: string
}

const SCOPES = ['Calendars.Read']
const ISO = /^\d{4}-\d{2}-\d{2}$/

function openBrowser(url: string): Promise<void> {
  const isWsl = existsSync('/proc/version') && /microsoft/i.test(readFileSync('/proc/version', 'utf8'))
  console.log('Microsoft 365 sign-in: a browser window should open. If not, open:\n' + url)
  const cmd =
    process.platform === 'win32'
      ? `start "" "${url}"`
      : process.platform === 'darwin'
        ? `open "${url}"`
        : isWsl
          ? `powershell.exe -NoProfile -Command Start-Process '${url.replace(/'/g, "''")}'`
          : `xdg-open "${url}"`
  exec(cmd, () => {})
  return Promise.resolve()
}

/**
 * Microsoft 365 calendar routes (public client, loopback + PKCE). Mounted at /api/calendar.
 * Without MS_CLIENT_ID / MS_TENANT_ID every route answers 503 not_configured, and the rest of Zendo keeps working.
 */
export function calendarRoutes(cfg: CalendarConfig): Hono {
  const app = new Hono()
  if (!cfg.clientId || !cfg.tenantId) {
    app.all('*', (c) => c.json({ error: 'not_configured' }, 503))
    return app
  }
  const cacheFile = path.join(cfg.dataDir, 'msal-cache.json')
  const pca = new PublicClientApplication({
    auth: { clientId: cfg.clientId, authority: `https://login.microsoftonline.com/${cfg.tenantId}` },
    cache: {
      cachePlugin: {
        beforeCacheAccess: async (ctx) => {
          if (existsSync(cacheFile)) ctx.tokenCache.deserialize(readFileSync(cacheFile, 'utf8'))
        },
        afterCacheAccess: async (ctx) => {
          if (!ctx.cacheHasChanged) return
          mkdirSync(cfg.dataDir, { recursive: true })
          writeFileSync(cacheFile, ctx.tokenCache.serialize(), { mode: 0o600 })
        },
      },
    },
  })

  const getAccount = async (): Promise<AccountInfo | undefined> => (await pca.getTokenCache().getAllAccounts())[0]

  const getToken = async (interactive: boolean): Promise<AuthenticationResult> => {
    const account = await getAccount()
    if (account) {
      try {
        const silent = await pca.acquireTokenSilent({ account, scopes: SCOPES })
        if (silent) return silent
      } catch (err) {
        if (!interactive) throw new Error('not_connected')
        console.log('Silent token refresh failed, signing in again:', (err as { errorCode?: string; message?: string })?.errorCode ?? (err as Error)?.message)
      }
    }
    if (!interactive) throw new Error('not_connected')
    const result = await pca.acquireTokenInteractive({
      scopes: SCOPES,
      openBrowser,
      successTemplate: '<html><body style="font-family:sans-serif;padding:2rem">Zendo is connected. You can close this window.</body></html>',
      errorTemplate: '<html><body style="font-family:sans-serif;padding:2rem">Sign-in failed. Check the Zendo terminal.</body></html>',
    })
    if (!result) throw new Error('sign_in_failed')
    return result
  }

  const fetchCalendarView = async (accessToken: string, from: string, to: string): Promise<GraphEvent[]> => {
    let url: string | undefined =
      `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${encodeURIComponent(`${from}T00:00:00`)}&endDateTime=${encodeURIComponent(`${to}T23:59:59`)}` +
      `&$select=id,subject,start,end,showAs,sensitivity,isAllDay,isCancelled,isOnlineMeeting,onlineMeetingUrl,location&$orderby=start/dateTime&$top=200`
    const items: GraphEvent[] = []
    while (url) {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Prefer: `outlook.timezone="${cfg.timezone}"` } })
      if (!res.ok) throw new Error(`graph_${res.status}: ${(await res.text()).slice(0, 300)}`)
      const json = (await res.json()) as { value: GraphEvent[]; '@odata.nextLink'?: string }
      items.push(...json.value)
      url = json['@odata.nextLink']
    }
    return items
  }

  app.onError((err, c) => {
    const message = err.message ?? String(err)
    console.error('Calendar error:', message)
    return c.json({ error: message }, message === 'not_connected' ? 401 : 500)
  })

  app.get('/status', async (c) => {
    const account = await getAccount()
    return c.json({ connected: !!account, account: account?.username ?? null })
  })
  app.post('/connect', async (c) => {
    const result = await getToken(true)
    console.log(`Microsoft 365 connected as ${result.account?.username}`)
    return c.json({ connected: true, account: result.account?.username ?? null })
  })
  app.post('/disconnect', async (c) => {
    const account = await getAccount()
    if (account) await pca.getTokenCache().removeAccount(account)
    if (existsSync(cacheFile)) unlinkSync(cacheFile)
    return c.json({ connected: false, account: null })
  })
  app.get('/events', async (c) => {
    const from = c.req.query('from') ?? ''
    const to = c.req.query('to') ?? ''
    if (!ISO.test(from) || !ISO.test(to) || from > to) return c.json({ error: 'bad_range' }, 400)
    const token = await getToken(false)
    const items = await fetchCalendarView(token.accessToken, from, to)
    const events = mapGraphEvents(items, { from, to })
    console.log(`Calendar: ${events.length} events (${from} … ${to})`)
    return c.json({ events, from, to, account: token.account?.username ?? null })
  })
  return app
}
