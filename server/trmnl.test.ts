import { describe, expect, it } from 'vitest'
import { openDb } from './db.ts'
import { Repo } from './repo.ts'
import { createApp } from './app.ts'
import { TrmnlService, type TrmnlConfig } from './trmnl.ts'
import { esc, renderScreens, type DisplayState } from './trmnl-screens.ts'
import { STORE_VERSION } from '../src/domain/migrations.ts'
import { DEFAULT_SETTINGS, type CalendarEvent, type PlanBlock, type Project, type Task } from '../src/domain/types.ts'

const TODAY = '2026-10-26' // a Monday
const stamp = '2026-10-01T08:00:00.000Z'
const project = (p: Partial<Project>): Project => ({ id: 'p', name: 'Projekt Nord', status: 'active', color: 'sage', createdAt: stamp, updatedAt: stamp, ...p })
const task = (t: Partial<Task>): Task => ({ id: 't', title: 'Task', projectId: null, status: 'todo', priority: 'normal', notes: [], order: 0, createdAt: stamp, updatedAt: stamp, ...t })
const event = (e: Partial<CalendarEvent>): CalendarEvent => ({ id: 'e', title: 'Jour fixe', date: TODAY, start: '09:00', end: '10:00', kind: 'online', source: 'manual', ...e })

const STATE: DisplayState = {
  projects: [project({}), project({ id: 'west', name: 'Projekt West' }), project({ id: 'home', name: 'Umzug', private: true })],
  tasks: [
    task({ id: 'offer', title: 'Angebot Nord', projectId: 'p', plannedDate: TODAY, plannedStart: '10:30', estimateMinutes: 60 }),
    task({ id: 'slides', title: 'Folien {{ prüfen }}', plannedDate: TODAY }),
    task({ id: 'done', title: 'Erledigt', plannedDate: TODAY, status: 'done' }),
    task({ id: 'invoice', title: 'Rechnung an Kunde C', dueDate: TODAY }),
    task({ id: 'call', title: 'Lieferant anrufen', status: 'next', plannedDate: '2026-10-24' }),
    task({ id: 'west-next', title: 'Interviewfragen', projectId: 'west', status: 'next' }),
    task({ id: 'secret', title: 'Wohnung besichtigen', projectId: 'home', plannedDate: TODAY }),
    task({ id: 'secret2', title: 'Arzt anrufen', private: true, plannedDate: TODAY }),
  ],
  events: [
    event({}),
    event({ id: 'coach', title: 'Coaching Frau B.', start: '13:00', end: '14:00', private: true }),
    event({ id: 'team', title: 'Abstimmung Team', start: '10:30', end: '11:00' }),
    event({ id: 'ws', title: 'Workshop Süd', date: '2026-10-28', start: '09:00', end: '17:00', kind: 'workshop' }),
  ],
  blocks: [
    { id: 'b1', date: TODAY, projectId: 'west', size: 0.5 },
    { id: 'b2', date: '2026-10-27', projectId: 'p', size: 0.25 },
    { id: 'b3', date: '2026-10-27', projectId: 'p', size: 0.5 },
    { id: 'b4', date: '2026-10-27', projectId: null, size: 0.25 },
    { id: 'b5', date: '2026-10-29', projectId: 'home', size: 0.5 },
  ] as PlanBlock[],
  settings: { ...DEFAULT_SETTINGS, locale: 'de' },
}

