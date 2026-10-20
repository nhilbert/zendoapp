import { describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { openDb } from './db.ts'
import { Repo } from './repo.ts'
import { createApp } from './app.ts'
import { mcpRoutes } from './mcp.ts'

const TOKEN = 'test-token'

function connect(app: ReturnType<typeof createApp>, token = TOKEN) {
  const transport = new StreamableHTTPClientTransport(new URL('http://127.0.0.1:5174/mcp'), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
    fetch: (url, init) => app.request(String(url), init as RequestInit),
  })
  const client = new Client({ name: 'test', version: '1' })
  return { client, ready: client.connect(transport) }
}

const json = (r: unknown) => JSON.parse((r as { content: { text: string }[] }).content[0].text)

describe('MCP endpoint', () => {
  const repo = new Repo(openDb(':memory:'))
  const app = createApp({ repo, mcp: mcpRoutes(repo, TOKEN) })

  it('rejects requests without the token', async () => {
    const res = await app.request('/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(res.status).toBe(401)
    const { ready } = connect(app, 'wrong')
    await expect(ready).rejects.toThrow()
  })

  it('lists the tools and captures into the inbox', async () => {
    const { client, ready } = connect(app)
    await ready
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['inbox_add', 'task_create', 'project_update', 'plan_day', 'plan_week', 'review_save']))
    await client.callTool({ name: 'inbox_add', arguments: { items: ['From the meeting: send minutes'] } })
    expect(repo.loadState().inbox.map((i) => i.text)).toEqual(['From the meeting: send minutes'])
    const p = json(await client.callTool({ name: 'project_create', arguments: { name: 'Board retreat', nextAction: 'Ask for dates' } }))
    expect(p.nextAction.title).toBe('Ask for dates')
    await client.close()
  })

  it('returns validation problems as tool errors', async () => {
    const { client, ready } = connect(app)
    await ready
    const r = await client.callTool({ name: 'task_create', arguments: { title: 'x', project: 'does not exist' } })
    expect(r.isError).toBe(true)
    expect(json(r).error).toMatch(/no project/)
    await client.close()
  })
})
