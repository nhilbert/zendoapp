# Zendo – Plan and architecture

Status 2026-10-19. The first prototype (iteration 0) is a client-only React app with browser storage, built to validate the design. This document describes the target architecture of the local web application and the path from the prototype to it.

## 1. Decisions in brief

| # | Decision | Why |
|---|---|---|
| D1 | **Single local process**: one Node.js server on `127.0.0.1` serves the built frontend and a JSON API. | One command to start, nothing exposed to the network, simplest possible operations for a single user. |
| D2 | **SQLite file** in `data/zendo.db` as the system of record, with daily rotating backups in `data/backups/`. | Durable, inspectable, trivially backed up; no database server. |
| D3 | **Frontend stays the prototype's stack** (React 19, TypeScript, Vite, Tailwind v4 tokens, Zustand, dnd-kit, i18next). The store's actions become API calls; components do not change. | The prototype already separates domain, store and UI; the design work carries over unchanged. |
| D4 | **Microsoft 365 calendar via Microsoft Graph on the server** (`@azure/msal-node`, auth code + PKCE, loopback redirect, delegated `Calendars.Read`). Published-ICS feed as a fallback. | Research shows Graph is the only robust route (expanded recurrences, no CORS, encrypted token cache); EWS is being retired and ICS feeds truncate series. |
| D5 | **AI calls run on the server** with the official SDKs (`@anthropic-ai/sdk`, `openai`), key in `.env`/local secret store, never in the browser. | Keeps keys out of browser storage and lets the server add context (projects, calendar) without shipping it to the client. The prototype's browser-direct call is a stand-in. |
| D6 | **All user-facing strings in translation files**; locale-aware formatting through `Intl`. | Multilingual from the start, German default for the owner, English for the repository. |
| D7 | **Privacy by structure**: `data/`, `.env*`, `*.ics`, `*.db`, MSAL caches gitignored; sample data fictional; no client secret ever created (public client). | The repository is public. |

## 2. Target topology

```
┌───────────────────────── your machine ─────────────────────────┐
│                                                                 │
│  Browser  ──http://127.0.0.1:5173──▶  Zendo server (Node 24)    │
│  (React SPA, built assets)            ├─ static files (dist/)   │
│                                       ├─ /api/*  JSON (Hono)    │
│                                       ├─ calendar sync job      │
│                                       ├─ AI proxy               │
│                                       └─ SQLite  data/zendo.db  │
│                                              │                  │
└──────────────────────────────────────────────┼──────────────────┘
                                               │ outbound only, user-configured
                          ┌────────────────────┼───────────────────┐
                          ▼                    ▼                   ▼
                 Microsoft Graph        Anthropic API         OpenAI API
                 (calendarView)         (claude-opus-5-5)     (model of choice)
```

