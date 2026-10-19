/**
 * Verifies the Entra app registration for Zendo:
 *   1. signs you in with the loopback + PKCE flow (browser window opens),
 *   2. reads your calendar for the next 7 days via Microsoft Graph,
 *   3. prints a short table (subject, time, show-as) and the counts Zendo cares about.
 *
 * Nothing is stored: no token cache, no file written. Run: npm run calendar:check
 */
import { PublicClientApplication } from '@azure/msal-node'
import { existsSync, readFileSync } from 'node:fs'
import { exec } from 'node:child_process'

if (existsSync('.env')) process.loadEnvFile('.env')
const clientId = process.env.MS_CLIENT_ID?.trim()
const tenantId = process.env.MS_TENANT_ID?.trim()
if (!clientId || !tenantId) {
  console.error('Missing MS_CLIENT_ID or MS_TENANT_ID. Copy .env.example to .env and fill in both IDs from the app registration overview.')
  process.exit(1)
}

const isWsl = existsSync('/proc/version') && /microsoft/i.test(readFileSync('/proc/version', 'utf8'))
function openBrowser(url) {
  console.log('\nIf no browser window opens, open this URL yourself:\n' + url + '\n')
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

const pca = new PublicClientApplication({
  auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId}` },
})

console.log('Signing in… (a browser window should open)')
const auth = await pca.acquireTokenInteractive({
  scopes: ['Calendars.Read'],
  openBrowser,
  successTemplate: '<html><body style="font-family:sans-serif;padding:2rem">Signed in. You can close this window and return to the terminal.</body></html>',
  errorTemplate: '<html><body style="font-family:sans-serif;padding:2rem">Sign-in failed. Check the terminal.</body></html>',
})
console.log(`Signed in as ${auth.account?.username ?? '(unknown)'}\n`)

const start = new Date()
const end = new Date(Date.now() + 7 * 86_400_000)
const url =
  `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${start.toISOString()}&endDateTime=${end.toISOString()}` +
  `&$select=subject,start,end,showAs,isAllDay,isCancelled,isOnlineMeeting,location&$orderby=start/dateTime&$top=100`
const res = await fetch(url, {
  headers: { Authorization: `Bearer ${auth.accessToken}`, Prefer: 'outlook.timezone="W. Europe Standard Time"' },
})
if (!res.ok) {
  console.error(`Graph request failed: ${res.status} ${res.statusText}\n${await res.text()}`)
  process.exit(1)
}
const { value: events } = await res.json()

const fmt = (dt) => dt.dateTime.slice(0, 16).replace('T', ' ')
console.log(`${events.length} events in the next 7 days:\n`)
for (const e of events) {
  const when = e.isAllDay ? `${e.start.dateTime.slice(0, 10)} (all day)   ` : `${fmt(e.start)}–${e.end.dateTime.slice(11, 16)}`
  const flags = [e.showAs, e.isOnlineMeeting ? 'online' : '', e.isCancelled ? 'cancelled' : ''].filter(Boolean).join(', ')
  console.log(`  ${when}  ${e.subject ?? '(no subject)'}  [${flags}]`)
}
const blocking = events.filter((e) => e.showAs !== 'free' && !e.isCancelled).length
console.log(`\nBlocking time: ${blocking} · shown as free: ${events.filter((e) => e.showAs === 'free').length} · cancelled: ${events.filter((e) => e.isCancelled).length}`)
console.log('\nRegistration works. Zendo will use exactly this query and these rules.')
