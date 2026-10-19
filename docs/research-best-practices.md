# Research: best practices for a GTD-based planning app

Compiled 2026-10-19 from primary sources (gettingthingsdone.com, app documentation, research papers) and reputable write-ups. Each section ends with what it means for Zendo.

## 1. GTD core workflow (David Allen)

- **Five steps:** Capture ("collect what has your attention"), Clarify ("process what it means"), Organize ("put it where it belongs"), Reflect ("review frequently"), Engage ("simply do"). [S1]
- **Clarify decision tree.** Is it actionable? *No* → trash, reference, or incubate (someday/maybe). *Yes* → define the very next physical action. More than one action → it is a *project* (outcome + next action). Next action under two minutes → do it now, while processing. Otherwise delegate (→ waiting for) or defer (→ next-actions list, or the calendar only if day/time-specific). [S1, S2]
- **Organize lists:** Projects, Next Actions (by context), Waiting For, Calendar, Someday/Maybe, Reference, Agendas. The calendar holds only three things: time-specific actions, day-specific actions, day-specific information. It is "sacred territory" – what is on it must happen that day or not at all. Everything else lives on lists. The official blog explicitly warns against using the calendar as a holding pen for tasks that roll from day to day. [S3, S4, S5]
- **Weekly review checklist (official headings):** *Get clear* – collect loose papers, get "in" to zero, empty your head. *Get current* – review action lists, previous calendar data, upcoming calendar (long and short term), waiting-for, project lists "ensuring at least one current action item on each", relevant checklists. *Get creative* – review someday/maybe, "be creative and courageous". [S6]
- **Daily:** Allen defines no formal daily review; practice is calendar first, then next actions by context, then inboxes. "Daily quick scans, weekly thorough reviews." [S5, S7]
- **Engage criteria:** context, time available, energy, priority. Threefold nature of work: predefined work, work as it appears, defining work. [S8]
- **Natural planning model:** purpose and principles → outcome vision → brainstorm → organize → next actions. It does not produce a full roadmap; it produces a clear outcome and one concrete next action at a time. [S9]

**For Zendo:** the Clarify page implements exactly this tree (action / project / meeting / someday / did it / trash). The calendar is separate from tasks (two lanes on Today). The weekly review page covers "get current" automatically (projects without next action, waiting-for with age, overdue) and leaves a journal for "get creative". Projects carry a *desired outcome* field (natural planning) and exactly one next action.

## 2. Weekly and daily planning that pairs with GTD

- **Time blocking (Cal Newport):** "give every minute a job"; keep a capture column next to the grid so interruptions do not break the block; "if you get knocked off this schedule, you simply update it" – plan-and-revise, not plan-and-fail; explicit end-of-day shutdown. Multi-scale planning: quarterly → weekly → daily. [S10, S11]
- **Sunsama daily ritual (documented):** review yesterday's unfinished tasks → pull tasks from backlog/objectives/calendar → sum planned times against a workload threshold (yellow near, red over) with a timeline vs. preferred shutdown time → order and optionally timebox → "Get started". New users should plan "significantly lower than their total available hours", e.g. about 5.5 h of a 9-to-5 day (~70 % load). Unfinished tasks roll to tomorrow; auto-archive after repeated rollovers. [S12, S13, S14]
- **Sunsama weekly:** planning = carry forward or continue objectives, add new ones, short journal; review = objectives progress incl. time on objectives vs. other work, body of work by day, journal on wins/distractions/lessons. [S15, S16]
- **Rule of 3 (J.D. Meier) and 3-3-3 (Burkeman):** three outcomes per day/week; Monday vision, daily outcomes, Friday reflection. Practitioner heuristics, no controlled studies. [S17, S18]
- **Personal kanban:** visualise work, limit work in progress, weekly audit for hidden WIP. [S19]
- **Planning fallacy, with evidence:** Buehler, Griffin & Ross (1994) – students predicted 33.9 days, needed 55.5; only ~30 % finished by their own estimate. Proven remedies: the outside view / reference class (your own past actuals), unpacking tasks into steps (Kruger & Evans 2004), implementation intentions (Gollwitzer & Sheeran 2006, meta-analysis of 94 tests, d ≈ 0.65). The popular "pad by 20–30 %" rule has no research backing; the defensible pattern is to record planned vs. actual and show the user their own ratio. [S20, S21, S22, S23]
- **Rolling two-week horizon:** no canonical source; GTD's review already covers "upcoming calendar, long and short term". Practical pattern: a two-week look-ahead that turns preparation needs into dated actions. [S6]

