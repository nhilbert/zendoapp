# Zendo for AI agents (MCP)

Zendo includes an [MCP](https://modelcontextprotocol.io) server. An agent such as Claude (claude.ai, Desktop, mobile, Claude Code) can work with the same data as the app:

- **capture** into the inbox from meeting notes, e-mails or a conversation,
- **read and adapt the plan** for a day or a week,
- **create and change tasks**,
- **set up and maintain projects** (goals, notes, status, next action),
- **write review notes** for the day or the week.

The tools apply the app's rules, so the data stays consistent with what the app itself would do. Changes appear in the browser the next time the window gets focus.

Example requests:

- "Here are my notes from today's steering meeting – put the action items into my inbox."
- "What does my Thursday look like? Is there room for half a day on the Metro offer?"
- "Move everything planned for Friday that isn't due to next Monday."
- "Set up a project 'Leadership workshop Metro' with the goals from this e-mail; next action: ask Jana for dates."
- "Add to the notes of the Coaching A project: session 3 – agreed on a 360° feedback."

Contents: [Choosing a connection](#choosing-a-connection) · [Connecting](#connecting) · [Hosting behind the login proxy](#hosting-behind-caddy-and-oauth2-proxy) · [Configuration](#configuration) · [Tools](#tool-reference) · [Rules](#rules-the-tools-enforce) · [Security model](#security-model) · [Operations](#operations) · [Troubleshooting](#troubleshooting) · [Limitations](#limitations)

## Choosing a connection

| Situation | Use | Authentication |
|---|---|---|
| Claude on the web, desktop or phone, with the hosted Zendo | [Connector over OAuth](#claude-as-a-connector-oauth) | Microsoft sign-in at your login proxy, then **Allow** in Zendo |
| Claude Code or Claude Desktop on the machine that holds `data/zendo.db` | [stdio](#local-process-stdio) | none; whoever can start the process can read the file anyway |
| Claude Code against a Zendo on `127.0.0.1` | [Local OAuth](#local-oauth-claude-code) | **Allow** in a browser on the same machine |
| Scripts or clients without OAuth | [Static token](#static-token) | `Authorization: Bearer <token>` |

The connector (OAuth) is the recommended way for everything that reaches Zendo over the network.

## Connecting

### Claude as a connector (OAuth)

Prerequisites: Zendo is hosted behind Caddy and oauth2-proxy as in [architecture section 11](architecture.md), and the routes below are in place ([Hosting](#hosting-behind-caddy-and-oauth2-proxy)).

1. In the server's `.env`:

   ```bash
   ZENDO_MCP_OAUTH=1
   ZENDO_OAUTH_USERS=you@example.com   # the address you sign in with at the proxy
   TZ=Europe/Berlin                    # "today" for the plan tools
   ```

   Restart the container. The log shows `MCP: https://zendo.example.com/mcp (OAuth)`.
2. In Claude: Settings → Connectors → **Add custom connector**, URL `https://zendo.example.com/mcp`. Leave client ID and secret empty.
3. Claude opens Zendo's consent page. Sign in with Microsoft if asked, check that it names Claude and `claude.ai` as the destination, press **Allow**.
4. Zendo → Settings → **AI agents (MCP)** now lists the connection.

Claude Code works against the same URL: `claude mcp add --transport http zendo https://zendo.example.com/mcp`, then `/mcp` in Claude Code to sign in.

### Local process (stdio)

`npm run mcp` speaks MCP on stdin/stdout and opens `data/zendo.db` (or `$ZENDO_DATA_DIR/zendo.db`) directly. It can run next to the Zendo server; SQLite (WAL, busy timeout) serialises the writes.

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

### Local OAuth (Claude Code)

With `ZENDO_MCP_OAUTH=1` and no `ZENDO_PUBLIC_URL`, the endpoint is `http://127.0.0.1:5174/mcp`. Approval is possible only from a browser on the same machine: both the connecting socket and the `Host` header must be loopback. claude.ai cannot use this, because its servers cannot reach your localhost.

### Static token

`ZENDO_MCP_TOKEN=$(openssl rand -hex 32)` in `.env` makes `/mcp` additionally accept `Authorization: Bearer <token>`:

```bash
claude mcp add --transport http zendo https://zendo.example.com/mcp --header "Authorization: Bearer <token>"
```

The token never expires and grants full access. Use it only where OAuth is not possible, and rotate it by changing `.env` and restarting. Clients that only speak stdio can bridge with `npx mcp-remote <url>`.

## Hosting behind Caddy and oauth2-proxy

The consent page must stay behind the login. Discovery, registration, token exchange, revocation and `/mcp` must be reachable without it, because Claude's servers call them without a browser session; they are protected by OAuth itself.

| Path | Login proxy | Why |
|---|---|---|
| `/oauth/authorize` | **behind** `forward_auth` | the human approval; Zendo reads the signed-in e-mail from the proxy |
| `/mcp` | bypass | needs an OAuth access token (or the static token) |
| `/.well-known/oauth-protected-resource*`, `/.well-known/oauth-authorization-server` | bypass | public metadata |
| `/oauth/register`, `/oauth/token`, `/oauth/revoke` | bypass | OAuth protocol endpoints, need a registered client, a code with PKCE or a token |
| everything else (UI, `/api/*`) | behind `forward_auth` | unchanged |

oauth2-proxy must return the e-mail of the signed-in user: start it with `--set-xauthrequest=true` (config file: `set_xauthrequest = true`).

Caddyfile of the Zendo host (adapt names and ports; keep your existing sign-in redirect handling in the second block):

```
zendo.example.com {
	# never trust this header from outside: only the proxy's answer may set it
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

Checklist after deploying:

- `curl -i https://zendo.example.com/mcp -X POST` → `401` with `WWW-Authenticate: Bearer resource_metadata="…"`.
- `curl https://zendo.example.com/.well-known/oauth-authorization-server` → JSON, no redirect to Microsoft.
- `curl -i -H 'X-Auth-Request-Email: you@example.com' 'https://zendo.example.com/oauth/authorize?client_id=x'` → the proxy's answer (redirect to the Microsoft sign-in or `401`), **not** Zendo's "Unknown client" page. If you get a Zendo page, the consent route is outside the login and the header can be forged – fix the Caddyfile before enabling OAuth.
- The Zendo container publishes no port: it must be reachable only through Caddy (`docker ps` shows no `0.0.0.0:5174->`).
- If Entra conditional access or a firewall restricts by IP: Claude's requests come from `160.79.104.0/21`.

## Configuration

| Variable | Default | Effect |
|---|---|---|
| `ZENDO_MCP_OAUTH` | off | `1` enables OAuth and `/mcp`. Hosted it requires `ZENDO_OAUTH_USERS`, otherwise it stays off (logged). |
| `ZENDO_OAUTH_USERS` | – | Comma-separated e-mail addresses that may approve connections (case-insensitive). Empty = local mode. |
| `ZENDO_OAUTH_USER_HEADER` | `x-auth-request-email` | Header carrying the signed-in e-mail from the login proxy. |
| `ZENDO_OAUTH_REDIRECTS` | – | Extra redirect URIs clients may register, comma-separated. Claude's callbacks and loopback are always allowed. |
| `ZENDO_MCP_TOKEN` | – | Static bearer token for `/mcp`; works with or without OAuth. |
| `ZENDO_MCP_HIDE_PRIVATE` | off | `1`: private projects, their tasks and blocks and private tasks are invisible to the agent and cannot be changed by it; private appointments show as "private". Applies to all connections. |
| `ZENDO_PUBLIC_URL` | – | Public origin; becomes the OAuth issuer and the resource `…/mcp`. Must be exactly the URL entered in Claude. |
| `TZ` | system (UTC in the container) | Local date used for "today". Set `Europe/Berlin`. |

Token lifetimes: access token 1 hour, refresh token 30 days (renewed with every refresh, so an agent in regular use stays connected). Authorization codes live 60 seconds, the consent page 10 minutes.

## Tool reference

Conventions:

- **Projects** can be given by id or by name: exact (case-insensitive) first, current projects before archived ones, else a unique partial match. Ambiguous names return an error listing the candidates with ids.
- **Dates** are `YYYY-MM-DD` in Zendo's local time zone, times `HH:mm`.
- **Updates** change only the fields you pass; `null` clears a field.
- **Errors** (unknown id, invalid date, rule violation) come back as a tool result with `isError` and a message the agent can act on.
- **Kind** is the MCP annotation clients use to decide whether to ask before a call: *read* never changes data, *write* only adds or changes reversibly, *destructive* may delete or overwrite something you wrote.

### Inbox

| Tool | Kind | Parameters | What it does |
|---|---|---|---|
| `inbox_list` | read | – | Unprocessed items, oldest first. |
| `inbox_add` | write | `items[]` | Captures one item per text. Meant for meeting notes and e-mails: one self-contained sentence per actionable point. |
| `inbox_update` | destructive | `id`, `text` | Rewrites an item. |
| `inbox_clarify` | destructive | `id`, `into` = `task` \| `project` \| `delete`, `task{…}`, `project{…}` | Turns an item into a task (fields as `task_create`) or a project (fields as `project_create`), or drops it. The item text is the default title/name. |

### Tasks

| Tool | Kind | Parameters | What it does |
|---|---|---|---|
| `task_list` | read | `project` (null = chores), `status[]`, `query`, `dueBefore`, `plannedOn`, `includeDone`, `limit` (default 100) | Finds tasks; without filters all open ones. Returns `total` and the tasks. |
| `task_get` | read | `id` | One task with full description and notes. |
| `task_create` | write | `title`, `project`, `status`, `priority`, `estimateMinutes`, `dueDate`, `plannedDate`, `plannedStart`, `waitingFor`, `recurrence`, `description`, `private` | Creates a task. `status: next` makes it the project's next action; `status: done` logs it as completed. |
| `task_create_many` | write | `tasks[]` (same fields) | Several tasks in one change, e.g. agreed action items. |
| `task_update` | destructive | `id` + any field above, `title` | Changes a task. `status: done` completes it (recurring tasks spawn the next occurrence); reopening restores the previous status. |
| `task_complete` | write | `id`, `done` (default true) | Completes or reopens. Says when the project is left without a next action. |
| `task_add_note` | write | `id`, `text` | Appends a dated note. |
| `task_schedule` | write | `ids[]`, `date` (null = off the plan), `start` | Plans tasks for a day; a start time only when scheduling one task. |
| `task_delete` | destructive | `id` | Deletes for good. Agents are told to prefer completing or `someday`. |

### Projects

| Tool | Kind | Parameters | What it does |
|---|---|---|---|
| `project_list` | read | `status[]` (default active, planned) | Name, headline goal, deadline, next action (or `missingNextAction`), open task count, next meeting. |
| `project_get` | read | `project` | Goals, notes, open tasks, last 10 done, upcoming meetings, planned blocks. |
| `project_create` | write | `name`, `status` (default active), `goals[]`, `notes`, `dueDate`, `color`, `private`, `nextAction`, `tasks[]` | Sets up a project; `nextAction` becomes its `next` task, `tasks` are added as `todo`. |
| `project_update` | destructive | `project`, `name`, `status`, `goals[]` (replaces), `notes` (replaces, null clears), `appendNotes` (adds a paragraph), `dueDate`, `color`, `private` | Changes project information. Archive by setting `status: archived`; projects are never deleted through MCP. |

### Plan

| Tool | Kind | Parameters | What it does |
|---|---|---|---|
| `plan_day` | read | `date` (default today) | Calendar, blocks, planned tasks (by time), due today, overdue, left-overs from earlier days, next actions of the day's blocked projects, next chores, capacity (work, meeting, block and free minutes, overplanned), the day's review notes. |
| `plan_week` | read | `start` (default today), `days` (1–28, default 7) | Per day: meetings, blocks, planned tasks, free minutes, overplanned/full day; deadlines in the range; active projects without a next action; work-week settings. |
| `plan_add_block` | write | `date`, `project` (null = chores/admin), `size` (0.25 \| 0.5 \| 0.75 \| 1 day, default 0.5), `note` | Reserves part of a day for an active project. |
| `plan_update_block` | destructive | `id`, `date`, `project`, `size`, `note` | Moves, resizes or reassigns a block. |
| `plan_remove_block` | destructive | `id` | Removes a block. |

### Review notes

| Tool | Kind | Parameters | What it does |
|---|---|---|---|
| `review_get` | read | `kind` = `daily` \| `weekly`, `date` | Notes of a day, or of the week (Monday) containing the date. |
| `review_save` | destructive | `kind`, `notes`, `date`, `append` | Writes the notes; `append: true` adds a paragraph instead of replacing. |

Calendar events are read-only: they come from Outlook and appear in `plan_day`, `plan_week` and `project_get`.

## Rules the tools enforce

The tools share their rules with the app (`src/domain/taskRules.ts`, `src/domain/selectors.ts`):

- At most one `next` task per project; setting another demotes the previous one to `todo` – also a private one hidden from the agent.
- Completing a recurring task creates the next occurrence with shifted dates; reopening removes it again.
- No new tasks in, and no moving tasks into, archived projects.
- Blocks only for `active` projects; sizes ¼, ½, ¾ or 1 day.
- Project names are unique among current projects (archived ones may repeat a name).
- Capacity and "overplanned" are computed exactly as in Week and Today.

The server also sends the agent short instructions on connect: capture uncertain items into the inbox rather than creating tasks, read the plan before changing it, prefer small reversible changes and report them.

## Security model

### What protects what

| Asset / path | Protection |
|---|---|
| Web UI and `/api/*` | Login proxy (Microsoft Entra ID, MFA) plus the `x-zendo` header check |
| Approving an agent (`/oauth/authorize`) | Login proxy **and** `ZENDO_OAUTH_USERS`; locally: loopback socket and Host |
| Calling tools (`/mcp`) | Bearer access token issued after your approval (or the static token) |
| Obtaining tokens (`/oauth/token`) | Registered client + single-use 60-second code + S256 PKCE verifier, or a valid refresh token |
| Stored credentials | Only SHA-256 hashes of tokens in `oauth_tokens`; no client secrets exist |
| stdio | File system access to `data/` |

### Is OAuth more secure than the static token?

Not in cryptographic strength – both are 256-bit random values. The gain is in the lifecycle:

- **Human approval with MFA.** A token exists only after you signed in and pressed Allow; the static token is a value that anyone holding it can use.
- **Short-lived and rotating.** Access tokens expire after an hour. Each refresh token works once; if an already used refresh token is presented again later, Zendo assumes it was copied and revokes the whole connection.
- **Revocable per agent** in Settings, effective immediately, without restarting or reconfiguring other clients.
- **Narrow redirects.** Clients may register only Claude's callbacks (`https://claude.ai/api/mcp/auth_callback`, `https://claude.com/api/mcp/auth_callback`) and loopback addresses, so a third party cannot have authorization codes delivered to its own server.

What OAuth adds in exposure:

- Four endpoints reachable without login (metadata, register, token, revoke). They hand out nothing without your approval. Registration is open by design (Claude registers itself); idle registrations expire after 15 minutes and are capped, so a flood cannot block new connections.
- **Consent phishing.** Someone could start a connection and get you to press Allow. The page names the application and the destination host and warns when the destination is a program on your computer. Approve only connections you just started yourself.
- **Proxy configuration becomes part of the security.** If `/oauth/authorize` is reachable without the login, or the container port is reachable without Caddy, the e-mail header can be forged. The [checklist](#hosting-behind-caddy-and-oauth2-proxy) tests exactly this.

What neither protects against:

- An approved agent has **full read and write access**; there are no read-only scopes yet. The tool annotations let Claude ask before destructive calls, but that is a client decision.
- Everything a tool returns is sent to the agent's model provider. Use `ZENDO_MCP_HIDE_PRIVATE=1` if private items should never leave the server.
- Text from e-mails or notes that the agent processes can contain instructions (prompt injection). The agent then acts with your permissions. Review what it reports it changed; daily backups (`data/backups/`) allow restoring.

## Operations

- **Disconnect an agent:** Zendo → Settings → AI agents → Disconnect. All its tokens stop working at once; it must be approved again.
- **Disconnect all:** stop Zendo, `sqlite3 data/zendo.db 'DELETE FROM oauth_tokens; DELETE FROM oauth_clients;'`, start again.
- **Rotate the static token:** change `ZENDO_MCP_TOKEN` in `.env`, restart.
- **Turn MCP off:** remove `ZENDO_MCP_OAUTH` and `ZENDO_MCP_TOKEN`, restart; `/mcp` then answers 404 and the OAuth routes no longer exist. Existing token rows become inert.
- **Backups** contain the token hashes; they cannot be turned back into tokens.
- **Concurrent edits:** the agent writes directly to the database. If you edit the same task in the browser at the same moment, the later save wins for that task (as between two browser tabs).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Claude: "Couldn't reach the MCP server", Zendo log shows nothing | `/mcp` or the metadata is behind the login proxy, which answers with a redirect | Add the `@agent` route ([Hosting](#hosting-behind-caddy-and-oauth2-proxy)); check the first two checklist items |
| Consent page says "Your account may not approve connections" | E-mail not in `ZENDO_OAUTH_USERS`, or the proxy does not pass it | Check the address; `--set-xauthrequest=true`; `copy_headers X-Auth-Request-Email` |
| Consent page says "only … on the computer running Zendo" while hosted | `ZENDO_PUBLIC_URL` not set, so Zendo runs in local mode | Set `ZENDO_PUBLIC_URL` and `ZENDO_OAUTH_USERS` |
| Log: `ZENDO_MCP_OAUTH=1 needs ZENDO_OAUTH_USERS …` | Hosted without an allow-list; OAuth stays off on purpose | Set `ZENDO_OAUTH_USERS` |
| "Invalid redirect" on the consent page | The client registered a redirect URI that is not Claude's or loopback | Add it to `ZENDO_OAUTH_REDIRECTS` if you trust that client |
| Claude reports `invalid_target` | The URL entered in Claude differs from `ZENDO_PUBLIC_URL` + `/mcp` (other host, `http`, trailing path) | Enter exactly `https://<ZENDO_PUBLIC_URL host>/mcp` |
| Connector worked, now asks to sign in again | Refresh token expired (30 days unused), was revoked in Settings, or replayed | Reconnect; if you did not disconnect it, look at who else might hold the token |
| Plan shows the wrong "today" around midnight | Container in UTC | `TZ=Europe/Berlin` |
| Agent changes do not show in the browser | The browser refreshes on window focus | Click into the Zendo window or reload |

## Limitations

- No read-only or per-area scopes; one approval grants everything.
- No CIMD (Client ID Metadata Documents); Claude falls back to dynamic registration, which it supports.
- Calendar events cannot be created or changed through MCP.
- Projects cannot be deleted through MCP (archive instead).
- Pending consent requests and authorization codes are kept in memory: a restart during sign-in means starting the connection again.
