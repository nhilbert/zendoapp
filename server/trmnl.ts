import { Hono, type Context } from 'hono'
import { createHash, randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Repo } from './repo.ts'
import { escapeHtml, signedInUser, simplePage } from './oauth.ts'
import { translator } from './i18n.ts'
import { renderScreens, TRMNL_VIEWS, VIEW_LABEL_KEY, type DisplayState, type TrmnlView } from './trmnl-screens.ts'
import { DEFAULT_SETTINGS, type Locale } from '../src/domain/types.ts'
import { nowHHMM, todayISO } from '../src/domain/dates.ts'

/**
 * Zendo as a TRMNL plugin (docs/trmnl.md), following TRMNL's plugin flows:
 *  - GET/POST /trmnl/install   TRMNL sends the browser here; the signed-in owner picks the view, Zendo trades the
 *                              code for an access token and returns to TRMNL. Behind the login proxy.
 *  - POST /trmnl/installed     TRMNL confirms the installation (bearer token); only then the display gets screens.
 *  - POST /trmnl/markup        a screen request (bearer token): HTML for the four TRMNL layouts.
 *  - POST /trmnl/uninstalled   TRMNL reports the plugin removed (bearer token).
 *  - GET/POST /trmnl/manage    "Configure" in TRMNL: change the view of one installation. Behind the login proxy.
 * installed, markup and uninstalled are called by TRMNL's servers and must bypass the login; they trust the token.
 */

export interface TrmnlConfig {
  /** Who may install (e-mails from the login proxy); empty = local mode, only a browser on this machine. */
  allowedUsers: string[]
  userHeader?: string
  /** TRMNL account e-mails accepted when TRMNL confirms an installation; empty = any. */
  accounts: string[]
  /** TRMNL's code exchange, injectable for tests. */
  tokenUrl?: string
  fetch?: typeof fetch
  remoteAddress?: (c: Context) => string | undefined
  /** Injectable clock for tests. */
  today?: () => string
  now?: () => string
}

const TOKEN_URL = 'https://trmnl.com/oauth/token'
const PENDING_TTL_MS = 15 * 60_000
/** An installation TRMNL never confirmed is dropped after this. */
const UNCONFIRMED_TTL_MS = 24 * 60 * 60_000

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
const isView = (v: unknown): v is TrmnlView => TRMNL_VIEWS.includes(v as TrmnlView)

/** TRMNL's own pages only: the return address comes in through a link anybody could craft. */
function isTrmnlUrl(raw: string | undefined): boolean {
  try {
    const u = new URL(raw ?? '')
    return u.protocol === 'https:' && /(^|\.)(use)?trmnl\.com$/.test(u.hostname)
  } catch {
    return false
  }
}

type Pending = { user: string; expires: number } & ({ kind: 'install'; code: string; callback: string } | { kind: 'manage'; uuid: string })

interface Connection {
  hash: string
  view: TrmnlView
  user: string
  user_uuid: string | null
  plugin_setting_id: string | null
  active: number
}

export class TrmnlService {
  private db: DatabaseSync
  private repo: Repo
  private cfg: TrmnlConfig
  private pending = new Map<string, Pending>()

  constructor(db: DatabaseSync, repo: Repo, cfg: TrmnlConfig) {
    this.db = db
    this.repo = repo
    const norm = (list: string[]) => list.map((u) => u.trim().toLowerCase()).filter(Boolean)
    this.cfg = { ...cfg, allowedUsers: norm(cfg.allowedUsers), accounts: norm(cfg.accounts), userHeader: cfg.userHeader?.toLowerCase() }
  }

  private locale(): Locale {
    return this.repo.loadState().settings?.locale ?? DEFAULT_SETTINGS.locale
  }

  private byToken(c: Context): Connection | undefined {
    const token = /^Bearer\s+(.+)$/i.exec(c.req.header('authorization') ?? '')?.[1]?.trim()
    if (!token) return undefined
    return this.db.prepare('SELECT * FROM trmnl_connections WHERE hash = ?').get(sha256(token)) as Connection | undefined
  }

  private remember(p: Pending): string {
    const id = randomBytes(24).toString('base64url')
    const now = Date.now()
    for (const [k, v] of this.pending) if (v.expires < now) this.pending.delete(k)
    this.pending.set(id, p)
    return id
  }

