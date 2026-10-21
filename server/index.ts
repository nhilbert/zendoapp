/**
 * Zendo server – one local process: JSON API + SQLite + Microsoft 365 calendar +
 * (after `npm run build`) the web UI itself. Binds to 127.0.0.1 unless ZENDO_HOST says otherwise
 * (0.0.0.0 inside the container, which is reachable only through the reverse proxy).
 *
 *   npm run dev    Vite dev server (UI) + this server (API)
 *   npm start      this server serving dist/ on http://127.0.0.1:5174
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { openDb } from './db.ts'
import { Repo } from './repo.ts'
import { backupDaily } from './backup.ts'
import { calendarService, startCalendarSyncJob } from './calendar.ts'
import { createApp } from './app.ts'
import { aiRoutes, resolveAi, type AiProviderName } from './ai.ts'
import { mcpRoutes } from './mcp.ts'
import { OAuthServer } from './oauth.ts'

if (existsSync('.env')) process.loadEnvFile('.env')

const PORT = Number(process.env.ZENDO_PORT || 5174)
const HOST = process.env.ZENDO_HOST || '127.0.0.1'
// Hosted behind a reverse proxy: the public address, e.g. https://zendo.example.com (see docs/architecture.md, Hosting).
const PUBLIC_URL = process.env.ZENDO_PUBLIC_URL?.trim() ? new URL(process.env.ZENDO_PUBLIC_URL.trim()) : undefined
const DATA_DIR = process.env.ZENDO_DATA_DIR || 'data'
const DB_FILE = path.join(DATA_DIR, 'zendo.db')
const DIST = 'dist'

const db = openDb(DB_FILE)
const repo = new Repo(db)
// One backup per day: at start (once there is data) and re-checked hourly while running.
const BACKUP_DIR = path.join(DATA_DIR, 'backups')
const backup = repo.isInitialized() ? backupDaily(db, DB_FILE, BACKUP_DIR) : null
setInterval(() => {
  if (repo.isInitialized()) backupDaily(db, DB_FILE, BACKUP_DIR)
}, 60 * 60 * 1000).unref()
const calendar = calendarService(
  {
    clientId: process.env.MS_CLIENT_ID?.trim(),
    tenantId: process.env.MS_TENANT_ID?.trim(),
    timezone: process.env.MS_TIMEZONE || 'W. Europe Standard Time',
    dataDir: DATA_DIR,
    login: process.env.ZENDO_CALENDAR_LOGIN === 'device' ? 'device' : 'browser',
  },
  repo,
)
startCalendarSyncJob(calendar, Number(process.env.ZENDO_CALENDAR_SYNC_MINUTES || 15))
const aiProvider = process.env.ZENDO_AI_PROVIDER?.trim()
const ai = resolveAi({
  provider: aiProvider === 'anthropic' || aiProvider === 'openai' ? (aiProvider as AiProviderName) : undefined,
  model: process.env.ZENDO_AI_MODEL,
  clarifyModel: process.env.ZENDO_AI_CLARIFY_MODEL,
  anthropicKey: process.env.ANTHROPIC_API_KEY?.trim() || undefined,
  openaiKey: process.env.OPENAI_API_KEY?.trim() || undefined,
})
// MCP endpoint for AI agents at /mcp: with a static token and/or OAuth for Claude's connectors (docs/mcp.md).
const MCP_TOKEN = process.env.ZENDO_MCP_TOKEN?.trim() || undefined
const list = (v?: string) => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean)
const OAUTH_USERS = list(process.env.ZENDO_OAUTH_USERS)
let oauth: OAuthServer | undefined
if (process.env.ZENDO_MCP_OAUTH === '1') {
  // Hosted, only users named in ZENDO_OAUTH_USERS (checked by the login proxy) may approve; never fall back to "anyone".
  if (PUBLIC_URL && !OAUTH_USERS.length) console.error('ZENDO_MCP_OAUTH=1 needs ZENDO_OAUTH_USERS when ZENDO_PUBLIC_URL is set – OAuth stays off.')
  else
    oauth = new OAuthServer(db, {
      baseUrl: PUBLIC_URL ?? new URL(`http://127.0.0.1:${PORT}`),
      allowedUsers: OAUTH_USERS,
      userHeader: process.env.ZENDO_OAUTH_USER_HEADER?.trim() || 'x-auth-request-email',
      extraRedirects: list(process.env.ZENDO_OAUTH_REDIRECTS),
    })
}
const mcp = MCP_TOKEN || oauth ? mcpRoutes(repo, { token: MCP_TOKEN, oauth }, { hidePrivate: process.env.ZENDO_MCP_HIDE_PRIVATE === '1' }) : undefined
const hasUi = existsSync(path.join(DIST, 'index.html'))
const app = createApp({ repo, calendar: calendar.routes, ai: aiRoutes(repo, ai), mcp, oauth: oauth && { routes: oauth.routes(), admin: oauth.adminRoutes() }, staticDir: hasUi ? DIST : undefined, publicUrl: PUBLIC_URL })

const server = serve({ fetch: app.fetch, hostname: HOST, port: PORT }, () => {
  console.log(`Zendo server on http://${HOST}:${PORT}${PUBLIC_URL ? ` (public ${PUBLIC_URL.origin})` : ''} · database ${DB_FILE}${backup ? ` · backup ${backup}` : ''}`)
  if (!hasUi) console.log('No dist/ build found: serving the API only (fine with npm run dev; run npm run build for npm start).')
  if (!process.env.MS_CLIENT_ID) console.log('Microsoft 365 not configured (no .env) – calendar routes answer 503, everything else works.')
  console.log(mcp ? `MCP: ${oauth ? oauth.resource : `http://${HOST}:${PORT}/mcp`} (${[MCP_TOKEN && 'token', oauth && 'OAuth'].filter(Boolean).join(' + ')})` : 'MCP: off over HTTP (set ZENDO_MCP_OAUTH=1 or ZENDO_MCP_TOKEN); stdio via npm run mcp')
  console.log(ai ? `AI: ${ai.provider} · ${ai.model} (Clarify: ${ai.clarifyModel})` : 'AI: not configured (add ANTHROPIC_API_KEY or OPENAI_API_KEY to .env)')
})
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `Port ${PORT} is already in use.\n` +
        `  Another Zendo instance is probably still running or suspended (Ctrl+Z) in a different terminal.\n` +
        `  Find it with:  ss -lptn 'sport = :${PORT}'   and stop it (fg + Ctrl+C, or kill <pid>), then start again.`,
    )
  } else console.error('Server failed to start:', err.message)
  process.exit(1)
})
