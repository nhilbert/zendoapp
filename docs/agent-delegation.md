# Delegating tasks to AI agents – concept

Status 2026-11-04: concept, nothing implemented. Goal: during morning planning, hand two or three tasks (draft an e-mail, propose meeting dates, draft an offer) to an AI agent with a short brief; the agent works on them for as long as it needs, with review loops, and the results wait for review in the afternoon. Nothing is sent, booked or written to another system without the owner's explicit action.

## 1. Principles

| # | Principle | Consequence |
|---|---|---|
| P1 | **Opt-in per task.** An agent only touches a task that was explicitly handed over. | No agent ever scans the task list and picks work on its own. Proposals to delegate (stage 4) are themselves only proposals. |
| P2 | **No handover without a brief.** | Handing over means writing (or confirming) a brief: goal, sources, constraints, expected result. A brief the agent finds insufficient comes back as a question, not as a guess. |
| P3 | **Drafts only.** The agent prepares; the owner releases. | Outlook drafts instead of sent mail, proposed slots instead of calendar entries, a CRM change proposal instead of a CRM write, a Word file in a review folder instead of a sent offer. |
| P4 | **Limits are enforced by permissions, not by the prompt.** | Sending mail, creating events, CRM writes, deleting are denied in the agent's tool permissions (`permissions.deny` / `--disallowedTools`), so a misread brief cannot cause them. |
| P5 | **Everything the agent did is visible on the task.** | A run log as a task note: sources read, assumptions, open questions, links to the drafts. |
| P6 | **One switch stops everything.** | A setting "agents paused" that the runner checks before each run. |

## 2. Where the agent runs

