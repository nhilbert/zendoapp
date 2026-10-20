# Zendo – Requirements

> A calm, GTD-inspired todo and planning app for one person, served locally.
> Status: v0.2 – written 2026-10-19 from the owner's brief, refined with research (see `research-best-practices.md`, `research-design-options.md`) and the first feedback round (section 9). Items marked **[P]** are implemented in the prototype, **[p]** partially, **[ ]** not yet.

## 1. Purpose

Zendo helps a self-employed consultant and facilitator run their work with *Getting Things Done* (GTD): capture everything, clarify it into actions and projects, plan weeks and days realistically around a dense calendar of workshops and meetings, execute with a short daily list, and review daily and weekly. The app must make it easier – not harder – to stay focused for a person who is easily distracted.

## 2. Guiding principles

1. **Calm by default.** Lots of white space, one accent colour, no badges, counters, toasts or animations that compete for attention. State lives in the periphery (a faint capacity bar), not in modals.
2. **One thing at a time.** Capture takes one field. Clarify shows one inbox item. Today shows one day. Everything else is one keystroke away but out of sight.
3. **GTD-faithful, not GTD-dogmatic.** Capture → Clarify → Organize → Reflect → Engage. Every active project has exactly one next action. The calendar is the "hard landscape"; tasks are not stuffed into it.
4. **Dates mean something.** A *due date* is a real external deadline. A *planned date* is an intention. Overdue is informative, not a wall of shame.
5. **Plan rough, then refine.** Weekly planning allocates broad blocks (¼, ½, ¾, 1 day) per project; daily planning turns today's block into a timetable.
6. **Local and private.** The app runs on localhost; personal data never leaves the machine except to services the owner explicitly configures (AI provider, Microsoft 365). The repository is public and must never contain private data.
7. **Keyboard-first, mouse-friendly.** Everything reachable from the keyboard; drag and drop for visual work (board, week, day).
8. **Multilingual from day one.** All UI strings go through the translation layer. German and English ship first; dates and numbers follow the locale.

## 3. User and context

- One user: consultant and facilitator (supervision, coaching, organisational development). Works in German, builds in English.
- Workload: several concurrent client projects (workshops, concepts, reports, strategies) plus own business (invoices, website, licences).
- Calendar: Microsoft 365 / Outlook. Event types: online meetings (0.5–2 h), online workshops (hours), in-person workshops at clients (half-days, days, multi-day), in-person coaching/meetings at the own office (1–2 h).
- Rhythm: weekly planning for a rolling two-week horizon; daily planning in the morning; daily review in the evening; weekly review usually together with the next week's planning.
- Attention: easily distracted – the tool must avoid noise and give a single clear place to look.

## 4. Core concepts

| Concept | Meaning | German |
|---|---|---|
| **Inbox item** | Raw capture: idea, snippet, link, half-sentence. Not yet clarified. | Eingang |
| **Action** (task) | One concrete, physical next step ("Call X about Y"). Has status, priority, estimate, optional due/planned date, notes. | Aktion |
| **Chore** | An action that belongs to no project (single action, often admin). | Routine |
| **Project** | Any outcome needing more than one action. Has an ordered list of goals, notes/commitments, status (active · planned · someday · archived), optional deadline, colour, private flag. | Projekt |
| **Next action** | The one action per active project that is up next. Exactly one per active project, always. | Nächster Schritt |
| **Waiting for** | Delegated action; who/what we wait for and since when. | Warten auf |
| **Someday / maybe** | Not committed; parked without guilt. Applies to actions and projects. | Irgendwann |
| **Meeting / event** | Calendar item (hard landscape): online, in-person, workshop, coaching, other. From Outlook or manual. | Termin |
| **Plan block** | Weekly-planning allocation: "½ day on project X on date Y". Null project = chores/admin time. | Zeitblock |
| **Due date** | Hard external deadline. | Fällig am |
| **Planned date / time** | The day (and optionally the time) I intend to do it. | Geplant für |
| **Review** | Free-form daily or weekly journal plus computed overviews. | Rückblick |