- **Server:** Node 24, TypeScript, [Hono](https://hono.dev) (tiny, typed router) or Fastify. Starts with `npm run start`, opens the browser, binds to loopback only. The calendar service in `server/calendar.mjs` (plain Node, port 5174, proxied by Vite under `/api`) is its seed: the Graph integration moves into the server unchanged.
- **Storage:** SQLite through `node:sqlite` (built into Node 22.5+/24, no native build) behind a small repository layer; `better-sqlite3` is the fallback if `node:sqlite` proves immature. Migrations as numbered SQL files applied at startup.
- **Frontend:** the current `src/` tree, built with Vite into `dist/` and served by the server in production; in development `vite` proxies `/api` to the server.
- **Jobs:** calendar sync every 15 minutes and on demand; backup once per day at first start; both in-process (no cron).

## 3. Repository layout (target)

```
zendoapp/
├─ docs/                    requirements, research, architecture, decisions
├─ src/                     frontend (React)
│  ├─ domain/               types, pure selectors, date helpers, ics parser
│  ├─ store/                Zustand store (actions = API surface), UI state
│  ├─ i18n/                 en.json, de.json, typed keys
│  ├─ ai/                   provider settings (prototype: direct calls)
│  ├─ components/           shell, primitives, task bits, dnd wrappers
│  └─ pages/                Inbox, Clarify, Today, Week, Projects, Board, Review, Settings
├─ server/                  (iteration 2) Hono app, routes, repositories, jobs
│  ├─ db/migrations/        0001_init.sql …
│  ├─ routes/               inbox, tasks, projects, events, blocks, reviews, settings, ai, calendar
│  ├─ integrations/         graph.ts (MSAL + calendarView), ics.ts, anthropic.ts, openai.ts
│  └─ index.ts
├─ data/                    gitignored: zendo.db, backups/, msal-cache.json
├─ .env.example             CLIENT_ID, TENANT_ID, ANTHROPIC_API_KEY, OPENAI_API_KEY (values empty)
└─ package.json             workspaces or two scripts (dev:web, dev:server)
```

## 4. Domain model

Implemented in `src/domain/types.ts`; the SQLite schema mirrors it one table per entity.

- **inbox_items** (id, text, created_at)
- **projects** (id, name, notes, status, color, due_date, private, created_at, updated_at) · **project_goals** (id, project_id, position, text)
- **tasks** (id, title, description, project_id nullable, status, priority, estimate_minutes, due_date, planned_date, planned_start, waiting_for, recurrence, order, created_at, updated_at, completed_at)
- **task_notes** (id, task_id, text, created_at)
- **events** (id, title, date, start, end, all_day, kind, availability [busy|free|tentative|oof], location, project_id, source, external_id)
- **plan_blocks** (id, date, project_id nullable, size, note)
- **reviews** (id, kind, date, notes, updated_at)
- **settings** (key, value)

Invariants (enforced in the store today, in the server tomorrow):
1. At most one task with status `next` per project (`projectId !== null`). Promoting demotes the previous one to `todo`.
2. Every active project *should* have one `next` task; the UI surfaces violations (projects list, Today, reviews) but never blocks.
3. `dueDate` and `plannedDate` are independent; `plannedStart` requires `plannedDate`.
4. Completed tasks keep their dates; reviews read `completedAt` in local time.
5. Block sizes are fractions of `settings.dayCapacityHours`. Week load = uncovered meetings + Σ per project max(block, that project's meetings); Today load = all meetings + planned task estimates.
6. Only events with availability other than `free` block time. A workshop of five hours or more, or any all-day busy event, blocks the whole day; a shorter workshop blocks at least half a day.
7. Completing a task with a `recurrence` creates the next occurrence (dates shifted by the recurrence, advanced until in the future); chores return to status `next`.
8. A calendar import (ICS file or Microsoft 365 sync) replaces all previously imported events of that source; the owner's `kind` and `projectId` overrides are carried over by external id.
9. Project lifecycle: `active` (lists, week palette, next-action rule), `planned` (dropdowns, board, deadlines), `someday` (projects page only), `archived` (read-only, hidden). Tasks are only "workable" when their project is active or planned.
10. Private items (`task.private`, `project.private`) are filtered by the visibility hooks in `src/store/visible.ts` when `settings.hidePrivate` is on; private events (`event.private`, from Outlook sensitivity or set by hand) are masked instead of removed, so capacity stays honest. Detail views keep full access.
11. Meeting time counts against the day only within `settings.budgetStart … budgetEnd` (default 07:00–19:00).
12. `task.order` is the user's manual order within a status column (renumbered in steps of 1000 on every drop); `sortTasks` orders by status then `order`; `urgencyComparator(today)` (due within 14 days → undated → far-off) is applied only on request.

## 5. API sketch (iteration 2)

All JSON, all under `/api`, no auth (loopback only; an optional static token can be added for people who run it on a LAN).

| Method & path | Purpose |
|---|---|
| `GET /api/state` | Full snapshot for app start (same shape as the JSON export). |
| `POST /api/inbox` · `PATCH/DELETE /api/inbox/:id` | Capture, edit, remove. `POST` also serves external capture (CLI, bookmarklet). |
| `POST /api/inbox/:id/clarify` | Transactional: creates task/project/event and removes the item. |
| `GET/POST /api/tasks` · `PATCH/DELETE /api/tasks/:id` · `POST /api/tasks/:id/notes` · `POST /api/tasks/:id/status` | Tasks; status endpoint applies the next-action invariant. |
| `GET/POST /api/projects` · `PATCH/DELETE /api/projects/:id` | Projects. |
| `GET /api/events?from&to` · `POST/PATCH/DELETE /api/events` | Manual events; synced ones are read-only except `kind` and `projectId`. |
| `POST /api/calendar/connect` · `POST /api/calendar/sync` · `GET /api/calendar/status` | Graph login (opens browser), manual sync, status. |
| `GET/POST/PATCH/DELETE /api/blocks` | Plan blocks. |
| `PUT /api/reviews/:kind/:date` | Journal upsert. |
| `GET/PATCH /api/settings` | Settings. |
| `POST /api/ai/clarify` · `POST /api/ai/plan-week` · `POST /api/ai/project-actions` | AI features; the server builds the prompt from the database. |
| `GET /api/export` · `POST /api/import` | Backup/restore. |

The frontend keeps its Zustand store as a cache: actions call the API optimistically and reconcile on error; the snapshot is reloaded on window focus. With one user and one browser there is no conflict resolution to design.

## 6. Calendar integration design (Microsoft 365)

1. **App registration** (one-time, by the owner): Entra ID → public client, "Mobile and desktop applications", redirect `http://localhost`; audience single-tenant (add personal accounts later if Outlook.com is needed). Delegated permission `Calendars.Read` (or `Calendars.ReadBasic`), no admin consent required by default. No client secret.
2. **Auth:** `@azure/msal-node` `PublicClientApplication.acquireTokenInteractive` with a loopback listener and PKCE; the server opens the system browser. Tokens cached with `@azure/msal-node-extensions` (encrypted where the OS supports it; plaintext fallback on WSL – kept in `data/`, gitignored). Refresh tokens last 90 days and rotate.
3. **Sync:** `GET /me/calendarView?startDateTime&endDateTime` for the visible range (today − 7 d … today + 35 d), `Prefer: outlook.timezone="W. Europe Standard Time"`, follow `@odata.nextLink`. Graph expands recurring series. Map to `events` with `external_id = event.id`, `showAs` → availability (`free` never blocks), skip `isCancelled`; preserve the owner's `kind` and `projectId` on re-sync; replace the synced set for the range so moved and deleted meetings disappear. Kind heuristics: Teams/Zoom link → online; "Workshop/Training" → workshop; "Coaching/Supervision" → coaching; location set → in person. Step-by-step registration: `outlook-setup.md`.
4. **Fallback:** published ICS link (Outlook on the web → Shared calendars → Publish) fetched server-side every 15 minutes; `rrule` expansion with ical.js; the URL is a bearer secret, stored in `.env`.
5. **Later:** `Calendars.ReadWrite` to write plan blocks back as "focus" events; delta queries.

Ignored on purpose: CalDAV (not offered by Exchange Online), EWS (blocked for new apps since October 2026, removed April 2027), Power Automate.

## 7. AI assistance design

- Provider abstraction `AiProvider { clarify(), planWeek(), projectActions() }` with two implementations (Anthropic official SDK, OpenAI official SDK). Default models: `claude-opus-5-5` (adaptive thinking is always on; `output_config.effort: "low"` for classification-style calls) and the user's chosen OpenAI model.
- Prompts live in `server/ai/prompts/*.md` and are versioned; responses are requested as JSON and validated with a schema before anything touches the database. The user always confirms in the UI; nothing is written automatically.
- Privacy: a settings notice lists exactly what is sent (inbox text, project names and outcomes, calendar titles for week planning). Keys come from `.env` or the OS keychain, never from the browser. Per-call token usage is logged locally for cost awareness.
- Features by iteration: clarify suggestions (now, browser-direct), project breakdown, week allocation proposal, review drafts.

## 8. Privacy and security

- Server binds to `127.0.0.1` only; Vite dev server likewise. No telemetry, no external fonts (Inter is self-hosted).
- `.gitignore` excludes `data/`, `*.db`, `*.ics`, `.env*` (except `.env.example`), MSAL caches, exports.
- Sample data is fictional. Screenshots in docs must come from sample data.
- Pre-commit hook (iteration 2): refuse commits that contain `data/`, `.env` or `.ics` files, and scan for API-key patterns (`sk-ant-`, `sk-`).

## 9. Testing

- `vitest` unit tests for `domain/selectors.ts` (capacity, candidates, planned vs. actual, next-action invariant) and `domain/ics.ts`.
- Component tests for Clarify and the store invariants.
- Playwright smoke test (navigate every page, drag a card, capture an item) once the server exists.

## 10. Roadmap

| Iteration | Goal | Main work |
|---|---|---|
| **0 – Prototype (done)** | Validate design and flows | Client-only app, localStorage, sample data, de/en, DnD on Board/Week/Today, ICS file import, AI clarify (browser-direct). |
| **1 – Feedback round** | Adjust the design to the owner's feedback; answer open questions in `requirements.md` | Visual tweaks, interaction fixes, command palette, natural-language dates if wanted. |
| **2 – Local server + SQLite** | Durable data, one-command start | Hono server, migrations, repositories, API, store adapter, import of the localStorage export, backups, pre-commit guard, vitest. |
| **3 – Outlook calendar** (started) | Real meetings in Week and Today | Done: registration guide, `server/calendar.mjs` (MSAL loopback flow, persistent token cache, calendarView → events, free/busy, all-day expansion), Vite proxy, Settings connect/sync/disconnect, sync on app start. Open: periodic sync while running, delta queries, ICS feed fallback. |
| **4 – AI on the server** | Clarify, project breakdown, week proposal | Server endpoints, prompt files, usage log, privacy notice. |
| **5 – Rhythm features** | Make the rituals smoother | Recurring chores, weekly objectives, top-3, shutdown checklist, load warning, rollover, focus mode, external capture endpoint. |

## 11. Hosting options (access from a phone, computer switched off)

The prototype keeps data in the browser, so it cannot be reached from a second device until iteration 2 (server + SQLite) exists. After that, the options for a single user, in order of effort:

| Option | Effort | Cost | Login | Notes |
|---|---|---|---|---|
| **Small VPS (e.g. Hetzner, Germany) + Docker + Cloudflare Tunnel + Cloudflare Access** | ~1 h once the server exists | ~€4/month, Access free for one user | Access with Microsoft Entra login or email one-time code; the app itself needs no auth code | Data stays on a server you control in the EU; SQLite file + nightly backup. Recommended. |
| Fly.io with a persistent volume | ~1 h | ~€3–5/month | Same Cloudflare Access in front, or Fly's own proxy auth | No server to maintain; volumes are single-region. |
| Cloudflare Workers + D1 + Pages | 1–2 sessions (rewrite the server on Hono for Workers, raw OAuth instead of MSAL) | Free tier likely sufficient | Cloudflare Access | No server at all; the calendar sync becomes a Cron Trigger with a confidential-client Graph app. |
| Tailscale to a machine at home | 30 min | Free | Tailscale identity | Requires a machine that stays on, so it does not meet the requirement. |
| AWS Amplify (Hosting + Cognito + Amplify Data) | Several sessions | Free tier, then pay per use | Cognito | Means rewriting the data layer to Amplify's GraphQL model and moving the calendar sync into Lambda; heavy for one user and locks the data model to AWS. Not recommended. |

Whichever host: keep the server container identical to the local one, bind it to a private interface and put the identity layer (Cloudflare Access or Tailscale) in front, so the app never has to implement passwords. A mobile layout (Inbox, Today, Clarify first) is a separate piece of work.

## 12. Running the prototype

```
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build locally
```

Data lives in the browser's localStorage under `zendo.v1` (app data) and `zendo.ai` (AI settings). Export JSON from Settings before clearing browser data.
