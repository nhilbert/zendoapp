import { Hono } from 'hono'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { exec } from 'node:child_process'
import path from 'node:path'
import { PublicClientApplication, type AccountInfo, type AuthenticationResult } from '@azure/msal-node'
import { mapGraphEvents, type GraphEvent } from './graph-map.ts'
import type { Repo } from './repo.ts'
import { addDaysISO, startOfWeekISO, todayISO } from '../src/domain/dates.ts'

export interface CalendarConfig {
  clientId?: string
  tenantId?: string
  timezone: string
  dataDir: string
  /**
   * 'browser': loopback sign-in in a browser window on this machine (local use).
   * 'device': the server shows a code to enter at microsoft.com/devicelogin (hosted, no browser on the server;
   * needs "Allow public client flows" in the app registration).
   */
  login: 'browser' | 'device'
}

export interface DeviceLogin {
  userCode: string
  verificationUri: string
  expiresAt: string
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

export interface CalendarService {
  routes: Hono
  /** Fetches the visible range and writes it into the database. Throws 'not_connected' when no account is signed in. */
  syncNow: () => Promise<{ total: number; kept: number; removed: number; account: string | null; lastSync: string }>
  configured: boolean
}

/** Sync range: last week … five weeks ahead (covers the two-week plan and the review). */
export function syncRange(): { from: string; to: string } {
  const from = addDaysISO(startOfWeekISO(todayISO()), -7)
  return { from, to: addDaysISO(from, 7 + 35) }
}

/**
 * Microsoft 365 calendar (public client, loopback + PKCE). Routes are mounted at /api/calendar.
 * Without MS_CLIENT_ID / MS_TENANT_ID every route answers 503 not_configured, and the rest of Zendo keeps working.
 */
export function calendarService(cfg: CalendarConfig, repo: Repo): CalendarService {
  const app = new Hono()
  if (!cfg.clientId || !cfg.tenantId) {
    app.all('*', (c) => c.json({ error: 'not_configured' }, 503))
    return { routes: app, configured: false, syncNow: async () => { throw new Error('not_configured') } }
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
      `&$select=id,subject,start,end,showAs,sensitivity,isAllDay,isCancelled,isOnlineMeeting,onlineMeetingUrl,onlineMeeting,bodyPreview,location&$orderby=start/dateTime&$top=200`
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

  const syncNow: CalendarService['syncNow'] = async () => {
    const token = await getToken(false)
    const { from, to } = syncRange()
    const items = await fetchCalendarView(token.accessToken, from, to)
    const result = repo.replaceEvents('m365', mapGraphEvents(items, { from, to }))
    const lastSync = new Date().toISOString()
    repo.setMeta('calendar_last_sync', lastSync)
    console.log(`Calendar: ${result.total} events synced (${from} … ${to}), ${result.kept} known, ${result.removed} removed`)
    return { ...result, account: token.account?.username ?? null, lastSync }
  }

  // Device-code sign-in: /connect answers as soon as Microsoft hands out the code; the browser then polls
  // /status while the sign-in finishes here in the background.
  let deviceLogin: DeviceLogin | null = null
  let loginError: string | null = null
  const activeDeviceLogin = () => (deviceLogin && Date.parse(deviceLogin.expiresAt) > Date.now() ? deviceLogin : null)
  const startDeviceLogin = () =>
    new Promise<DeviceLogin>((resolve, reject) => {
      const active = activeDeviceLogin()
      if (active) return resolve(active)
      loginError = null
      pca
        .acquireTokenByDeviceCode({
          scopes: SCOPES,
          deviceCodeCallback: (r) => {
            deviceLogin = { userCode: r.userCode, verificationUri: r.verificationUri, expiresAt: new Date(Date.now() + r.expiresIn * 1000).toISOString() }
            console.log(`Microsoft 365 sign-in: ${r.message}`)
            resolve(deviceLogin)
          },
        })
        .then(async (result) => {
          deviceLogin = null
          console.log(`Microsoft 365 connected as ${result?.account?.username}`)
          await syncNow().catch((err) => console.error('Calendar: first sync failed:', (err as Error).message))
        })
        .catch((err) => {
          deviceLogin = null
          loginError = (err as { errorCode?: string })?.errorCode || (err as Error)?.message || 'sign_in_failed'
          console.error('Microsoft 365 sign-in failed:', (err as Error)?.message ?? err)
          reject(err)
        })
    })

  app.onError((err, c) => {
    const message = err.message ?? String(err)
    console.error('Calendar error:', message)
    return c.json({ error: message }, message === 'not_connected' ? 401 : 500)
  })

  app.get('/status', async (c) => {
    const account = await getAccount()
    return c.json({
      connected: !!account,
      account: account?.username ?? null,
      lastSync: repo.getMeta('calendar_last_sync') ?? null,
      pending: account ? null : activeDeviceLogin(),
      loginError: account ? null : loginError,
    })
  })
  app.post('/sync', async (c) => c.json(await syncNow()))
  app.post('/connect', async (c) => {
    if (cfg.login === 'device') return c.json({ connected: false, account: null, pending: await startDeviceLogin() })
    const result = await getToken(true)
    console.log(`Microsoft 365 connected as ${result.account?.username}`)
    const synced = await syncNow().catch((err) => {
      console.error('Calendar: first sync failed:', (err as Error).message)
      return null
    })
    return c.json({ connected: true, account: result.account?.username ?? null, lastSync: synced?.lastSync ?? null })
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
  return { routes: app, configured: true, syncNow }
}

/** Sync at start (when signed in) and then every `minutes`; failures are logged and retried next time. */
export function startCalendarSyncJob(service: CalendarService, minutes: number): void {
  if (!service.configured || minutes <= 0) return
  const run = async () => {
    try {
      await service.syncNow()
    } catch (err) {
      const message = (err as Error).message
      if (message !== 'not_connected') console.error('Calendar: background sync failed:', message)
    }
  }
  setTimeout(() => void run(), 3000).unref()
  setInterval(() => void run(), minutes * 60 * 1000).unref()
}