describe('TRMNL screens', () => {
  it('lists today’s open to-dos, deadlines and the week plan’s next steps, never private ones', () => {
    const { markup, markup_quadrant } = renderScreens('todos', STATE, TODAY, '08:15')
    for (const title of ['Angebot Nord', 'Rechnung an Kunde C', 'Lieferant anrufen', 'Liegengeblieben', 'Interviewfragen</span><span class="z-proj">Projekt West', 'Heute fällig', 'Aus dem Wochenplan', 'Stand 08:15', 'Montag, 26. Oktober']) expect(markup).toContain(title)
    for (const hidden of ['Erledigt', 'Wohnung', 'Arzt', 'Umzug']) expect(markup).not.toContain(hidden)
    expect(markup.indexOf('Angebot Nord')).toBeLessThan(markup.indexOf('Folien'))
    // TRMNL runs the markup through Liquid: braces from the data must not reach it
    expect(markup).toContain('Folien &#123;&#123; prüfen &#125;&#125;')
    expect(markup).not.toMatch(/\{\{|\{%/)
    expect(markup_quadrant).not.toContain('class="z-proj"')
  })

  it('cuts long lists and says how many more there are', () => {
    const many = { ...STATE, blocks: [], tasks: Array.from({ length: 20 }, (_, i) => task({ id: `t${i}`, title: `Aufgabe ${i}`, plannedDate: TODAY, order: i })) }
    const { markup_quadrant } = renderScreens('todos', many, TODAY, '08:15')
    expect(markup_quadrant).toContain('Aufgabe 3')
    expect(markup_quadrant).not.toContain('Aufgabe 4<')
    expect(markup_quadrant).toContain('+ 16 weitere')
  })

  it('draws the schedule with meetings, timed tasks and private appointments as busy', () => {
    const { markup, markup_quadrant } = renderScreens('schedule', STATE, TODAY, '12:00')
    expect(markup).toContain('Jour fixe')
    expect(markup).toContain('Belegt')
    expect(markup).not.toContain('Coaching')
    expect(markup).toContain('jetzt 12:00')
    // the task and the meeting at 10:30 overlap: side by side, half the width each
    expect(markup).toMatch(/class="z-task" style="[^"]*width:calc\(50% - 4px\)"><span class="z-t">Angebot Nord/)
    expect(markup).toContain('2,5 h Termine · 1,5 h geplant · 6 h frei')
    // the short list shows what is still ahead
    expect(markup_quadrant).not.toContain('Jour fixe')
    expect(markup_quadrant).toContain('Belegt')
  })

  it('shows the next five work days with blocks per project, named workshops and free hours', () => {
    const { markup, markup_quadrant } = renderScreens('week', STATE, TODAY, '08:15')
    const days = [...markup.matchAll(/class="z-day-h">([^<]+)</g)].map((m) => m[1])
    expect(days).toEqual(['Mo 26.', 'Di 27.', 'Mi 28.', 'Do 29.', 'Fr 30.'])
    expect(markup).toContain('Projekt Nord ¾')
    expect(markup).toContain('Routinen / Admin ¼')
    expect(markup).toContain('Workshop Süd')
    expect(markup).toContain('belegt')
    expect(markup).not.toContain('Umzug')
    expect(markup).toContain('KW 44')
    expect([...markup_quadrant.matchAll(/class="z-wd"/g)]).toHaveLength(3)
    // Saturday and Sunday are skipped unless something is planned
    const friday = renderScreens('week', { ...STATE, blocks: [{ id: 'sun', date: '2026-11-01', projectId: 'p', size: 0.5 }] }, '2026-10-30', '08:15').markup
    expect([...friday.matchAll(/class="z-day-h">([^<]+)</g)].map((m) => m[1])).toEqual(['Fr 30.', 'So 1.', 'Mo 2.', 'Di 3.', 'Mi 4.'])
  })

  it('escapes HTML and Liquid', () => {
    expect(esc(`<b>{% x %}</b> & "q"`)).toBe('&#60;b&#62;&#123;&#37; x &#37;&#125;&#60;/b&#62; &#38; &#34;q&#34;')
  })
})

describe('TRMNL plugin flow', () => {
  const setup = (cfg: Partial<TrmnlConfig> = {}) => {
    const db = openDb(':memory:')
    const repo = new Repo(db)
    repo.replaceAll({ version: STORE_VERSION, inbox: [], reviews: [], ...STATE, settings: STATE.settings } as never)
    const exchanged: string[] = []
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      const code = new URLSearchParams(String(init.body)).get('code')!
      exchanged.push(code)
      return new Response(JSON.stringify(code === 'bad' ? { error: true, message: 'invalid code' } : { access_token: `token-${code}` }))
    }) as unknown as typeof fetch
    const trmnl = new TrmnlService(db, repo, { allowedUsers: [], accounts: [], fetch: fakeFetch, remoteAddress: () => '127.0.0.1', today: () => TODAY, now: () => '08:15', ...cfg })
    return { app: createApp({ repo, trmnl: trmnl.routes() }), exchanged }
  }
  const host = { host: '127.0.0.1:5174' }
  const callback = 'https://trmnl.com/plugin_settings/new?playlist_item_id=7'
  const bearer = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' })
  const install = async (app: ReturnType<typeof setup>['app'], code: string, view: string, headers: Record<string, string> = host) => {
    const page = await app.request(`/trmnl/install?code=${code}&installation_callback_url=${encodeURIComponent(callback)}`, { headers })
    const request = /name="request" value="([^"]+)"/.exec(await page.text())?.[1] ?? ''
    return app.request('/trmnl/install', { method: 'POST', headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' }, body: `request=${request}&view=${view}` })
  }
  const markup = (app: ReturnType<typeof setup>['app'], token: string) => app.request('/trmnl/markup', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' }, body: 'user_uuid=u1' })

  it('installs, confirms, serves screens, switches the view and uninstalls', async () => {
    const { app, exchanged } = setup()
    const picked = await install(app, 'abc', 'schedule')
    expect(picked.status).toBe(302)
    expect(picked.headers.get('location')).toBe(callback)
    expect(exchanged).toEqual(['abc'])
    // no screen before TRMNL confirmed the installation
    expect((await markup(app, 'token-abc')).status).toBe(401)
    const ok = await app.request('/trmnl/installed', { method: 'POST', headers: bearer('token-abc'), body: JSON.stringify({ user: { email: 'n@example.de', uuid: 'u1', plugin_setting_id: 42 } }) })
    expect(ok.status).toBe(200)
    const screens = await (await markup(app, 'token-abc')).json()
    expect(Object.keys(screens).sort()).toEqual(['markup', 'markup_half_horizontal', 'markup_half_vertical', 'markup_quadrant'])
    expect(screens.markup).toContain('Zeitplan')
    expect((await markup(app, 'wrong')).status).toBe(401)

    const manage = await app.request('/trmnl/manage?uuid=u1&jwt=x', { headers: host })
    const manageHtml = await manage.text()
    expect(manageHtml).toContain('Zeigt jetzt: Zeitplan heute')
    const request = /name="request" value="([^"]+)"/.exec(manageHtml)![1]
    const saved = await app.request('/trmnl/manage', { method: 'POST', headers: { ...host, 'content-type': 'application/x-www-form-urlencoded' }, body: `request=${request}&view=week` })
    expect(await saved.text()).toContain('https://trmnl.com/plugin_settings/42/edit?force_refresh=true')
    expect((await (await markup(app, 'token-abc')).json()).markup).toContain('KW 44')

    expect((await app.request('/trmnl/uninstalled', { method: 'POST', headers: bearer('token-abc'), body: '{"user_uuid":"u1"}' })).status).toBe(200)
    expect((await markup(app, 'token-abc')).status).toBe(401)
  })

  it('lets only the signed-in owner install, and only back to TRMNL', async () => {
    const hosted = setup({ allowedUsers: ['norman@example.de'], userHeader: 'x-auth-request-email' })
    expect((await hosted.app.request(`/trmnl/install?code=a&installation_callback_url=${encodeURIComponent(callback)}`, { headers: host })).status).toBe(403)
    const other = { ...host, 'x-auth-request-email': 'other@example.de' }
    expect((await hosted.app.request(`/trmnl/install?code=a&installation_callback_url=${encodeURIComponent(callback)}`, { headers: other })).status).toBe(403)
    expect((await install(hosted.app, 'a', 'week', { ...host, 'x-auth-request-email': 'norman@example.de' })).status).toBe(302)

    const local = setup({ remoteAddress: () => '192.168.1.20' })
    expect((await local.app.request(`/trmnl/install?code=a&installation_callback_url=${encodeURIComponent(callback)}`, { headers: host })).status).toBe(403)
    const evil = setup()
    expect((await evil.app.request(`/trmnl/install?code=a&installation_callback_url=${encodeURIComponent('https://evil.example/trmnl.com')}`, { headers: host })).status).toBe(400)
    expect((await install(evil.app, 'bad', 'week')).status).toBe(502)
    expect((await install(evil.app, 'a', 'nonsense')).status).toBe(400)
  })

  it('refuses an installation completed by a foreign TRMNL account', async () => {
    const { app } = setup({ accounts: ['norman@example.de'] })
    await install(app, 'x', 'todos')
    const res = await app.request('/trmnl/installed', { method: 'POST', headers: bearer('token-x'), body: JSON.stringify({ user: { email: 'mallory@example.com', uuid: 'u9' } }) })
    expect(res.status).toBe(403)
    expect((await markup(app, 'token-x')).status).toBe(401)
    // even a later confirmation by the right account does not revive it
    expect((await app.request('/trmnl/installed', { method: 'POST', headers: bearer('token-x'), body: JSON.stringify({ user: { email: 'norman@example.de' } }) })).status).toBe(401)
  })
})