## 5. Functional requirements

Priority: **M** must, **S** should, **C** could.

### 5.1 Capture
- **CAP-1 (M) [P]** Quick capture from anywhere in the app with one keystroke (`n`); single field; Enter saves, Esc discards; multi-line snippets allowed.
- **CAP-2 (M) [P]** Inbox page with the same input at the top and the list of captured items below; inline edit and delete.
- **CAP-3 (S) [p]** Capture from outside the app: `POST /api/inbox` on the local server (CLI, scripts); the app picks new items up when its window regains focus. Bookmarklet and OS hotkey: later.
- **CAP-4 (C) [ ]** Capture emails (forward to a local mailbox) and Teams/Outlook flagged items.

### 5.2 Clarify (workflow page)
- **CLR-1 (M) [P]** Process the inbox one item at a time, oldest first, with a progress counter. "Skip" moves the item to the end; nothing is put back silently.
- **CLR-2 (M) [P]** Two steps: first only the decision (Action, Project, Meeting, Someday/maybe, Did it, Auto) with Trash at the bottom; details are asked only after the decision. Trash and Did it act immediately and move to the next item. Keys 1–5, 6 (trash), a (auto).
- **CLR-3 (M) [P]** For an action: formulate the next action (verb-first), assign to project or chore, estimate (15 min … 1 day), priority, due date (deadlines only), planned date, optional note; option to make it the project's next action (pre-checked when the project has none).
- **CLR-4 (M) [P]** For a project: name, optional first goal, first next action; the project is created and the action becomes its next action.
- **CLR-5 (M) [P]** For a meeting: title, date, start/end, kind, location, project; it lands on the calendar.
- **CLR-6 (S) [ ]** "Reference" outcome: keep as a note attached to a project or in a reference list.
- **CLR-7 (S) [P]** "Auto": AI suggests kind, formulated next action, project match, estimate, priority, dates; the form opens prefilled for confirmation (see 5.13).

### 5.3 Projects and next actions
- **PRJ-1 (M) [P]** Project list showing, per active project, the next action prominently, the deadline and the count of open actions; projects without a next action are flagged (quietly, in amber).
- **PRJ-2 (M) [P]** Project page: metadata (name, goals, notes/commitments, status, deadline, colour, private), actions grouped by status, done actions collapsed, planned time in the next two weeks. (The separate "desired outcome" field was removed in favour of the goals list; existing outcomes became the first goal.)
- **PRJ-9 (M) [P]** Project lifecycle: **active** (in all lists, the week palette and the next-action rule), **planned** (prepared; in dropdowns, board and deadline markers, not in the week palette, no next-action rule), **someday** (idea; only on the projects page), **archived** (read-only; no lists, no dropdowns, no new actions; reactivate from the projects page).
- **PRJ-3 (M) [P]** Exactly-one-next-action invariant enforced by the store: promoting an action demotes the previous next action to "to do".
- **PRJ-4 (M) [P]** When a next action is completed, the app prompts (Today page and reviews) to pick or add the next one.
- **PRJ-5 (M) [P]** Explicit high-level goals per project (from the offer or personal): a short ordered text list (typically 1–5) that can be added to, edited, reordered and removed on the project page. Milestones with dates and natural-planning fields: later.
- **PRJ-6 (C) [ ]** Areas of responsibility (e.g., Client A, Own business) above projects; optional client attribute.
- **PRJ-8 (–) [ ]** GTD contexts (@office, @calls …) are *not* needed – decided in feedback round 1.
- **PRV-1 (M) [P]** Private items: tasks and projects can be marked private (a task in a private project is private). A sidebar toggle (key `h`) hides all private items from every list, board, plan and review while at work; a lock chip marks them when visible.
- **PRJ-7 (C) [ ]** Sequential projects (ordered actions, next = first open).

### 5.4 Chores
- **CHR-1 (M) [P]** Actions without project; appear on the board and as "chores up next" candidates on Today.
- **CHR-2 (M) [P]** Recurring chores (daily … yearly) – completing one creates the next occurrence with shifted dates, kept in the future.