| Place | Reaches | Runs while the laptop is closed | Notes |
|---|---|---|---|
| **Laptop: Claude Code (headless `claude -p` from launchd/cron, or the desktop app's local scheduled tasks)** | Local files, local skills (offer template, house style), all connectors (Zendo, CRM, Microsoft 365) | No | Needed whenever the material exists only on the laptop. Runs are skipped when the machine sleeps; the runner catches up at the next slot. |
| **Cloud: Claude Code scheduled task in a cloud session** | Connectors and repositories; OneDrive/SharePoint through the Microsoft 365 connector; no local disk | Yes | Enough for tasks whose sources are mail, calendar, CRM and OneDrive. A cloud session can attach a laptop folder through Remote Control, but only while the laptop is online. |

Recommendation: start on the laptop (it reaches everything), and move a task type to the cloud only once it has proved itself and its sources are all reachable from there.

## 3. The task's life cycle

```
            owner                         agent run                     owner
 todo ──▶ handed over ──▶ (brief check) ──▶ working ──▶ ready for review ──▶ accepted (done / back to todo)
            │                 │                │                │
            │                 └──▶ question ◀──┘                └──▶ returned with feedback ──▶ handed over
            └──▶ withdrawn
```

- **handed over** – the owner wrote the brief; the task is in the queue.
- **question** – the agent needs information it cannot find (brief check or during work). The task shows the question; answering puts it back in the queue.
- **working** – a run has claimed the task (with a lease, so two runs never work on the same task, and a crashed run releases it after the lease expires).
- **ready for review** – the result is attached; the owner reviews in Zendo, then in Outlook or Word.
- **returned with feedback** – the owner's comments go into the brief of the next round.

## 4. The brief

A brief is short structured text, with a template per task type. The type decides the template, the review checklist and which tools the run may use.

| Type | Brief fields (beyond the task title) | Result | Tools allowed |
|---|---|---|---|
| **Reply to an e-mail** | Which mail (link or sender + date), intent of the answer, tone, what must not be promised | Outlook reply draft, plus a summary on the task | Mail search/read, create reply draft, CRM read, Zendo read |
| **Propose meeting dates** | Which request, duration, period, place/online, who must attend, preferred days | List of 3–5 slots with reasons and conflicts; optionally a reply draft offering them | Calendar search, free/busy, create draft, CRM read |
| **Offer** | Client and project (CRM link), scope in a few lines, price frame or day rate, reference offers, deadline | Word file in the review folder (house template via the offer skill), open points list, CRM change proposal (stage OFFER, amount) as text | CRM read, file read in the offer folder, file write to the review folder, offer and editing skills |
| **Free** | Goal, sources, result format, limits | As described | Read-only plus write to the review folder |

Brief check: when the task is handed over, while the owner is still planning, a fast model (Clarify's model) reads the brief together with the task and the CRM/Zendo context and returns either "sufficient" or up to three questions. This moves the "I need to tell it more" step to the morning, where it costs a minute, instead of discovering it in the afternoon.

## 5. A run

One runner, three times a day (e.g. 07:30, 12:30, 17:30), or on demand:

1. Read the pause switch; stop if paused.
2. Fetch the queue (tasks "handed over", oldest first, at most N per run), claim each with a lease.
3. Per task, one sub-agent with the type's tool set:
   - **gather**: sources named in the brief, CRM record, related Zendo project and notes, mail thread;
   - **draft**;
   - **review loop** (at most two rounds): a second agent checks the draft against the brief and a type checklist (facts against sources, every question in the mail answered, dates conflict-free, prices consistent with the CRM, house style via the editing skill), the drafting agent revises;
   - **report**: write the result and the run log to the task, set "ready for review" or "question".
4. Write a run summary (one note per run, or the day's review note).

Budgets: maximum turns and wall-clock time per task; on exhaustion the task goes to "question" with what was done so far, never into a loop.

## 6. Stages

Each stage is usable on its own and produces the evidence for the next.

### Stage 0 – Convention and a manual command (no code in Zendo)

- Handing over: status `waiting`, `waitingFor: "KI"`, the brief in the task's description (template from section 4 as a text snippet).
- On the laptop, a Claude Code command `/delegiert` (a skill in `~/.claude/skills/`) that does section 5 for those tasks, started by hand after morning planning. Results as Outlook drafts and files; the run log as a task note (`task_add_note`); afterwards `waitingFor: "Review"`.
- Permissions in the laptop's Claude Code settings deny `outlook_send_mail`, `outlook_send_draft`, `outlook_create_event`, `outlook_update_event`, `outlook_delete_*`, all CRM `create_*`/`update_*`, and Zendo `task_delete`/`task_complete`.
- Purpose: find out which task types give usable results and which brief fields were missing. Duration: two weeks.

### Stage 1 – Delegation in Zendo

- Data: `Task.agent?: { state, kind, brief, questions[], result?, runs[], leaseUntil? }` (one more JSON field per ADR-1, a generated column for `state`).
- UI: "Hand to AI" on a task (Today, Board, task dialog) opens the type's brief form; the brief check runs on the server through `server/ai.ts`. A view "AI" lists questions and results for review; accept, return with feedback, withdraw.
- MCP: `agent_queue` (handed-over tasks with briefs), `agent_claim` (lease), `agent_report` (result, run log, new state). The existing tools stay; `agent_report` is the only way to set "ready for review".
- Settings: the pause switch, the maximum number of tasks per run.

### Stage 2 – Scheduled runs on the laptop

- launchd (macOS) or Task Scheduler (Windows) starts `claude -p "/delegiert"` with a fixed tool allow-list and deny-list, `--max-turns`, and a log file; or the desktop app's local scheduled task if its permissions can be limited the same way.
- Notification when results are ready (the run summary, optionally a push).

### Stage 3 – Cloud runs for suitable types

- Types whose sources are all reachable via connectors (likely: meeting slots, mail replies) run as a cloud scheduled task, so they also work while the laptop is closed. Offers stay on the laptop as long as templates and references live there.

### Stage 4 – Proposals to delegate

- A run reads new mail and the inbox and *proposes* handovers ("Mail from X asks for a meeting – propose slots?") as inbox items with a prefilled brief. Accepting is the handover; nothing is prepared before.
- Only if stage 0–3 show that one type (for example meeting slots) is reliably right: allow preparing that type without a handover, still as a draft.

## 7. Risks

- **Prompt injection through incoming mail.** A mail can contain instructions. Mitigation: P4 (no sending, no writes outside drafts and the review folder), mail content passed as data, and the review step before anything leaves.
- **Confidentiality.** Mail, CRM and offer content go to the model provider. This is the same exposure as working with Claude interactively today, but it now happens unattended; the run log makes it traceable.
- **Stale context.** A run in the morning works on the state of the morning; the review shows the run's timestamp, and the meeting-slot type re-checks the calendar when the owner opens the result.
- **Review cost.** If reviewing a draft takes as long as writing it, delegation does not pay. Stage 0 measures this.
- **Costs.** Long runs with review loops on the largest model are not cheap; the run log should record token usage per task.

## 8. Open questions

1. Where do offer templates, reference offers and other working files live – OneDrive (reachable from the cloud) or only on the laptop?
2. Is the laptop usually on and awake at the run times?
3. Which Microsoft 365 scopes does the connector have – can it create drafts in the owner's mailbox?
4. Which task types first? Suggested: meeting slots (easy to check, low risk) and mail replies; offers once the brief template is settled.