**For Zendo:** Week view = rough allocation with a capacity bar per day (meetings · blocks · free); Today = timeline with a plan lane, a capacity line and candidates. Weekly review shows planned vs. actual per project to build the owner's own reference class. Roadmap items: load warning at ~70–80 %, weekly objectives (max 3), "top 3 for today", end-of-day shutdown checklist, optional actuals from Toggl.

## 3. How established apps model next actions and dates

- **OmniFocus:** *Defer until* = when an item becomes available; *Due* = must be completed; "due soon" state; flag = important. Sequential projects expose only the first available action; parallel projects expose all. Per-project review interval. Documented pitfall: using due dates for "want done by" creates an overdue list that "creates stress and instils a sense of failure" – reserve due dates for things that are due. [S24, S25, S26]
- **Things 3:** *When* = "when can I start working on this?" (future → Upcoming); *Deadline* = separate, "usually tied to external pressure"; the item stays in Anytime and is listed in Deadlines. Today lists what needs to get done today, with "This Evening". Someday for unclear items. Quick entry via global shortcut. [S27, S28]
- **Todoist:** *Date* = "when you plan to begin working"; *Deadline* = "the hard cutoff" with external consequences. Overdue snowballs; advice is to reschedule to "Todoist Zero". [S29, S30]
- **Nirvana:** Next / Focus ("a short, intentional list of what matters most right now") / Waiting / Scheduled / Someday / Later. A start date hides the item until the date, then returns it with a Focus star. Sequential projects: the first task must be completed before the next becomes active. To highlight something for today, star it rather than dating it. [S31, S32, S33]
- **Everdo:** sequential → only the top-most action enters Next Actions; deferred → scheduled → on the date moves to Next with focus. A due date "does not cause an action or a project to activate", it only flags when past. Sequential mode exists because flat Next lists were overwhelming. Inbox must accept items "with as little friction as possible". [S34, S35, S36]
- **FacileThings:** guided weekly review; next-actions review can hide project actions until the projects step; dashboard = today's calendar + filtered next actions. [S37]

**Consensus:** separate start/planned from due; due only for hard external deadlines; a hand-curated Today/Focus list; sequential-style exposure of one next action per project; per-project review; global-shortcut capture. **Overwhelm sources:** soft due dates → overdue pile; parallel-by-default projects flooding Next; calendar as task holding pen; tag sprawl; a Next list with no load check.

**For Zendo:** `dueDate` vs `plannedDate`/`plannedStart` on every action; one `next` per project enforced in the store; chores are their own single-action list; Today is curated from candidates, never auto-filled.

## 4. Distraction-free / ADHD-friendly UI

- **Progressive disclosure (Nielsen Norman Group):** show primary options only; defer secondary options to a subsidiary screen; what is on the first screen signals importance. [S38]
- **ADHD design guidance:** reveal information only when necessary; do not present multiple tasks or options in one view; consistent layouts; shallow navigation; chunked content; user control over motion and notifications; gentle reminders; progress indicators; auto-save; never rely on recall. [S39]
- **Limit "today":** a single daily view instead of the backlog; "only show 3 tasks" strategies; one-task-at-a-time apps. [S40, S41]
- **Counts and badges:** no peer-reviewed evidence either way; design writing reports "badge fatigue" and anxiety from climbing counts; advice against badges and aggressive motion for ADHD users. Safe default: no sidebar counts, no overdue totals, opt-in only. [S42, S43]
- **Friction-free, keyboard-first capture:** global quick entry, inbox-first, single-key actions, command palette. [S28, S36, S14, S44]
- **Externalise working memory:** visible plans and timers reduce what the brain must hold. [S45]