### 5.5 Board (kanban)
- **BRD-1 (M) [P]** Columns: Next action · To do · Waiting · Someday · Done (last 7 days). Drag between columns; dropping into "Next action" applies the invariant.
- **BRD-2 (M) [P]** Filter by project or chores; quick-add at the bottom of each column.
- **BRD-3 (M) [P]** Free manual ordering: drop a card before or after another (insertion line) or at the end of a column. Manual order is the primary order on the board and the project page; priority and due date are visual signals only. A per-column "sort by urgency" re-applies an automatic order on request: tasks due within the next two weeks first (by due date, overdue on top), then tasks without a due date (by priority), then tasks whose due date is further away (by due date). Swimlanes per project and a WIP hint: later.

### 5.6 Dates and scheduling
- **DAT-1 (M) [P]** Due date and planned date are separate fields on every action; planned time of day is optional.
- **DAT-2 (M) [P]** Overdue and due-today are shown with colour and label, never as a counter.
- **DAT-3 (S) [ ]** Natural-language date entry ("fr", "next tue", "3d").
- **DAT-4 (S) [ ]** Unfinished planned actions roll over to the next day on request (daily review), not automatically.

### 5.7 Weekly planning (rolling two weeks)
- **WK-1 (M) [P]** Two weeks side by side, one row per day, current week first; navigate forward/back; today highlighted.
- **WK-2 (M) [P]** Each day shows: meetings (time, kind, title), deadlines (actions and projects), a capacity bar (meetings · planned blocks · free) and the free hours.
- **WK-3 (M) [P]** Drag a project (or "chores/admin") onto a day to create a ½-day block; click the block to cycle ¼ → ½ → ¾ → 1 day; drag blocks between days; remove.
- **WK-4 (M) [P]** Over-capacity days are marked in amber.
- **WK-8 (M) [P]** A block absorbs its project's meetings that day: the project consumes the larger of the block and its meetings (½ day + 1 h meeting = 4 h; ¼ day + 3 h of meetings = 3 h). Meetings without a project, or of projects without a block that day, count separately. The bar shows absorbed meeting time shaded inside the project segment; a block whose meetings exceed it shows the actual hours.
- **WK-5 (S) [ ]** Weekly objectives (max 3) stated for the week; shown on Today.
- **WK-6 (M) [P]** Workshop rule: a workshop of five hours or more blocks the whole day; a shorter workshop blocks at least half a day. Everything else counts by its duration. (Buffer/travel blocks: later.)
- **WK-7 (C) [ ]** AI proposal of a week allocation from deadlines, next actions and free capacity (5.13).

### 5.8 Daily planning
- **DAY-1 (M) [P]** Today view with a timeline (working hours, extended to cover all events) in two lanes: calendar (left) and plan (right).
- **DAY-2 (M) [P]** Candidates panel: overdue, due today, next actions of projects that have a block today, chores up next. One click adds a candidate to the day; drag into a time slot to timebox it.
- **DAY-3 (M) [P]** Capacity line: meetings · planned · free hours for the day.
- **DAY-4 (S) [ ]** Load warning when planned work exceeds ~70–80 % of free time (planning fallacy guard).
- **DAY-5 (S) [ ]** "Top 3 for today" marker.

### 5.9 Daily execution
- **EXE-1 (M) [P]** Check off actions from the timeline or the list; completed items stay visible but struck through.
- **EXE-2 (M) [P]** From any action: add dated notes, set to waiting (with "waiting for"), change due/planned date and time, change priority, estimate, project.
- **EXE-3 (C) [ ]** Lightweight timer / actual time per action, or import actuals from Toggl – a later add-on (feedback round 1).
- **EXE-4 (S) [ ]** Focus mode: full-screen single task with its notes.

