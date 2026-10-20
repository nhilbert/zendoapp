# Zendo for AI agents (MCP)

Zendo includes an [MCP](https://modelcontextprotocol.io) server, so an agent such as Claude Desktop or Claude Code can work with the same data as the app: capture into the inbox (from meeting notes, e-mails …), read and adapt the day and week plan, create and change tasks, and set up and maintain projects. The tools apply the app's rules (one next action per project, recurring tasks spawn their next occurrence, blocks only for active projects). Changes appear in the browser the next time the window gets focus.

## Tools

| Area | Tools |
|---|---|
| Inbox | `inbox_list`, `inbox_add` (several items at once), `inbox_update`, `inbox_clarify` (→ task, project, or delete) |
| Tasks | `task_list` (filters: project, status, text, due before, planned on), `task_get`, `task_create`, `task_create_many`, `task_update` (null clears a field), `task_complete`, `task_add_note`, `task_schedule`, `task_delete` |
| Projects | `project_list`, `project_get` (goals, notes, tasks, meetings, blocks), `project_create` (with next action and further tasks), `project_update` (goals, notes or appended notes, status, deadline …) |
| Plan | `plan_day` (calendar, blocks, planned/due/overdue tasks, left-overs, suggestions, capacity), `plan_week` (1–28 days), `plan_add_block`, `plan_update_block`, `plan_remove_block` |
| Notes | `review_get`, `review_save` (daily or weekly review notes, replace or append) |

Projects can be named by id or by name. Calendar events are read-only (they come from Outlook); projects are archived rather than deleted.

## Two ways to connect

### 1. stdio – the agent starts a local process (simplest, same machine as the data)

`npm run mcp` speaks MCP on stdin/stdout and opens `data/zendo.db` (or `$ZENDO_DATA_DIR/zendo.db`) directly; it can run while the Zendo server runs.

Claude Code:

```bash
claude mcp add zendo -- npm --prefix /path/to/zendoapp run --silent mcp
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "zendo": {
      "command": "node",
      "args": ["--no-warnings", "/path/to/zendoapp/server/mcp-stdio.ts"],
      "env": { "ZENDO_DATA_DIR": "/path/to/zendoapp/data" }
    }
  }
}
```

### 2. HTTP – the Zendo server answers at `/mcp` (works for the hosted server too)

Set a long random token in `.env` and restart the server:

```bash
echo "ZENDO_MCP_TOKEN=$(openssl rand -hex 32)" >> .env
```

The endpoint is `http://127.0.0.1:5174/mcp` (Streamable HTTP, stateless) and requires `Authorization: Bearer <token>`. Without `ZENDO_MCP_TOKEN` the route does not exist.

Claude Code:

```bash
claude mcp add --transport http zendo https://zendo.example.com/mcp --header "Authorization: Bearer <token>"
```

Clients that only speak stdio can bridge with `npx mcp-remote https://zendo.example.com/mcp --header "Authorization: Bearer <token>"`.

Hosted behind Caddy and oauth2-proxy (architecture section 11), `/mcp` must bypass the login gate, because an agent cannot do the browser sign-in; the bearer token protects it instead. In the Caddyfile, before the `forward_auth` block of the Zendo host:

```
handle /mcp {
	reverse_proxy zendo:5174
}
```

Treat the token like a password: whoever holds it can read and change all Zendo data. Rotate it by changing `.env` and restarting.

## Options

| Variable | Effect |
|---|---|
| `ZENDO_MCP_TOKEN` | Enables `/mcp` on the server with this bearer token. |
| `ZENDO_MCP_HIDE_PRIVATE=1` | Private projects, their tasks and blocks are invisible to the agent and cannot be changed by it; private appointments show as "private". Applies to both ways. |
| `TZ` | "Today" is the server's local date. The container runs in UTC unless you set e.g. `TZ=Europe/Berlin`. |

## Things to know

- Everything the tools return is sent to the model provider of the agent. Use `ZENDO_MCP_HIDE_PRIVATE=1` if private items should stay out.
- An agent writes directly to the database. If the same task is open and edited in the browser at the same moment, the later save wins for that task (as between two browser tabs).
- Example requests: "Here are my notes from today's steering meeting – put the action items into my inbox", "What does my Thursday look like, and is there room for half a day on the offer?", "Set up a project 'Leadership workshop Metro' with the goals from this e-mail and the next action 'Ask Jana for dates'".
