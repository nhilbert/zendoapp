# Zendo

A minimal, calm todo and planning app inspired by *Getting Things Done*, built for one person. It runs on localhost or on your own server behind a login.

- **Capture** anything into the inbox with one keystroke (`n`).
- **Clarify** the inbox one item at a time into actions, projects, meetings, someday or trash.
- **Projects** with exactly one next action each; chores for everything that is not a project.
- **Board** (kanban), **Week** (rolling two-week plan with ½-day blocks against your calendar, optionally proposed by AI), **Today** (timeline, daily list, the day's blocks and yesterday's left-overs), **Review** (daily and weekly).
- **Focus** on one project: its next action and what follows, everything else hidden.
- German and English UI, light and dark, keyboard-first, drag and drop where it helps.
- Optional AI help (bring your own Claude or ChatGPT key) for Clarify and the week plan, and Outlook calendar sync.

## Screenshots

Fictional sample data, German UI, light theme (dark theme follows the system).

![Today](docs/screenshots/today-de.png)
![Week](docs/screenshots/week-de.png)
![Clarify](docs/screenshots/clarify-de.png)
![Board](docs/screenshots/board-de.png)
![Today, dark](docs/screenshots/today-en-dark.png)

## Status

The server is the source of truth: data lives in `data/zendo.db` (SQLite) with daily backups in `data/backups/`; the browser keeps a cache and queues changes so the app keeps working when the server is down. Run it locally, or host the same container behind a login (`Dockerfile`, architecture section 11). See [docs/requirements.md](docs/requirements.md), [docs/architecture.md](docs/architecture.md) and the research notes in [docs/](docs/).

## Run it

```bash
npm install
npm run dev          # development: UI on http://127.0.0.1:5173 + server (API, database, calendar) on 5174
npm run build && npm start   # everyday use: one process serving everything on http://127.0.0.1:5174
```

Other scripts: `npm run server` (server only), `npm run mcp` (MCP server over stdio, [docs/mcp.md](docs/mcp.md)), `npm run web` (UI only, browser-only data), `npm run calendar:check` (verify the Microsoft 365 registration), `npm test`, `npm run typecheck`, `npm run hooks:install` (pre-commit guard against committing private files).

Quick capture from anywhere on this machine (CLI, scripts, a bookmarklet):

```bash
curl -s -X POST http://127.0.0.1:5174/api/inbox -H 'content-type: application/json' -H 'x-zendo: 1' -d '{"text":"Call Jana about the follow-up"}'
```

AI agents (Claude Desktop, Claude Code …) can work with Zendo through its MCP server: capture into the inbox from meeting notes or e-mails, read and adapt the day and week plan, manage tasks and projects. `npm run mcp` for a local agent, or `/mcp` on the server with OAuth (`ZENDO_MCP_OAUTH=1`, works as a Claude connector) – see [docs/mcp.md](docs/mcp.md).

Your plan can also appear on a [TRMNL](https://trmnl.com) e-ink display: three screens (today's to-dos, today's schedule, the week), installed from TRMNL as a plugin (`ZENDO_TRMNL=1`) – see [docs/trmnl.md](docs/trmnl.md).

To see your Outlook calendar in Zendo, register an app once ([docs/outlook-setup.md](docs/outlook-setup.md)), put the two IDs into `.env`, start `npm run dev` and press **Connect Microsoft 365** in Settings. The sign-in tokens stay in `data/` (gitignored).

The first start loads fictional sample data so you can explore. Settings → Data shows the connection to the local server and lets you clear everything, export/import JSON, or reload the sample. If you used the browser-only prototype before, its data is pushed to the server on the first start; if the server already holds different data, Zendo asks which side to keep and keeps a copy of the browser's data. Note that `localhost:5173` and `127.0.0.1:5173` are separate browser storages.

## Keyboard

| Key | Action |
|---|---|
| `n` | Capture to inbox |
| `g` then `t` / `w` / `i` / `c` / `p` / `b` / `r` | Go to Today / Week / Inbox / Clarify / Projects / Board / Review |
| `1`–`6` | On Clarify: choose the kind |
| `Esc` | Close dialogs and the task drawer; end focus mode |

## Privacy

This repository is public. Personal data never belongs in it:

- App data stays in the gitignored `data/` folder (SQLite database, backups, Microsoft token cache).
- API keys live in the server's `.env` (gitignored) and never reach the browser; a key stored in the browser remains only as a fallback for Clarify and is excluded from exports.
- The Microsoft 365 token cache lives in `data/msal-cache.json` and is gitignored. Delete it (or press Disconnect) to sign out.
- `.gitignore` already covers `data/`, `*.db`, `*.ics`, `.env*` and MSAL token caches. Keep it that way.
- Sample data is fictional. Use it for screenshots.

## Licence

MIT – see [LICENSE](LICENSE).
