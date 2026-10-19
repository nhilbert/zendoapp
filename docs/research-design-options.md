# Research: design options for a calm planning app

Compiled 2026-10-19. Part A surveys reference apps and guidance; Part B lists the options considered for Zendo and the decisions taken for the prototype.

## Part A – What makes planning apps feel calm (or noisy)

### Reference apps and patterns worth borrowing

| App | Borrow | Avoid |
|---|---|---|
| **Things 3** | Two dates, not one: a start date "merely indicates the day on which you want to begin work"; deadlines define the date by which you must finish and never auto-jump an item into Today. Five lists only. Global quick entry; Esc discards. [1][2] | – |
| **Sunsama** | Guided morning ritual and daily shutdown; planned vs. actual per task; drag a task onto the calendar to create a block of its planned duration; weekly objectives. [3][4] | Integration panels everywhere. |
| **Akiflow** | Universal inbox, Cmd+K capture, daily rituals. [5] | Feature density. |
| **Amie** | Todos and calendar in one view, drag-to-calendar; "too simple" for power users – which is the point. [6] | – |
| **Notion Calendar (Cron)** | Command menu and shortcuts; monospaced time numerals; soft colour fills instead of borders. [7][8] | – |
| **Morgen** | "Frames": template an ideal week that the planner fills; nothing auto-commits. [9] | – |
| **Linear** | Theme from three inputs (base, accent, contrast) in LCH; neutral palette by *removing* brand blue; hierarchy mostly via opacities of black/white; Inter Display headings, Inter body; "reduce visual noise, maintain visual alignment". `C` creates, Cmd+K command bar. [10][11] | – |
| **Superlist** | ⌘1 Inbox / ⌘2 Today, ⌘N new task; notes live inside tasks. [12][13] | Sound effects, team features. |
| **Godspeed** | Every action from the keyboard; palette lists the commands available right now; natural-language dates. [14] | – |
| **Routine** | "Capture anything in a keystroke"; "plan your week in one screen". [15] | – |
| **Tweek** | Seven day columns, drag between days, "Someday" columns, "as natural as pen and paper". Direct model for a two-week grid. [16][17] | – |
| **TeuxDeux** | "Uncomplicated as a piece of paper", built like a calendar, unfinished items roll to the next day. [18] | – |
| **Structured** | One vertical timeline merging tasks and events, drag to rearrange. Model for the daily timetable. [19] | Per-block icons and colours. |
| **Reclaim** | Protected ("defended") focus blocks; preview-and-approve before changes apply. [20] | AI auto-scheduling. |
| **zentodo.in** (owner's pointer) | "Organize. Flow. Focus." – Capture → Organize → Engage; "No clutter. No endless sub-menus"; notifications, colours and popups framed as attention fragmenters; a full-screen "Zen mode" focus timer; time blocking. | AI-everything, extension capture tied to a browser. |

### Visual guidance for "calm"

- **Hierarchy (Refactoring UI):** "de-emphasise to emphasise"; start with too much white space; use fewer borders – spacing or background shifts instead; fixed spacing scale (4/8/12/16/24/32/48/64); a defined type scale; HSL/LCH rather than hex. [21][22]
- **Calm technology (Amber Case):** "require the smallest possible amount of attention"; "make use of the periphery"; "can communicate, but doesn't need to speak"; "the minimum needed to solve the problem". Implication: no badges, counters, toasts by default; state in the periphery (a faint capacity bar), not a modal. [23]
- **Apple HIG:** colour can be distracting – use it to create meaning (hierarchy, grouping, interaction); pick one tint; never colour alone; 4.5:1 text contrast; test dark mode separately. [24]
- **Material 3:** `outline-variant` for dividers, never to define a tappable boundary; dark theme is dark grey, not black; elevation = lighter surface; desaturated accents. [25][26]
- **Palette recipe (Linear-style):** one neutral base, one accent reserved for "next action"/selection, one or two semantic colours (overdue, attention) only; greys via opacity of the ink colour; OKLCH so steps look even. [10]
- **Type:** Inter (OFL, tall x-height, `tnum` for times, `cv11` single-storey a) [27]; Geist (Swiss-minimal) [28]; Source Sans 3 (warmer humanist) [29]; IBM Plex Sans (technical) [30]. Practical: Inter or Geist; weights 400/500/600 only; 13–14 px in lists, 15–16 px body; 45–90 characters per line. [31]
- **Background:** pure white reads harsh over long sessions; a slight warm or cool tint is the consensus heuristic; light and dark both available. [32]
- **Motion:** honour `prefers-reduced-motion`; keep feedback motion (drop flash, reorder), remove decorative motion. [33]

### Interaction patterns

- **Quick capture:** global hotkey, single input, natural-language dates, always to Inbox, Esc discards. [2][14][15]
- **Inbox clarify flow (GTD):** "Process the first item first. Process one item at a time. Never put anything back in." → one card, fixed outcomes, a counter, no "put back". [34]
- **Kanban drag and drop (Atlassian guidelines):** make clear what can be dragged, what is being dragged, and what the result will be; a 2 px line for relative placement or a background highlight for the drop zone, never both; original stays at ~40 % opacity; a short drop flash; optimistic updates; cards are implied draggables (no handle); always provide a non-drag "Move to…" alternative. [35][36]
- **Time blocking:** drag from a list onto the timeline creates a block of the planned duration; resize to adjust; keyboard auto-place as fallback. [4]
- **Broad blocks on a week grid:** allocate in fractions of capacity (Float uses % and half-days); plan ~80 % and leave 20 % open; day columns with a quiet per-day readout. [37]
- **Keyboard conventions:** Gmail j/k, c, /, ?, g-then-i [38]; Linear C and Cmd+K [11]; Superlist ⌘1/⌘2/⌘N [12]; palette focuses search on open, arrows/Enter/Esc. [39]

### Technical options (React + TypeScript)

- **Drag and drop:** `@dnd-kit/core` 6.3 (stable; keyboard sensor, ARIA announcements) [40]; `@dnd-kit/react` 0.5 (new architecture, still 0.x) [41][42]; Atlassian `pragmatic-drag-and-drop` 4.0 (≈4.7 kB core, wraps native HTML5 DnD, powers Trello/Jira; accessibility via alternative controls, deliberately no keyboard dragging) [43][44][45]; raw HTML5 DnD (weak touch story, cursor fixed by `dropEffect`). [46]
- **i18n:** react-i18next (largest ecosystem, ~14 kB, plural forms as suffixed keys) vs. Lingui (ICU, extraction, ~2 kB runtime) [47] vs. Paraglide (compiles messages to typed functions, tree-shaken, "typos become compile errors"). [48] Dates via `Intl.DateTimeFormat` (Baseline). [49]
- **Styling:** Tailwind v4 `@theme` variables become `:root` custom properties and utilities; `@theme inline` for var-to-var; dark mode via media query or a `data-theme` variant. Plain CSS variables suffice for a small component set; Tailwind buys a constrained spacing scale. [50][51]
- **Dates:** date-fns v4 (ESM-first, `@date-fns/tz`) [52]; Temporal is Stage 4 (March 2026) but Safari lags – date-fns or `Intl` now, Temporal later. [53][54]

## Part B – Options considered for Zendo and decisions

### B1. Visual direction

| Option | Character | Risk |
|---|---|---|
| **A. "Paper" – warm off-white, near-black ink, one sage accent** | Quiet, analogue, reads like good stationery; colour only for meaning (sage = next action/selection, amber = attention, rose = overdue); project colours muted and used as 13 % tints. | Can look bland if spacing and type are not precise. |
| B. "Slate" – cool greys, blue-ish accent, Linear-like | Crisp, technical, very familiar to developers. | Reads like a dev tool; cooler, less calming for long reflective sessions. |
| C. "Editorial" – serif display headings (e.g. Fraunces/Newsreader) on warm paper | Distinctive, literary. | Serif headings at UI sizes get noisy; two families to tune. |

**Decision: A.** Implemented as CSS tokens in `src/index.css` (`--paper`, `--ink`, `--accent`, semantic `--amber`/`--rose`, eight muted project colours) with a dark variant that is dark grey, not black. Single family: Inter Variable, weights 400/500 only, `tnum` on all times. Spacing scale from Tailwind; borders replaced by spacing and `surface-2` background shifts wherever possible.

### B2. Layout

- Persistent slim left sidebar with text labels and small icons; no counts. Content column widths depend on the view: 42 rem for Inbox/Clarify/Review (reading width), 48 rem for projects, full width for Board, Week, Today.
- Detail editing in a right-hand drawer (progressive disclosure), never inline forms on rows.
- Quick capture is a centred modal with one textarea.

### B3. Interaction

- Keyboard: `n` capture, `g` then letter to navigate, `1–6` to pick the kind on Clarify, `Esc` closes everything. Command palette (⌘K) is planned.
- Drag and drop on Board (status), Week (project → day, block → day) and Today (task → time slot / untimed list). Original stays at 40 % opacity; a drop zone highlights with the accent tint; a drag overlay carries the card. Non-drag alternatives exist everywhere (status select, "+" buttons, time field).
- Dates: native date/time inputs for now (reliable, localised by the browser); natural-language entry later.

### B4. Technology choices for the prototype

| Concern | Choice | Alternatives considered |
|---|---|---|
| Framework | React 19 + TypeScript + Vite 8 | SvelteKit (smaller), Solid (faster) – React has the broadest ecosystem for DnD and i18n. |
| Styling | Tailwind CSS v4 with custom tokens | Vanilla CSS modules – viable; Tailwind chosen for the constrained scale and speed of iteration. |
| State | Zustand + `persist` (localStorage) behind store actions that mirror the future API | Redux Toolkit (heavier), TanStack Query (for the server phase). |
| DnD | `@dnd-kit/core` 6.3 (keyboard sensor, overlay, custom collision) | Pragmatic DnD (smaller, native) – no keyboard dragging; `@dnd-kit/react` – still 0.x. Revisit if block resizing needs pointer math. |
| i18n | i18next + react-i18next with typed keys (module augmentation) | Paraglide/Lingui – typed and smaller; i18next chosen for familiarity and runtime switching. Easy to migrate later because all strings already live in JSON. |
| Dates | Hand-rolled ISO helpers + `Intl` | date-fns v4 when range/recurrence maths grows; Temporal later. |
| Icons | lucide-react, 1.75 px stroke, used sparingly | – |
| Fonts | Self-hosted Inter Variable (`@fontsource-variable/inter`) – no network | Geist – also fine; Inter has better German diacritics coverage at small sizes. |

### B5. What the first prototype deliberately leaves out

Command palette, natural-language dates, block resizing by drag, manual ordering inside columns, recurring chores, weekly objectives, animations beyond a fade and drop highlight, theme toggle (follows the system), and mobile layout.

## Sources

1. https://culturedcode.com/things/support/articles/2803579/
2. https://culturedcode.com/things/support/articles/2249437/
3. https://www.sunsama.com/
4. https://help.sunsama.com/docs/timeboxing-how-to-timebox-a-task-to-the-calendar
5. https://akiflow.com/
6. https://amie.so/
7. https://www.notion.com/product/calendar
8. https://blakecrosley.com/guides/design/notion-calendar
9. https://www.morgen.so/
10. https://linear.app/now/how-we-redesigned-the-linear-ui
11. https://linear.app/docs/creating-issues
12. https://help.superlist.com/en/articles/10059-keyboard-shortcuts
13. https://www.superlist.com/
14. https://apps.apple.com/app/id6451131801
15. https://routine.co/
16. https://tweek.so/
17. https://gappsy.com/tools/tweek/
18. https://teuxdeux.com/story
19. https://structured.app/
20. https://reclaim.ai/
21. https://www.refactoringui.com/
22. https://dev.to/updivision/book-review-refactoring-ui-by-adam-wathan-steve-schoger-2f7m
23. https://calmtech.com/
24. https://developer.apple.com/design/human-interface-guidelines/color
25. https://m3.material.io/styles/color/roles
26. https://m2.material.io/design/color/dark-theme
27. https://rsms.me/inter/
28. https://vercel.com/font
29. https://en.wikipedia.org/wiki/Source_Sans_3
30. https://en.wikipedia.org/wiki/IBM_Plex
31. https://practicaltypography.com/line-length.html
32. https://madegooddesigns.com/?p=6055
33. https://web.dev/articles/prefers-reduced-motion
34. https://facilethings.com/blog/en/basics-processing-guidelines
35. https://atlassian.design/components/pragmatic-drag-and-drop/design-guidelines
36. https://atlassian.design/components/pragmatic-drag-and-drop/accessibility-guidelines
37. https://support.float.com/en/articles/4188692-allocate-time
38. https://support.google.com/mail/answer/6594
39. https://www.techinterview.org/post/3233475212/build-command-palette-cmd-k/
40. https://github.com/clauderic/dnd-kit
41. https://registry.npmjs.org/@dnd-kit/react/latest
42. https://dndkit.com/
43. https://github.com/atlassian/pragmatic-drag-and-drop
44. https://atlassian.design/components/pragmatic-drag-and-drop/accessibility-guidelines
45. https://atlassian.design/components/pragmatic-drag-and-drop/web-platform-design-constraints
46. https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API
47. https://lingui.dev/misc/i18next
48. https://paraglidejs.com/
49. https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat
50. https://tailwindcss.com/docs/theme
51. https://tailwindcss.com/docs/dark-mode
52. https://blog.date-fns.org/v40-with-time-zone-support/
53. https://caniuse.com/temporal
54. https://www.zentodo.in/