### 5.10 Daily review
- **DRV-1 (M) [P]** For a day: completed actions, notes made, still-open planned actions with "move to tomorrow", tomorrow's preview (events, blocks, planned actions), a journal field.
- **DRV-2 (S) [ ]** Guided shutdown checklist (inbox to zero, calendar checked, tomorrow's first action chosen).

### 5.11 Weekly review
- **WRV-1 (M) [P]** For a week: planned block hours vs. hours of completed actions per project; completed count; projects without next action; overdue; waiting-for list with age; journal.
- **WRV-2 (S) [ ]** GTD weekly-review checklist (get clear, get current, get creative) with progress; someday/maybe review.
- **WRV-3 (S) [ ]** Carry-over of objectives into next week's plan.

### 5.12 Calendar integration (Microsoft 365 / Outlook)
- **CAL-1 (M) [p]** Meetings and workshops from the owner's Outlook calendar appear in Week and Today. *Prototype: manual events plus import of an exported `.ics` file (recurring series only as single occurrence).* Each import **replaces** the previous import (moved and deleted meetings vanish; kind and project assignments survive).
- **CAL-7 (M) [P]** Private meetings: Outlook sensitivity private/personal/confidential (ICS `CLASS:PRIVATE`) marks an event private automatically; any event can be marked private by hand and that choice survives syncs. While private items are hidden, private meetings stay in the plan (their time is taken) but are masked as "Private appointment" without location, project or details, and cannot be opened.
- **CAL-8 (M) [P]** Budget window: only the part of a meeting inside the configurable window (default 07:00–19:00) counts against the day's budget; evening and early-morning events cost nothing.
- **CAL-6 (M) [P]** Free/busy is respected: events shown as *free* (reminders, other people's holidays) are displayed muted and never block time; tentative, busy and out-of-office block. Manual events can be marked free.
- **CAL-2 (M) [ ]** Read-only sync through Microsoft Graph (`/me/calendarView`, delegated `Calendars.Read`, auth code + PKCE via the local server, token cache outside the repo). Recurrences expanded by Graph.
- **CAL-3 (S) [ ]** Fallback: published ICS feed polled by the local server (if app registration is not possible in the tenant).
- **CAL-4 (C) [ ]** Write-back: create "focus" calendar entries from plan blocks so others see busy time.
- **CAL-5 (S) [p]** Classify events by kind (online, in person, workshop, coaching) and link to projects; heuristics on import, editable.

### 5.13 AI assistance (optional, bring your own key)
- **AI-1 (M) [P]** Settings: choose provider (Claude/Anthropic or ChatGPT/OpenAI), paste API key, optional model override. Key is stored only locally and excluded from exports.
- **AI-2 (M) [P]** Clarify: suggest kind, a verb-first next action, project match, estimate, priority, due/planned dates for the current inbox item. The user always confirms.
- **AI-3 (S) [ ]** Project page: break a project outcome into candidate actions; propose the next action.
- **AI-4 (S) [ ]** Week: propose block allocation across the two weeks from deadlines, next actions, estimates and free capacity; explain the proposal; the user drags to adjust.
- **AI-5 (S) [ ]** Reviews: draft the daily/weekly journal from completed items and notes.
- **AI-6 (M) [ ]** Calls go through the local server (key never in the browser); clear notice about what is sent to the provider (inbox text, project names).

### 5.14 Settings and data
- **SET-1 (M) [P]** Language (de/en), working hours, focus hours per full day, work days.
- **SET-2 (M) [P]** Export/import all data as JSON; load fictional sample data; delete all data.
- **SET-3 (M) [P]** Durable storage in a local SQLite file (`data/zendo.db`) with automatic daily backups; the browser keeps a cache and queues changes while the server is unreachable.
- **SET-4 (S) [ ]** Theme: system / light / dark toggle (prototype follows the system).

## 6. Non-functional requirements

- **NF-1 Distraction-free UI.** No notification badges or counts in navigation; no toasts; no auto-playing motion; one accent colour; semantic colour only for overdue/due/attention. Progressive disclosure: secondary options live in the drawer, not on the row.
- **NF-2 Local only.** Served on `127.0.0.1`; never bound to the network interface by default. No telemetry.
- **NF-3 Privacy in a public repository.** No personal data, calendar exports, tokens, keys or database files are ever committed. `.gitignore` covers `data/`, `*.db`, `*.ics`, `.env*`, MSAL caches. Sample data is fictional. Client secrets are never created (public client).
- **NF-4 Internationalisation.** Every string in the translation files; plural rules; dates/times via `Intl` with the active locale; Monday-first weeks.
- **NF-5 Performance.** Instant interactions (<50 ms) on a few thousand items; app starts in under a second.
- **NF-6 Accessibility.** Keyboard operability for all actions incl. drag and drop (keyboard sensor + non-drag alternatives); focus visible; contrast ≥ 4.5:1 for text; `prefers-reduced-motion` honoured; dark mode.
- **NF-7 Data portability.** JSON export/import at any time; data model documented.
- **NF-8 Reliability.** Autosave on every change; no "save" buttons for data; backups rotate daily.

## 7. Out of scope (for now)

Team features, sharing, mobile apps, push notifications, time-tracking invoices, email client features, multi-account calendars (beyond the owner's), cloud sync.

## 8. Open questions for the owner

Answered items are struck through; see section 9 for the decisions.

1. **Capacity.** How many focused hours does a meeting-free day really have? The prototype assumes 8 h per "1 day" block and 08:00–18:00 working hours.
2. ~~**Granularity.**~~ Weekly planning with ¼ … 1-day blocks works well.
3. **Weekends.** Mon–Fri only, or do you sometimes plan weekend work?
4. ~~**Workshops.**~~ Decided: full-day workshops block the day, half-day workshops block half a day, everything else is a normal meeting.
5. ~~**Recurring chores.**~~ Yes – implemented (simple recurrence on completion).
6. ~~**Contexts.**~~ Not needed.
7. **Areas.** Do you want a level above projects (client / own business / personal)?
8. ~~**Actual time.**~~ Toggl integration is a later add-on.
9. **Calendar.** App registration is possible (see `outlook-setup.md` for how simple it is). Still open: write blocks back to Outlook as busy time? Only the primary calendar?
10. ~~**AI.**~~ Sending inbox text and project names is acceptable; "Auto" on demand per item.
11. **Reference material.** Do notes/reference live in Zendo or elsewhere (OneNote, Obsidian)? Only links?
12. **Devices.** One machine only, or laptop + desktop (would need sync and changes "local only")?
13. **Review timing.** Weekly review on Friday afternoon or Monday morning? Should the app nudge you?
14. ~~**Look and feel.**~~ Approved, including dark mode.
15. **Priorities.** Three levels (high/normal/low) or something else (Eisenhower, flag only)?

## 9. Decisions from feedback round 1 (2026-10-19)

- Look and feel approved; dark mode stays.
- Today must fill the viewport vertically (done: the timeline stretches to the available height).
- Clarify is a two-step flow: decide first (six options plus Auto, trash at the bottom and acting immediately), details second.
- Workshops: full day blocks the day, half day blocks half a day; everything else is a calendar meeting.
- Recurring chores are in.
- GTD contexts: not used. Toggl: later add-on.
- Microsoft 365 app registration is feasible for the owner; the Graph route stays the plan.
- AI assistance is acceptable with the owner's data; keep "Auto" per item.
- ICS import replaces the previous import; free/busy status must be respected (reminders and other people's holidays do not block time).
- Microsoft 365 app registration done by the owner; the local calendar service syncs the calendar (connect / sync / disconnect in Settings, sync on start).
- Private vs. work: mark tasks/projects private and hide them with one toggle while at work.
- Project lifecycle merged with the owner's request: active / planned / someday / archived (old on hold → planned, done → archived).
- Hosting on the go: wanted later (phone access, computer off); needs iteration 2 first. Options and a recommendation in `architecture.md` section 11.
- Kanban cards can be sorted freely. Trade-off accepted: manual order replaces automatic priority/due sorting (a card dragged above a high-priority card would otherwise snap back); "sort by urgency" per column keeps the automatic order one click away.
