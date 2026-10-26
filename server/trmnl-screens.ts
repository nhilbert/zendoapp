import type { CalendarEvent, HHMM, ISODate, PlanBlock, Project, Settings, Task } from '../src/domain/types.ts'
import { DEFAULT_SETTINGS } from '../src/domain/types.ts'
import { addDaysISO, compareISO, durationMinutes, fmtDate, fmtHours, fmtTime, fmtWeekday, hhmmToMinutes, isoWeekNumber, minutesToHHMM } from '../src/domain/dates.ts'
import {
  blocksOn,
  candidatesForDay,
  compareProjects,
  dayCapacity,
  eventsOn,
  isBlocking,
  isOpen,
  isOverplanned,
  isWorkable,
  leftoverTasks,
  safeTimes,
  sortByTime,
  sortTasks,
  tasksPlannedOn,
  visibleBlocks,
  WORKSHOP_FULL_DAY_MINUTES,
} from '../src/domain/selectors.ts'
import { translator, type Translate } from './i18n.ts'

/**
 * The screens Zendo renders for a TRMNL e-ink display (docs/trmnl.md): today's to-dos, today's schedule
 * and the next five days of the week plan, each for the four TRMNL layouts (full screen and the
 * mashup slots). Pure: state in, HTML out. The HTML uses the TRMNL framework (layout, title_bar)
 * plus a few own rules, black on white only, since the original TRMNL dithers grey.
 *
 * Private projects and tasks are always left out and private appointments show as "Busy", whatever
 * the app's "hide private" setting: the display hangs on a wall and TRMNL's servers render it.
 */

export type TrmnlView = 'todos' | 'schedule' | 'week'
export const TRMNL_VIEWS: TrmnlView[] = ['todos', 'schedule', 'week']
export const VIEW_LABEL_KEY: Record<TrmnlView, string> = { todos: 'trmnl.viewTodos', schedule: 'trmnl.viewSchedule', week: 'trmnl.viewWeek' }

export interface DisplayState {
  projects: Project[]
  tasks: Task[]
  events: CalendarEvent[]
  blocks: PlanBlock[]
  settings: Partial<Settings>
}

interface DisplayData {
  projects: Project[]
  tasks: Task[]
  events: CalendarEvent[]
  blocks: PlanBlock[]
  settings: Settings
}

export type Screens = { markup: string; markup_half_horizontal: string; markup_half_vertical: string; markup_quadrant: string }

/** What the display may show: the app's visibility rules with "hide private" always on. */
export function displayData(state: DisplayState, busy: string): DisplayData {
  const privateIds = new Set(state.projects.filter((p) => p.private).map((p) => p.id))
  const projects = state.projects.filter((p) => p.status !== 'archived' && !p.private).sort(compareProjects)
  const workable = new Set(projects.filter(isWorkable).map((p) => p.id))
  return {
    projects,
    tasks: state.tasks.filter((t) => !t.private && (!t.projectId || workable.has(t.projectId))),
    blocks: visibleBlocks(state.blocks, state.projects, true),
    // Masked, never removed: their time is still taken.
    events: state.events.map((e) =>
      e.private || (e.projectId && privateIds.has(e.projectId)) ? { ...e, title: busy, location: undefined, joinUrl: undefined, projectId: null } : e,
    ),
    settings: safeTimes({ ...DEFAULT_SETTINGS, ...state.settings }),
  }
}

