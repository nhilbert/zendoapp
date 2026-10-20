# Zendo – Plan and architecture

Status 2026-10-20. Iteration 2 is implemented: one local Node process (Hono + SQLite) is the source of truth, the React client syncs with it. This document describes the architecture and what remains.

## 1. Decisions in brief

| # | Decision | Why |
|---|---|---|
| D1 | **Single local process**: one Node.js server on `127.0.0.1` serves the built frontend and a JSON API. | One command to start, nothing exposed to the network, simplest possible operations for a single user. |
| D2 | **SQLite file** in `data/zendo.db` as the system of record (Node's built-in `node:sqlite`, no native build), with daily rotating backups in `data/backups/`. Rows store each record as JSON with generated columns for indexed fields (ADR-1 below). | Durable, inspectable, trivially backed up; no database server. |
| D3 | **Frontend stays the prototype's stack** (React 19, TypeScript, Vite, Tailwind v4 tokens, Zustand, dnd-kit, i18next). The store stays in memory; a sync layer diffs every change into upserts/deletes for the server (ADR-2). Components did not change. | The prototype already separates domain, store and UI; the design work carries over unchanged. |
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

### ADR-1 · JSON rows with generated columns

Each collection (inbox items, projects, tasks, events, plan blocks, reviews) is a table with `id`, `data` (the record as JSON) and `updated_at`, plus generated, indexed columns for the fields worth querying (status, project, dates, source). This keeps one definition of each record (the TypeScript type), makes migrations a matter of transforming JSON (the same `migratePersisted` the client uses), and still allows SQL queries and backups per row. A fully normalised schema can be introduced per table later without changing the API.

### ADR-2 · Diff-based sync instead of per-action endpoints

The client store remains the in-memory working copy; a sync module subscribes to it, diffs each collection by record reference, and posts `{ upserts, deletes, settings }` to `POST /api/changes` (debounced, merged, retried while offline). On start the client fetches `GET /api/state`. An empty server receives the browser's data (`PUT /api/state`). A server with data wins, with one exception learned the hard way: a browser that has never synced and holds its own data (not the auto-seeded sample) that differs from the server gets a conflict dialog and chooses which side to keep; a copy of its data is kept in the browser (downloadable from Settings) before anything is replaced. Flags: `zendo.fresh` (seeded sample), `zendo.synced` (agreed with the server). On window focus the client refreshes when the server's `changedAt` changed. Last write wins afterwards, which is adequate for one user. The browser cache (zustand persist) stays as an offline fallback. `scripts/recover-localstorage.py` extracts Zendo states from a Chromium LevelDB folder if a browser copy ever has to be rescued.

## 3. Repository layout

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
├─ server/                  Hono app on Node 24 (TypeScript, run directly by Node)
│  ├─ db/migrations/        0001_init.sql …
│  ├─ db.ts                 open database, run migrations, transactions
│  ├─ repo.ts               load state, apply changes, replace all, validation
│  ├─ app.ts                routes: /api/health, /api/state, /api/changes, /api/inbox, /api/calendar/*, static UI
│  ├─ calendar.ts           Microsoft 365 (MSAL loopback + PKCE, calendarView)
│  ├─ graph-map.ts          Graph → events mapping (pure)
│  ├─ backup.ts             daily VACUUM INTO data/backups/
│  └─ index.ts              entry point
├─ src/sync/                client: api wrapper, diff-based sync with offline queue
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

## 5. API (implemented)

All JSON under `/api`, loopback only. Every request must carry the header `x-zendo: 1` and come from a loopback host/origin (cross-site pages cannot add the header without a CORS preflight, which the server never grants).

| Method & path | Purpose |
|---|---|
| `GET /api/health` | Liveness, schema version, whether the database holds data. No header needed. |
| `GET /api/state` | Full snapshot (same shape as the JSON export) plus `initialized` and `changedAt`. |
| `PUT /api/state` | Replace everything (migrated to the current schema first). Used for the first push of local data and for JSON imports. |
| `POST /api/changes` | `{ upserts: {col: records[]}, deletes: {col: ids[]}, settings? }` applied in one transaction. |
| `POST /api/inbox` | Quick capture from outside the app: `{ text }`. |
| `GET /api/calendar/status` · `POST /api/calendar/connect` · `POST /api/calendar/sync` · `POST /api/calendar/disconnect` · `GET /api/calendar/events?from&to` | Microsoft 365: status with last sync, interactive sign-in (opens the browser, then syncs), sync now, sign-out, raw calendarView. The server also syncs at start and every `ZENDO_CALENDAR_SYNC_MINUTES` (default 15) and writes events into the database, keeping the owner's overrides. 503 `not_configured` without an app registration. |
| `GET /api/ai/status` · `POST /api/ai/clarify` | AI: provider/model from `.env` (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, optional `ZENDO_AI_PROVIDER`, `ZENDO_AI_MODEL`); clarify suggestion for `{ text, locale }`, with project names read from the database. Claude calls use structured output (JSON schema) and the server-side refusal fallback. 503 `not_configured` without a key. |

Planned: `POST /api/ai/plan-week`, `POST /api/ai/project-actions`, `GET /api/export`.

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
| **2 – Local server + SQLite** (done) | Durable data, one-command start | Hono server on Node 24 with `node:sqlite`, migrations, repository, state/changes API, diff-based client sync with offline queue, automatic push of prototype data, daily backups, external quick capture, pre-commit guard, tests. Open: `npm start` auto-open of the browser, LAN token. |
| **3 – Outlook calendar** (done) | Real meetings in Week and Today | Done: registration guide, `server/calendar.mjs` (MSAL loopback flow, persistent token cache, calendarView → events, free/busy, all-day expansion), Vite proxy, Settings connect/sync/disconnect, sync on app start. Periodic server-side sync every 15 minutes. Open: delta queries, ICS feed fallback. |
| **4 – AI on the server** (started) | Clarify, project breakdown, week proposal | Done: `/api/ai/clarify` with key in `.env`, structured output, refusal fallback, privacy notice in Settings, browser key only as fallback. Open: project breakdown, week proposal, usage log. |
| **4b – Phone layout** (done) | Usable on a phone once hosted | Bottom navigation, responsive pages, touch drag via long-press, non-drag alternatives, PWA manifest and icons. Open: offline service worker, hosting (section 11). |
| **5 – Rhythm features** | Make the rituals smoother | Recurring chores, weekly objectives, top-3, shutdown checklist, load warning, rollover, focus mode, external capture endpoint. |

## 11. Hosting options (access from a phone, computer switched off)

The prototype keeps data in the browser, so it cannot be reached from a second device until iteration 2 (server + SQLite) exists. After that, the options for a single user, in order of effort:

| Option | Effort | Cost | Login | Notes |
|---|---|---|---|---|
| **Small VPS (Hetzner Cloud CAX11, Germany) + Docker + Caddy + oauth2-proxy with Microsoft Entra ID** | ~1 h once the server exists | ~€9/month incl. VAT, IPv4 and Hetzner backups (2026 prices) | Microsoft 365 account with MFA, checked on the server | Chosen. TLS ends on the server, so no third party sees the data in transit; one login gate serves every app on the server, each on its own subdomain (`zendo.example.com`). |
| Small VPS + Cloudflare Tunnel + Cloudflare Access | ~1 h | VPS + Access free for one user | Access with Entra login or email one-time code | No open ports, but Cloudflare terminates TLS (sees the content) and the domain's DNS has to move to Cloudflare. |
| Fly.io with a persistent volume | ~1 h | ~€3–5/month | Same Cloudflare Access in front, or Fly's own proxy auth | No server to maintain; volumes are single-region. |
| Cloudflare Workers + D1 + Pages | 1–2 sessions (rewrite the server on Hono for Workers, raw OAuth instead of MSAL) | Free tier likely sufficient | Cloudflare Access | No server at all; the calendar sync becomes a Cron Trigger with a confidential-client Graph app. |
| Tailscale to a machine at home | 30 min | Free | Tailscale identity | Requires a machine that stays on, so it does not meet the requirement. |
| AWS Amplify (Hosting + Cognito + Amplify Data) | Several sessions | Free tier, then pay per use | Cognito | Means rewriting the data layer to Amplify's GraphQL model and moving the calendar sync into Lambda; heavy for one user and locks the data model to AWS. Not recommended. |

Whichever host: keep the server container identical to the local one, bind it to a private interface and put the identity layer in front, so the app never has to implement passwords. The phone layout exists (iteration 4b); what remains for on-the-go use is the hosting itself.

How the chosen setup fits together:

- `Dockerfile` builds the UI and runs the same server as `npm start`, as user `node`, with data in the `/data` volume. Configuration comes from the environment (`.env.example`): `ZENDO_PUBLIC_URL` is the public address, whose host and origin pass the API guard next to loopback; `ZENDO_HOST=0.0.0.0` binds inside the container, which publishes no port; `ZENDO_CALENDAR_LOGIN=device` replaces the browser sign-in with a device code (`docs/outlook-setup.md`).
- Caddy terminates TLS (Let's Encrypt) and asks oauth2-proxy (`forward_auth`) on every request; unauthenticated page loads are redirected to the Microsoft sign-in, API calls get 401. oauth2-proxy answers under `/oauth2/` on each app's own host, so the session cookie is host-only and other hosts of the domain never receive it; it uses its own confidential Entra app registration (one redirect URI per app host, `https://<host>/oauth2/callback`) and an allow-list of e-mail addresses. Zendo's own registration stays a public client without a secret.
- The x-zendo header check stays in place behind the proxy, so a foreign site still cannot drive the API with the user's cookie.
- Backups: Zendo's daily `VACUUM INTO` copies in the data volume, plus Hetzner's daily server backups (7 kept). Moving data in: stop the container, copy a consistent copy of `zendo.db` (and `msal-cache.json`) into the volume, start again; then use only the hosted address, so there is one source of truth.
- The server-specific files (cloud-init, Caddyfile, compose files, deploy script) live outside this public repo because they name the domain and account.

## 12. Running the prototype

```
npm install
npm run dev                  # development: Vite UI (5173) + server (5174)
npm run build && npm start   # everyday use: the server serves the built UI on http://127.0.0.1:5174
npm test                     # unit tests (domain, store, server)
```

Data: `data/zendo.db` (SQLite, WAL), `data/backups/zendo-YYYY-MM-DD.db` (one per day, last 14 kept), `data/msal-cache.json` (Microsoft tokens). The browser keeps a cache under `zendo.v1`; AI settings stay in the browser under `zendo.ai` for now.
