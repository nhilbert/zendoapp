/**
 * Zendo calendar service – a tiny local HTTP service on 127.0.0.1 that signs in to
 * Microsoft 365 (public client, loopback + PKCE) and serves the calendar as Zendo
 * events. The Vite dev server proxies /api to it. This is the seed of the local
 * Zendo server described in docs/architecture.md.
 *
 * Token cache: data/msal-cache.json (gitignored, mode 600). Delete it to sign out.
 */
import http from 'node:http'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { exec } from 'node:child_process'
import { PublicClientApplication } from '@azure/msal-node'
import { mapGraphEvents } from './graph-map.mjs'

if (existsSync('.env')) process.loadEnvFile('.env')
const clientId = process.env.MS_CLIENT_ID?.trim()
const tenantId = process.env.MS_TENANT_ID?.trim()
if (!clientId || !tenantId) {
  console.error('Calendar service: MS_CLIENT_ID / MS_TENANT_ID missing. Copy .env.example to .env (see docs/outlook-setup.md).')
  process.exit(1)
}
const PORT = Number(process.env.ZENDO_CALENDAR_PORT || 5174)
const TZ = process.env.MS_TIMEZONE || 'W. Europe Standard Time'
const DATA_DIR = 'data'
const CACHE_FILE = `${DATA_DIR}/msal-cache.json`
const SCOPES = ['Calendars.Read']

const isWsl = existsSync('/proc/version') && /microsoft/i.test(readFileSync('/proc/version', 'utf8'))
function openBrowser(url) {
  console.log('Sign-in: a browser window should open. If not, open:\n' + url)
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

const cachePlugin = {
  beforeCacheAccess: async (ctx) => {
    if (existsSync(CACHE_FILE)) ctx.tokenCache.deserialize(readFileSync(CACHE_FILE, 'utf8'))
  },
  afterCacheAccess: async (ctx) => {
    if (!ctx.cacheHasChanged) return
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(CACHE_FILE, ctx.tokenCache.serialize(), { mode: 0o600 })
  },
}

const pca = new PublicClientApplication({
  auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId}` },
  cache: { cachePlugin },
})

async function getAccount() {
  const accounts = await pca.getTokenCache().getAllAccounts()
  return accounts[0]
}

async function getToken(interactive) {
  const account = await getAccount()
  if (account) {
    try {
      return await pca.acquireTokenSilent({ account, scopes: SCOPES })
    } catch (err) {
      if (!interactive) throw new Error('not_connected')
      console.log('Silent token refresh failed, signing in again:', err?.errorCode ?? err?.message)
    }
  }
  if (!interactive) throw new Error('not_connected')
  return pca.acquireTokenInteractive({
    scopes: SCOPES,
    openBrowser,
    successTemplate: '<html><body style="font-family:sans-serif;padding:2rem">Zendo is connected. You can close this window.</body></html>',
    errorTemplate: '<html><body style="font-family:sans-serif;padding:2rem">Sign-in failed. Check the Zendo terminal.</body></html>',
  })
}

async function fetchCalendarView(accessToken, from, to) {
  const start = `${from}T00:00:00`
  const end = `${to}T23:59:59`
  let url =
    `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}` +
    `&$select=id,subject,start,end,showAs,sensitivity,isAllDay,isCancelled,isOnlineMeeting,onlineMeetingUrl,location&$orderby=start/dateTime&$top=200`
  const items = []
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Prefer: `outlook.timezone="${TZ}"` } })
    if (!res.ok) throw new Error(`graph_${res.status}: ${(await res.text()).slice(0, 300)}`)
    const json = await res.json()
    items.push(...json.value)
    url = json['@odata.nextLink']
  }
  return items
}

const ISO = /^\d{4}-\d{2}-\d{2}$/

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  try {
    if (req.method === 'GET' && url.pathname === '/api/calendar/status') {
      const account = await getAccount()
      return send(200, { connected: !!account, account: account?.username ?? null })
    }
    if (req.method === 'POST' && url.pathname === '/api/calendar/connect') {
      const result = await getToken(true)
      console.log(`Connected as ${result.account?.username}`)
      return send(200, { connected: true, account: result.account?.username ?? null })
    }
    if (req.method === 'POST' && url.pathname === '/api/calendar/disconnect') {
      const account = await getAccount()
      if (account) await pca.getTokenCache().removeAccount(account)
      if (existsSync(CACHE_FILE)) unlinkSync(CACHE_FILE)
      return send(200, { connected: false, account: null })
    }
    if (req.method === 'GET' && url.pathname === '/api/calendar/events') {
      const from = url.searchParams.get('from') ?? ''
      const to = url.searchParams.get('to') ?? ''
      if (!ISO.test(from) || !ISO.test(to) || from > to) return send(400, { error: 'bad_range' })
      const token = await getToken(false)
      const items = await fetchCalendarView(token.accessToken, from, to)
      const events = mapGraphEvents(items, { from, to })
      console.log(`Synced ${events.length} events (${from} … ${to})`)
      return send(200, { events, from, to, account: token.account?.username ?? null })
    }
    send(404, { error: 'not_found' })
  } catch (err) {
    const message = err?.message ?? String(err)
    console.error('Calendar service error:', message)
    send(message === 'not_connected' ? 401 : 500, { error: message })
  }
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `Calendar service: port ${PORT} is already in use.\n` +
        `  Another Zendo instance is probably still running or suspended (Ctrl+Z) in a different terminal.\n` +
        `  Find it with:  ss -lptn 'sport = :${PORT}'   and stop it (fg + Ctrl+C, or kill <pid>), then start npm run dev again.`,
    )
  } else {
    console.error('Calendar service failed to start:', err.message)
  }
  process.exit(1)
})
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Zendo calendar service on http://127.0.0.1:${PORT} · token cache ${CACHE_FILE}`)
})