/** HTML-escapes text and turns Liquid's braces into entities: TRMNL parses the markup as a Liquid template. */
export function esc(s: string): string {
  return s.replace(/[&<>"'{}%]/g, (ch) => `&#${ch.charCodeAt(0)};`)
}

const STYLE = `<style>
.z{width:100%;height:100%;display:flex;flex-direction:column;color:#000;font-family:"Inter Variable",Inter,sans-serif;font-size:20px;line-height:1.25}
.z-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding-bottom:6px;border-bottom:2px solid #000;margin-bottom:6px}
.z-head b{font-size:22px}.z-head span{font-size:16px;white-space:nowrap}
.z-row{display:flex;align-items:center;gap:10px;min-height:34px;border-bottom:1px solid #000}
.z-row:last-child{border-bottom:0}
.z-box{flex:none;width:16px;height:16px;border:2px solid #000;border-radius:3px}
.z-ring{flex:none;width:16px;height:16px;border:2px solid #000;border-radius:50%}
.z-t{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.z-proj{flex:none;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.z-r{flex:none;font-size:16px;white-space:nowrap}
.z-mark{flex:none;font-size:14px;font-weight:700;border:1.5px solid #000;border-radius:4px;padding:0 5px;white-space:nowrap}
.z-sec{font-size:15px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;margin-top:10px;padding-bottom:2px}
.z-more,.z-empty{font-size:16px;padding-top:6px}
.z-allday{font-size:16px;margin-bottom:4px}
.z-grid{position:relative;flex:1;min-height:0;margin-left:44px}
.z-hour{position:absolute;left:-44px;right:0;border-top:1px solid #000;font-size:13px;line-height:1}
.z-hour span{position:absolute;left:0;top:2px}
.z-ev,.z-task{position:absolute;box-sizing:border-box;border:2px solid #000;border-radius:4px;padding:1px 6px;overflow:hidden;display:flex;gap:8px;align-items:flex-start;font-size:16px;line-height:1.2}
.z-ev,.z-task{background:#fff}.z-ev{border-left-width:8px}.z-task{border-style:dashed}
.z-ev .z-t{font-weight:700}.z-task .z-t{font-weight:500}
.z-short{font-size:13px;padding-top:0;padding-bottom:0;align-items:center}
.z-now{position:absolute;left:-44px;right:0;border-top:3px dashed #000}
.z-now span{position:absolute;right:0;top:-20px;font-size:13px;background:#fff;padding:0 4px}
.zw{flex:1;min-height:0;display:grid;column-gap:12px;font-size:14px;line-height:17px}
.zw-h{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;align-self:end;padding-bottom:3px}
.zw-c{border-top:1px solid #000;padding:4px 0;overflow:hidden;min-width:0;hyphens:auto;overflow-wrap:anywhere}.zw-long{grid-column:span 2}
.zw-e{padding-left:10px;text-indent:-10px}.zw-e b{font-weight:700}.zw-long .zw-e:first-child{font-weight:700}
.zw-d b{font-size:17px;line-height:21px}.zw-d span{display:block;font-size:13px;line-height:17px}.zw-tight{font-weight:700}
.zw-today b{display:inline-block;background:#000;color:#fff;border-radius:4px;padding:0 5px}
.zw-more{font-size:13px}
</style>`

interface Ctx {
  d: DisplayData
  t: Translate
  locale: string
  today: ISODate
  now: HHMM
}

function screen(lang: string, title: string, instance: string, body: string): string {
  return `${STYLE}<div class="layout layout--col layout--top layout--left layout--stretch"><div class="z" lang="${esc(lang)}">${body}</div></div>` +
    `<div class="title_bar"><span class="title">${esc(title)}</span><span class="instance">${esc(instance)}</span></div>`
}

const longDate = (c: Ctx) => fmtDate(c.today, c.locale, { weekday: 'long', day: 'numeric', month: 'long' })
const updated = (c: Ctx) => c.t('trmnl.updated', { time: fmtTime(c.now, c.locale) })
const head = (left: string, right: string) => `<div class="z-head"><b>${esc(left)}</b><span>${esc(right)}</span></div>`

/** Cuts a list to `max` rows; the last row then says how many more there are. */
function clip(rows: string[], max: number, t: Translate): string {
  if (rows.length <= max) return rows.join('')
  return rows.slice(0, max - 1).join('') + `<div class="z-more">${esc(t('trmnl.more', { count: rows.length - max + 1 }))}</div>`
}

// ---------- to-dos ----------

function todos(c: Ctx, maxRows: number, compact: boolean): string {
  const { d, t, today } = c
  const project = (id: string | null) => (id ? d.projects.find((p) => p.id === id)?.name : undefined)
  const mark = (task: Task) =>
    task.dueDate && compareISO(task.dueDate, today) < 0
      ? t('today.overdue')
      : task.dueDate === today
        ? t('today.dueToday')
        : task.plannedDate && compareISO(task.plannedDate, today) < 0
          ? t('today.leftover')
          : undefined
  const row = (task: Task, right?: string) => {
    const m = mark(task)
    const name = !compact && project(task.projectId)
    return `<div class="z-row"><span class="z-box"></span><span class="z-t">${esc(task.title)}</span>${name ? `<span class="z-proj">${esc(name)}</span>` : ''}` +
      `${m ? `<span class="z-mark">${esc(m)}</span>` : ''}${right ? `<span class="z-r">${esc(right)}</span>` : ''}</div>`
  }
  const planned = tasksPlannedOn(d.tasks, today).filter(isOpen)
  const timed = planned.filter((x) => x.plannedStart).sort(sortByTime)
  const untimed = planned.filter((x) => !x.plannedStart).sort(sortTasks)
  // Then, as on Today: unfinished tasks planned for an earlier day, deadlines not yet in today's plan,
  // and one next step per project blocked in the week plan.
  const leftovers = leftoverTasks(d.tasks, today)
  const cands = candidatesForDay(today, d.tasks, d.blocks, d.projects, new Set(leftovers.map((x) => x.id)))
  const rows = [
    ...timed.map((x) => row(x, fmtTime(x.plannedStart!, c.locale))),
    ...untimed.map((x) => row(x)),
    ...leftovers.map((x) => row(x)),
    ...cands.overdue.map((x) => row(x)),
    ...cands.due.map((x) => row(x)),
  ]
  const next = cands.fromBlocks.map(({ project: p, task }) =>
    task
      ? `<div class="z-row"><span class="z-ring"></span><span class="z-t">${esc(task.title)}</span>${compact ? '' : `<span class="z-proj">${esc(p.name)}</span>`}</div>`
      : `<div class="z-row"><span class="z-ring"></span><span class="z-t">${esc(t('today.nextMissing', { project: p.name }))}</span></div>`,
  )
  const cap = dayCapacity(today, d.settings, d.events, d.blocks, d.tasks)
  let body = compact ? '' : head(longDate(c), t('week.planned', { hours: fmtHours(cap.plannedTaskMinutes, c.locale) }))
  if (!rows.length && !next.length) return body + `<div class="z-empty">${esc(t('trmnl.noTodos'))}</div>`
  // The week plan's suggestions get what the plan leaves, at least a header and one row when there are any.
  const forNext = next.length ? Math.min(next.length + 1, Math.max(2, maxRows - rows.length)) : 0
  body += clip(rows, maxRows - forNext, t)
  if (forNext) body += `<div class="z-sec">${esc(t('today.fromBlocks'))}</div>` + clip(next, forNext - 1, t)
  return body
}

// ---------- schedule ----------

interface Slot {
  title: string
  start: number
  end: number
  kind: 'event' | 'task'
}

function slotsOf(c: Ctx): { slots: Slot[]; allDay: CalendarEvent[] } {
  const events = eventsOn(c.d.events, c.today).filter(isBlocking)
  const slots: Slot[] = events
    .filter((e) => !e.allDay)
    .map((e) => ({ title: e.title, start: hhmmToMinutes(e.start), end: Math.max(hhmmToMinutes(e.end), hhmmToMinutes(e.start) + 15), kind: 'event' as const }))
  for (const task of tasksPlannedOn(c.d.tasks, c.today).filter((x) => isOpen(x) && x.plannedStart)) {
    const start = hhmmToMinutes(task.plannedStart!)
    slots.push({ title: task.title, start, end: start + (task.estimateMinutes ?? 30), kind: 'task' })
  }
  return { slots: slots.sort((a, b) => a.start - b.start || b.end - a.end), allDay: events.filter((e) => e.allDay) }
}

/** Side-by-side lanes for overlapping items: each cluster of overlaps is split into as many lanes as it needs. */
function lanes(slots: Slot[]): { slot: Slot; lane: number; of: number }[] {
  const out: { slot: Slot; lane: number; of: number }[] = []
  let cluster: { slot: Slot; lane: number; of: number }[] = []
  let ends: number[] = []
  let clusterEnd = -1
  const flush = () => {
    for (const x of cluster) x.of = ends.length
    out.push(...cluster)
    cluster = []
    ends = []
  }
  for (const slot of slots) {
    if (slot.start >= clusterEnd) flush()
    let lane = ends.findIndex((end) => end <= slot.start)
    if (lane < 0) lane = ends.push(0) - 1
    ends[lane] = slot.end
    clusterEnd = Math.max(clusterEnd, slot.end)
    cluster.push({ slot, lane, of: 0 })
  }
  flush()
  return out
}

function scheduleTimeline(c: Ctx): string {
  const { d, t } = c
  const { slots, allDay } = slotsOf(c)
  // The day's budget window (meetings count only inside it), widened to everything scheduled.
  let from = hhmmToMinutes(d.settings.budgetStart)
  let to = hhmmToMinutes(d.settings.budgetEnd)
  for (const s of slots) {
    from = Math.min(from, s.start)
    to = Math.max(to, s.end)
  }
  from = Math.floor(from / 60) * 60
  to = Math.min(24 * 60, Math.ceil(to / 60) * 60)
  const pct = (m: number) => `${(((m - from) / (to - from)) * 100).toFixed(2)}%`
  const step = to - from > 12 * 60 ? 120 : 60
  let grid = ''
  for (let m = from; m < to; m += step) grid += `<div class="z-hour" style="top:${pct(m)}"><span>${esc(fmtTime(minutesToHHMM(m), c.locale).slice(0, 2))}</span></div>`
  for (const { slot, lane, of } of lanes(slots)) {
    const short = slot.end - slot.start < 45
    const range = `${fmtTime(minutesToHHMM(slot.start), c.locale)}–${fmtTime(minutesToHHMM(slot.end), c.locale)}`
    grid +=
      `<div class="${slot.kind === 'event' ? 'z-ev' : 'z-task'}${short ? ' z-short' : ''}" style="top:${pct(slot.start)};height:${pct(from + slot.end - slot.start)};` +
      `left:calc(${(lane / of) * 100}% + 2px);width:calc(${100 / of}% - 4px)"><span class="z-t">${esc(slot.title)}</span>${of === 1 ? `<span class="z-r">${esc(range)}</span>` : ''}</div>`
  }
  const nowMin = hhmmToMinutes(c.now)
  if (nowMin >= from && nowMin <= to) grid += `<div class="z-now" style="top:${pct(nowMin)}"><span>${esc(t('today.now'))} ${esc(fmtTime(c.now, c.locale))}</span></div>`
  const all = allDay.length ? `<div class="z-allday"><b>${esc(t('today.allDay'))}:</b> ${esc(allDay.map((e) => e.title).join(' · '))}</div>` : ''
  return all + `<div class="z-grid">${grid}</div>`
}

/** Short slots: what is still ahead today, as a list. */
function scheduleList(c: Ctx, maxRows: number): string {
  const { slots, allDay } = slotsOf(c)
  const nowMin = hhmmToMinutes(c.now)
  const ahead = slots.filter((s) => s.end > nowMin)
  const rows = [
    ...allDay.map((e) => `<div class="z-row"><span class="z-r">${esc(c.t('today.allDay'))}</span><span class="z-t">${esc(e.title)}</span></div>`),
    ...ahead.map(
      (s) => `<div class="z-row"><span class="z-r">${esc(fmtTime(minutesToHHMM(s.start), c.locale))}</span><span class="${s.kind === 'event' ? 'z-box' : 'z-ring'}"></span><span class="z-t">${esc(s.title)}</span></div>`,
    ),
  ]
  return rows.length ? clip(rows, maxRows, c.t) : `<div class="z-empty">${esc(c.t('trmnl.nothingScheduled'))}</div>`
}

function schedule(c: Ctx, narrow = false): string {
  const cap = dayCapacity(c.today, c.d.settings, c.d.events, c.d.blocks, c.d.tasks)
  // The Today page's capacity line, word for word.
  const capacity = c.t('today.capacity', {
    meetings: fmtHours(cap.meetingMinutes, c.locale),
    planned: fmtHours(cap.plannedTaskMinutes, c.locale),
    free: fmtHours(Math.max(0, cap.workMinutes - cap.meetingMinutes - cap.plannedTaskMinutes), c.locale),
  })
  // Half a screen wide, the date would wrap: the capacity line alone.
  return (narrow ? `<div class="z-head"><span>${esc(capacity)}</span></div>` : head(longDate(c), capacity)) + scheduleTimeline(c)
}

// ---------- week ----------

/** The next five days from today: work days, plus days off that hold blocks or busy appointments. */
function weekDays(c: Ctx, count: number): ISODate[] {
  const out: ISODate[] = []
  for (let i = 0; out.length < count && i < 21; i++) {
    const date = addDaysISO(c.today, i)
    const cap = dayCapacity(date, c.d.settings, c.d.events, c.d.blocks, c.d.tasks)
    if (cap.isWorkDay || blocksOn(c.d.blocks, date).length || eventsOn(c.d.events, date).some(isBlocking)) out.push(date)
  }
  return out
}

const SIZE_FRACTION: Record<number, string> = { 0.25: '¼', 0.5: '½', 0.75: '¾' }
function fmtSize(size: number): string {
  const whole = Math.floor(size)
  const frac = SIZE_FRACTION[Math.round((size - whole) * 4) / 4] ?? ''
  return `${whole || !frac ? whole : ''}${frac}`
}

// Morning and afternoon split at noon by start time; a meeting from 11:30 belongs to the morning.
const NOON = 12 * 60
/** Inter's average glyph width in em, a little generous so the estimate errs towards wrapping. */
const CHAR_EM = 0.56
const WEEK_FONT = 14
const WEEK_LINE = 17

/** Lines a text takes when wrapped at word boundaries into `width` px at `font` px (an estimate). */
export function wrappedLines(text: string, width: number, font = WEEK_FONT): number {
  const perLine = Math.max(1, Math.floor(width / (font * CHAR_EM)))
  let lines = 1
  let used = 0
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (used && used + 1 + word.length <= perLine) {
      used += 1 + word.length
      continue
    }
    if (used) lines++
    const extra = Math.ceil(word.length / perLine) - 1
    lines += extra
    used = word.length - extra * perLine
  }
  return lines
}

interface Entry {
  text: string
  html: string
}

/**
 * Entries that fit into `maxLines` wrapped lines, never cut mid-text: what does not fit is counted
 * in a "+ n more" line instead. A single entry longer than the whole cell is still shown.
 */
function fit(entries: Entry[], width: number, maxLines: number, t: Translate): string {
  const need = entries.map((e) => wrappedLines(e.text, width))
  if (need.reduce((a, b) => a + b, 0) <= maxLines) return entries.map((e) => e.html).join('')
  let shown = 0
  let used = 0
  while (shown < entries.length && used + need[shown] <= maxLines - 1) used += need[shown++]
  shown = Math.max(shown, 1)
  const rest = entries.length - shown
  return entries.slice(0, shown).map((e) => e.html).join('') + (rest ? `<div class="zw-more">${esc(t('trmnl.more', { count: rest }))}</div>` : '')
}

function dayPlan(c: Ctx, date: ISODate) {
  const { d, t, locale } = c
  const cap = dayCapacity(date, d.settings, d.events, d.blocks, d.tasks)
  const status = cap.fullDay
    ? t('week.fullDayShort')
    : isOverplanned(cap)
      ? t('week.overplanned')
      : cap.isWorkDay
        ? t('week.free', { hours: fmtHours(cap.freeMinutes, locale) })
        : t('week.offDay')
  const events = eventsOn(d.events, date).filter(isBlocking)
  // All-day appointments and full-day workshops take the whole row instead of morning and afternoon.
  const takesDay = (e: CalendarEvent) => !!e.allDay || (e.kind === 'workshop' && durationMinutes(e.start, e.end) >= WORKSHOP_FULL_DAY_MINUTES)
  const entry = (e: CalendarEvent, range = false): Entry => {
    const time = e.allDay ? '' : range ? `${fmtTime(e.start, locale)}–${fmtTime(e.end, locale)}` : fmtTime(e.start, locale)
    return { text: `${time} ${e.title}`.trim(), html: `<div class="zw-e">${time ? `<b>${esc(time)}</b> ` : ''}${esc(e.title)}</div>` }
  }
  const long = events.filter(takesDay)
  const rest = events.filter((e) => !takesDay(e))
  // One entry per project, however many blocks it has that day.
  const sizes = new Map<string | null, number>()
  for (const b of blocksOn(d.blocks, date)) sizes.set(b.projectId, (sizes.get(b.projectId) ?? 0) + b.size)
  const focus = [...sizes].map(([id, size]): Entry => {
    const name = id ? (d.projects.find((p) => p.id === id)?.name ?? '') : t('week.chores')
    return { text: `${name} ${fmtSize(size)}`, html: `<div class="zw-e">${esc(name)} <b>${esc(fmtSize(size))}</b></div>` }
  })
  // "Mo 26." / "Mon 26": the weekday without its abbreviation dot; German writes the day as an ordinal.
  const label = `${fmtWeekday(date, locale).replace(/\.$/, '')} ${fmtDate(date, locale, { day: 'numeric' })}${locale === 'de' ? '.' : ''}`
  return {
    label,
    status,
    tight: cap.fullDay || isOverplanned(cap),
    free: cap.isWorkDay && !cap.fullDay ? cap.freeMinutes : 0,
    long: long.length ? [...long.map((e) => entry(e, true)), ...rest.map((e) => entry(e))] : null,
    morning: rest.filter((e) => hhmmToMinutes(e.start) < NOON).map((e) => entry(e)),
    afternoon: rest.filter((e) => hhmmToMinutes(e.start) >= NOON).map((e) => entry(e)),
    focus,
  }
}

/**
 * The week as a table: one row per day with what is left, the morning's and the afternoon's
 * appointments and the plan blocks (focus). Sizes are those of the TRMNL view, so the text estimate
 * knows how much fits: each row gets the lines it needs, and only when the week does not fit are the
 * fullest rows shortened (their cells then end in "+ n more"). Without `halves` (half a screen wide)
 * only day and focus remain.
 */
function weekTable(c: Ctx, days: ISODate[], view: { width: number; height: number; halves: boolean }): string {
  const DAY = 88
  const FOCUS = 160
  const GAP = 12
  const ROW_PAD = 9 // padding and the rule above each row
  const INDENT = 10 // continuation lines are indented, so wrapped entries stay apart
  const inner = view.width - 20
  const half = Math.floor((inner - DAY - FOCUS - 3 * GAP) / 2)
  const focusWidth = view.halves ? FOCUS : inner - DAY - GAP
  const plans = days.map((date) => ({ date, x: dayPlan(c, date) }))
  const cellsOf = ({ x }: (typeof plans)[number]): { entries: Entry[]; width: number; span?: boolean }[] => [
    ...(!view.halves ? [] : x.long ? [{ entries: x.long, width: 2 * half + GAP, span: true }] : [{ entries: x.morning, width: half }, { entries: x.afternoon, width: half }]),
    { entries: x.focus, width: focusWidth },
  ]
  const lines = (e: Entry[], width: number) => e.reduce((sum, x) => sum + wrappedLines(x.text, width - INDENT), 0)
  // Two lines at least: the day and what is left of it.
  const budgets = plans.map((p) => Math.max(2, ...cellsOf(p).map((cell) => lines(cell.entries, cell.width))))
  const available = Math.floor((view.height - 40 - 20 - 24 - days.length * ROW_PAD) / WEEK_LINE)
  while (budgets.reduce((a, b) => a + b, 0) > available) {
    const i = budgets.indexOf(Math.max(...budgets))
    if (budgets[i] <= 2) break
    budgets[i]--
  }
  const t = c.t
  const cols = view.halves ? `${DAY}px 1fr 1fr ${FOCUS}px` : `${DAY}px 1fr`
  const rows = budgets.map((b) => `${b * WEEK_LINE + ROW_PAD}px`).join(' ')
  let html = `<div class="zw" style="grid-template-columns:${cols};grid-template-rows:24px ${rows}"><div class="zw-h"></div>`
  if (view.halves) html += `<div class="zw-h">${esc(t('trmnl.morning'))}</div><div class="zw-h">${esc(t('trmnl.afternoon'))}</div>`
  html += `<div class="zw-h">${esc(t('trmnl.focus'))}</div>`
  plans.forEach((p, i) => {
    const { date, x } = p
    html += `<div class="zw-c zw-d${date === c.today ? ' zw-today' : ''}"><b>${esc(x.label)}</b><span${x.tight ? ' class="zw-tight"' : ''}>${esc(x.status)}</span></div>`
    for (const cell of cellsOf(p)) html += `<div class="zw-c${cell.span ? ' zw-long' : ''}">${fit(cell.entries, cell.width - INDENT, budgets[i], t)}</div>`
  })
  return html + '</div>'
}

function weekTitle(c: Ctx, days: ISODate[]): string {
  const free = days.reduce((sum, date) => sum + dayPlan(c, date).free, 0)
  return `${c.t('week.weekLabel', { week: isoWeekNumber(c.today) })} · ${c.t('week.free', { hours: fmtHours(free, c.locale) })} · ${updated(c)}`
}

// ---------- entry ----------

export function renderScreens(view: TrmnlView, state: DisplayState, today: ISODate, now: HHMM): Screens {
  const locale = state.settings.locale ?? DEFAULT_SETTINGS.locale
  const t = translator(locale)
  const c: Ctx = { d: displayData(state, t('trmnl.busy')), t, locale, today, now }
  if (view === 'todos') {
    const title = t('trmnl.todos')
    return {
      markup: screen(locale, title, updated(c), todos(c, 11, false)),
      markup_half_vertical: screen(locale, title, updated(c), todos(c, 11, true)),
      markup_half_horizontal: screen(locale, title, updated(c), todos(c, 5, false)),
      markup_quadrant: screen(locale, title, updated(c), todos(c, 5, true)),
    }
  }
  if (view === 'schedule') {
    const title = t('trmnl.schedule')
    return {
      markup: screen(locale, title, updated(c), schedule(c)),
      markup_half_vertical: screen(locale, title, updated(c), schedule(c, true)),
      markup_half_horizontal: screen(locale, title, updated(c), scheduleList(c, 5)),
      markup_quadrant: screen(locale, title, updated(c), scheduleList(c, 5)),
    }
  }
  const title = t('trmnl.week')
  const five = weekDays(c, 5)
  const three = five.slice(0, 3)
  return {
    markup: screen(locale, title, weekTitle(c, five), weekTable(c, five, { width: 800, height: 480, halves: true })),
    markup_half_horizontal: screen(locale, title, weekTitle(c, three), weekTable(c, three, { width: 800, height: 240, halves: true })),
    markup_half_vertical: screen(locale, title, weekTitle(c, five), weekTable(c, five, { width: 400, height: 480, halves: false })),
    markup_quadrant: screen(locale, title, weekTitle(c, three), weekTable(c, three, { width: 400, height: 240, halves: false })),
  }
}