  /** The view picker shared by install and manage: one button per view, the current one marked. */
  private picker(action: string, request: string, current?: TrmnlView): string {
    const t = translator(this.locale())
    return (
      `<form method="post" action="${action}"><input type="hidden" name="request" value="${request}">` +
      TRMNL_VIEWS.map((v) => `<button${v === current ? ' class="ok"' : ''} name="view" value="${v}">${escapeHtml(t(VIEW_LABEL_KEY[v]))}</button>`).join('') +
      `</form><p style="color:#5d665f;font-size:.9rem">${escapeHtml(t('trmnl.installHint'))}</p>`
    )
  }

  private page(c: Context, key: string, body: string, status: 200 | 400 | 403 | 502 = 200) {
    const locale = this.locale()
    return simplePage(c, translator(locale)(key), body, status, locale)
  }

  private message(c: Context, key: string, status: 400 | 403 | 502) {
    const locale = this.locale()
    return simplePage(c, 'TRMNL', `<p>${escapeHtml(translator(locale)(key))}</p>`, status, locale)
  }

  private async exchange(code: string): Promise<string | null> {
    try {
      const res = await (this.cfg.fetch ?? fetch)(this.cfg.tokenUrl ?? TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code }).toString(),
        signal: AbortSignal.timeout(10_000),
      })
      // TRMNL answers errors with 200 and { error: true, message }.
      const body = (await res.json().catch(() => null)) as { access_token?: unknown; error?: unknown; message?: unknown } | null
      if (res.ok && typeof body?.access_token === 'string' && body.access_token && !body.error) return body.access_token
      console.error('TRMNL code exchange failed:', res.status, typeof body?.message === 'string' ? body.message : '')
    } catch (err) {
      console.error('TRMNL code exchange failed:', (err as Error).message)
    }
    return null
  }

  routes(): Hono {
    const app = new Hono()

    app.get('/install', (c) => {
      const user = signedInUser(c, this.cfg)
      if (!user) return this.message(c, 'trmnl.notAllowed', 403)
      const code = c.req.query('code')
      const callback = c.req.query('installation_callback_url')
      if (!code || !isTrmnlUrl(callback)) return this.message(c, 'trmnl.installFailed', 400)
      const request = this.remember({ kind: 'install', code, callback: callback!, user, expires: Date.now() + PENDING_TTL_MS })
      return this.page(c, 'trmnl.installTitle', this.picker('/trmnl/install', request))
    })

    app.post('/install', async (c) => {
      const form = await c.req.parseBody()
      const id = typeof form.request === 'string' ? form.request : ''
      const req = this.pending.get(id)
      this.pending.delete(id)
      if (!req || req.kind !== 'install' || req.expires < Date.now()) return this.message(c, 'trmnl.expired', 400)
      if (signedInUser(c, this.cfg) !== req.user) return this.message(c, 'trmnl.notAllowed', 403)
      if (!isView(form.view)) return this.message(c, 'trmnl.expired', 400)
      const token = await this.exchange(req.code)
      if (!token) return this.message(c, 'trmnl.installFailed', 502)
      this.db.prepare('DELETE FROM trmnl_connections WHERE active = 0 AND created_at < ?').run(new Date(Date.now() - UNCONFIRMED_TTL_MS).toISOString())
      // Re-exchanging a code returns the same token: a repeated installation replaces the earlier choice.
      this.db
        .prepare('INSERT INTO trmnl_connections(hash, view, user, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(hash) DO UPDATE SET view = excluded.view, user = excluded.user')
        .run(sha256(token), form.view, req.user, new Date().toISOString())
      return c.redirect(req.callback, 302)
    })

    app.post('/installed', async (c) => {
      const conn = this.byToken(c)
      if (!conn) return c.json({ error: 'unauthorized' }, 401)
      const body = (await c.req.json().catch(() => null)) as { user?: { email?: unknown; uuid?: unknown; plugin_setting_id?: unknown } } | null
      const email = typeof body?.user?.email === 'string' ? body.user.email.trim().toLowerCase() : ''
      if (this.cfg.accounts.length && !this.cfg.accounts.includes(email)) {
        // Somebody else's TRMNL account completed the installation: it never gets a screen.
        console.error(`TRMNL installation by ${email || 'an unknown account'} refused (not in ZENDO_TRMNL_ACCOUNTS).`)
        this.db.prepare('DELETE FROM trmnl_connections WHERE hash = ?').run(conn.hash)
        return c.json({ error: 'forbidden' }, 403)
      }
      const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : null)
      this.db
        .prepare('UPDATE trmnl_connections SET active = 1, account = ?, user_uuid = ?, plugin_setting_id = ? WHERE hash = ?')
        .run(email || null, str(body?.user?.uuid), str(body?.user?.plugin_setting_id), conn.hash)
      return c.json({ ok: true })
    })

    app.post('/uninstalled', (c) => {
      const conn = this.byToken(c)
      if (!conn) return c.json({ error: 'unauthorized' }, 401)
      this.db.prepare('DELETE FROM trmnl_connections WHERE hash = ?').run(conn.hash)
      return c.json({ ok: true })
    })

    app.post('/markup', (c) => {
      const conn = this.byToken(c)
      if (!conn?.active || !isView(conn.view)) return c.json({ error: 'unauthorized' }, 401)
      const cutoff = new Date(Date.now() - 5 * 60_000).toISOString()
      this.db.prepare('UPDATE trmnl_connections SET last_used_at = ? WHERE hash = ? AND (last_used_at IS NULL OR last_used_at < ?)').run(new Date().toISOString(), conn.hash, cutoff)
      const s = this.repo.loadState()
      const state = { projects: s.projects, tasks: s.tasks, events: s.events, blocks: s.blocks, settings: s.settings ?? {} } as unknown as DisplayState
      return c.json(renderScreens(conn.view, state, (this.cfg.today ?? todayISO)(), (this.cfg.now ?? nowHHMM)()))
    })

    // "Configure" in TRMNL opens this with ?uuid=…&jwt=…. The login in front decides who may change it, so the
    // JWT is not needed; the uuid only says which installation.
    app.get('/manage', (c) => {
      const user = signedInUser(c, this.cfg)
      if (!user) return this.message(c, 'trmnl.notAllowed', 403)
      const uuid = c.req.query('uuid') ?? ''
      const conn = uuid ? (this.db.prepare('SELECT * FROM trmnl_connections WHERE user_uuid = ? AND active = 1').get(uuid) as Connection | undefined) : undefined
      if (!conn) return this.message(c, 'trmnl.manageUnknown', 400)
      const t = translator(this.locale())
      const request = this.remember({ kind: 'manage', uuid, user, expires: Date.now() + PENDING_TTL_MS })
      return this.page(c, 'trmnl.manageTitle', `<p>${escapeHtml(t('trmnl.manageCurrent', { view: t(VIEW_LABEL_KEY[conn.view]) }))}</p>` + this.picker('/trmnl/manage', request, conn.view))
    })

    app.post('/manage', async (c) => {
      const form = await c.req.parseBody()
      const id = typeof form.request === 'string' ? form.request : ''
      const req = this.pending.get(id)
      this.pending.delete(id)
      if (!req || req.kind !== 'manage' || req.expires < Date.now() || !isView(form.view)) return this.message(c, 'trmnl.expired', 400)
      if (signedInUser(c, this.cfg) !== req.user) return this.message(c, 'trmnl.notAllowed', 403)
      this.db.prepare('UPDATE trmnl_connections SET view = ? WHERE user_uuid = ? AND active = 1').run(form.view, req.uuid)
      const conn = this.db.prepare('SELECT plugin_setting_id FROM trmnl_connections WHERE user_uuid = ?').get(req.uuid) as { plugin_setting_id: string | null } | undefined
      const t = translator(this.locale())
      // Back to the plugin's settings in TRMNL, which then asks for a fresh screen.
      const back = conn?.plugin_setting_id && /^\d+$/.test(conn.plugin_setting_id) ? `https://trmnl.com/plugin_settings/${conn.plugin_setting_id}/edit?force_refresh=true` : null
      return this.page(c, 'trmnl.manageTitle', `<p>${escapeHtml(t('trmnl.saved'))}</p>${back ? `<p><a href="${back}">${escapeHtml(t('trmnl.back'))}</a></p>` : ''}`)
    })
    return app
  }
}