**For Zendo:** no counts in navigation; the only numbers are on the page you chose to open. Clarify is one card. Today is one day with two lanes. Drawer for details. Quick capture on `n`, `g`+key navigation, Escape closes everything. Reduced-motion honoured.

## Sources

- S1 https://gettingthingsdone.com/what-is-gtd/
- S2 https://facilethings.com/blog/en/the-two-minute-rule
- S3 https://scheduleu.org/why-david-allen-seems-to-be-changing-his-mind-about-scheduling/
- S4 https://efficientlibrarian.com/2021/03/14/keeping-the-calendar-clean/
- S5 https://gettingthingsdone.com/2010/11/dont-be-a-stranger-to-your-lists/
- S6 https://gettingthingsdone.com/wp-content/uploads/2014/10/Weekly_Review_Checklist.pdf
- S7 https://www.cbsnews.com/news/getting-things-done-step-5-review
- S8 https://gettingthingsdone.com/2023/01/choosing-what-to-do/
- S9 https://gettingthingsdone.com/2024/11/the-natural-planning-model/
- S10 https://www.timeblockplanner.com/
- S11 https://calnewport.com/the-time-blocking-revolution-begins/
- S12 https://help.sunsama.com/docs/daily-planning
- S13 https://help.sunsama.com/docs/getting-started/basics/task-rollover-and-recurring-tasks-the-basics
- S14 https://help.sunsama.com/docs/usage-guides/tasks/planned-and-actual-times
- S15 https://help.sunsama.com/docs/weekly-planning
- S16 https://help.sunsama.com/docs/weekly-review
- S17 https://www.stc.org/intercom/?p=13151
- S18 https://griply.app/faq/3-3-3-rule-productivity
- S19 https://personalkanban.com/pk/expert-take-the-realwip-test/
- S20 https://bear.warrington.ufl.edu/brenner/mar7588/Papers/buehler-et-al-1994.pdf
- S21 https://uwspace.uwaterloo.ca/handle/10012/6863
- S22 https://kops.uni-konstanz.de/entities/publication/2e749bfb-8533-437c-8203-7e788c910c5f
- S23 https://www.sunsama.com/blog/time-blocking-tips
- S24 https://support.omnigroup.com/documentation/omnifocus/mac/4/en/glossary/
- S25 https://support.omnigroup.com/documentation/omnifocus/mac/2.7/en/review
- S26 https://learnomnifocus.com/tutorial/common-omnifocus-pitfalls/
- S27 https://culturedcode.com/things/support/articles/2803579/
- S28 https://culturedcode.com/things/support/articles/2249437/
- S29 https://todoist.com/help/articles/introduction-to-deadlines-uMqbSLM6U
- S30 https://todoist.com/help/articles/how-to-plan-your-day-UVUXaiSs
- S31 https://www.nirvanahq.com/help/how-to/due-dates-and-start-dates
- S32 https://www.nirvanahq.com/help/how-to/create-a-project
- S33 https://www.nirvanahq.com/help/how-to/focus-list
- S34 https://everdo.net/docs/features/projects
- S35 https://everdo.net/docs/features/scheduling/
- S36 https://everdo.net/benefits/built-for-gtd-getting-things-done/
- S37 https://facilethings.com/blog/en/the-weekly-review-updated
- S38 https://www.nngroup.com/videos/progressive-disclosure/
- S39 https://digitalcommunications.wp.st-andrews.ac.uk/2025/02/12/designing-for-users-with-adhd/
- S40 https://www.any.do/blog/the-best-to-do-list-app-for-adhd-how-to-stay-organized-when-your-brain-fights-structure/
- S41 https://mwm.ai/apps/crumple-adhd-planner/6776269441
- S42 https://www.dolfy.ai/blog/notification-badge-problem-red-dot-mobile-apps
- S43 https://vp0.com/blogs/adhd-friendly-mobile-app-ui-guidelines
- S44 https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/
- S45 https://www.medicalnewstoday.com/articles/adhd-and-organization

Caveats: Allen's clarify-tree details come from the book via secondary sources; the official site gives the five-step summary. OmniFocus review documentation cited is v2.7 (unchanged in v4 per glossary). Buffer percentages are rules of thumb, not research.
