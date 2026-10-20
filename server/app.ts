import { Hono } from 'hono'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import { BadRequest, type Repo, validateChanges, validateSnapshot } from './repo.ts'
import { guard } from './guard.ts'
import { STORE_VERSION } from '../src/domain/migrations.ts'

export interface AppOptions {
  repo: Repo
  calendar?: Hono
  /** Directory with the built client (dist). When set, the server serves the UI too. */
  staticDir?: string
}

export function createApp({ repo, calendar, staticDir }: AppOptions): Hono {
  const app = new Hono()

  app.get('/api/health', (c) => c.json({ ok: true, version: STORE_VERSION, initialized: repo.isInitialized() }))
  app.use('/api/*', guard)
  app.onError((err, c) => {
    if (err instanceof BadRequest) return c.json({ error: err.message }, 400)
    console.error('API error:', err)
    return c.json({ error: err.message ?? 'error' }, 500)
  })

  app.get('/api/state', (c) => c.json({ ...repo.loadState(), initialized: repo.isInitialized(), changedAt: repo.changedAt() }))
  app.put('/api/state', async (c) => {
    repo.replaceAll(validateSnapshot(await c.req.json()))
    return c.json({ ok: true, changedAt: repo.changedAt() })
  })
  app.post('/api/changes', async (c) => {
    const result = repo.applyChanges(validateChanges(await c.req.json()))
    return c.json({ ok: true, ...result, changedAt: repo.changedAt() })
  })
  app.post('/api/inbox', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { text?: unknown }
    if (typeof body.text !== 'string' || !body.text.trim()) throw new BadRequest('text required')
    return c.json({ ok: true, item: repo.addInboxItem(body.text) }, 201)
  })

  if (calendar) app.route('/api/calendar', calendar)
  app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404))

  if (staticDir) {
    app.use('/*', serveStatic({ root: staticDir }))
    const index = path.join(staticDir, 'index.html')
    app.get('*', async (c) => c.html(await readFile(index, 'utf8')))
  }
  return app
}
