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

## Ways to connect

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

### 2. HTTP with OAuth – Claude (web, desktop, mobile, Claude Code) as a connector

The Zendo server answers at `/mcp` (Streamable HTTP, stateless) and is its own OAuth 2.1 authorization server, as Claude's connectors expect: protected resource metadata, dynamic client registration, authorization code with S256 PKCE, access tokens for one hour, refresh tokens for 30 days that rotate on every use. Zendo keeps no passwords: approving a connection requires the login that already guards the app.

Enable it in `.env`:

```bash
ZENDO_MCP_OAUTH=1
# hosted (ZENDO_PUBLIC_URL set): who may approve, as signed in at the login proxy
ZENDO_OAUTH_USERS=you@example.com
# header in which the proxy passes the signed-in e-mail (default x-auth-request-email)
# ZENDO_OAUTH_USER_HEADER=x-auth-request-email
```

Then add `https://zendo.example.com/mcp` in Claude under Settings → Connectors → Add custom connector (Claude Code: `claude mcp add --transport http zendo https://zendo.example.com/mcp`). Claude registers itself, opens Zendo's consent page, you sign in with Microsoft (MFA) if not already, press **Allow**, and the connector is ready. Settings → AI agents in Zendo lists connected agents and disconnects them; tokens stop working at once.

Locally (no `ZENDO_PUBLIC_URL`) the endpoint is `http://127.0.0.1:5174/mcp` and only a browser on the same machine can approve – useful for Claude Code; claude.ai cannot reach localhost.

What is checked:

- Redirects: a client may register only Claude's callbacks (`https://claude.ai/api/mcp/auth_callback`, `https://claude.com/api/mcp/auth_callback`) and loopback addresses (Claude Code); others need `ZENDO_OAUTH_REDIRECTS`. A third party can therefore not have codes sent to its own server.
- Approval: hosted, only addresses in `ZENDO_OAUTH_USERS`, read from the proxy's header; with `ZENDO_PUBLIC_URL` but no `ZENDO_OAUTH_USERS` OAuth stays off. The consent page names the application and where it sends you, refuses framing, and each approval is a one-time request bound to the same user.
- Tokens: stored only as SHA-256 hashes (`oauth_tokens`). An old refresh token presented again after rotation revokes the whole connection, because that means it was copied.

#### Hosting behind Caddy and oauth2-proxy

The consent page must stay behind the login; discovery, registration, token exchange and `/mcp` must not, because Claude's servers call them without a browser session (they are protected by OAuth itself). oauth2-proxy needs `--set-xauthrequest=true` so that it returns the signed-in e-mail. In the Caddyfile of the Zendo host, before the existing `forward_auth`:

```
zendo.example.com {
	# never trust this header from the outside
	request_header -X-Auth-Request-Email

	@agent path /mcp /.well-known/oauth-protected-resource* /.well-known/oauth-authorization-server /oauth/register /oauth/token /oauth/revoke
	handle @agent {
		reverse_proxy zendo:5174
	}

	handle {
		forward_auth oauth2-proxy:4180 {
			uri /oauth2/auth
			copy_headers X-Auth-Request-Email
		}
		reverse_proxy zendo:5174
	}
}
```

(`/oauth/authorize` falls into the second block. Keep your existing redirect-to-sign-in handling there.) If Entra conditional access or a firewall restricts by IP, Claude's requests come from `160.79.104.0/21`.

### 3. HTTP with a static token – scripts and clients without OAuth

`ZENDO_MCP_TOKEN=<long random value>` (e.g. `openssl rand -hex 32`) additionally accepts `Authorization: Bearer <token>` at `/mcp`:

```bash
claude mcp add --transport http zendo https://zendo.example.com/mcp --header "Authorization: Bearer <token>"
```

The token does not expire and grants full access; prefer OAuth where the client supports it, and rotate the token by changing `.env` and restarting. Clients that only speak stdio can bridge with `npx mcp-remote <url>`.

## Options

| Variable | Effect |
|---|---|
| `ZENDO_MCP_OAUTH=1` | Enables `/mcp` with OAuth (Claude connectors). Hosted it needs `ZENDO_OAUTH_USERS`. |
| `ZENDO_OAUTH_USERS` | Comma-separated e-mail addresses that may approve connections (hosted). |
| `ZENDO_OAUTH_USER_HEADER` | Header carrying the signed-in e-mail from the login proxy; default `x-auth-request-email`. |
| `ZENDO_OAUTH_REDIRECTS` | Extra redirect URIs clients may register (comma-separated). |
| `ZENDO_MCP_TOKEN` | Enables `/mcp` with this static bearer token (also together with OAuth). |
| `ZENDO_MCP_HIDE_PRIVATE=1` | Private projects, their tasks and blocks are invisible to the agent and cannot be changed by it; private appointments show as "private". Applies to both ways. |
| `TZ` | "Today" is the server's local date. The container runs in UTC unless you set e.g. `TZ=Europe/Berlin`. |

## Things to know

- Everything the tools return is sent to the model provider of the agent. Use `ZENDO_MCP_HIDE_PRIVATE=1` if private items should stay out.
- An agent writes directly to the database. If the same task is open and edited in the browser at the same moment, the later save wins for that task (as between two browser tabs).
- Example requests: "Here are my notes from today's steering meeting – put the action items into my inbox", "What does my Thursday look like, and is there room for half a day on the offer?", "Set up a project 'Leadership workshop Metro' with the goals from this e-mail and the next action 'Ask Jana for dates'".
