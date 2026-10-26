import type { CalendarEvent, HHMM, ISODate, PlanBlock, Project, Settings, Task } from '../src/domain/types.ts'
import { DEFAULT_SETTINGS } from '../src/domain/types.ts'
import { addDaysISO, compareISO, fmtDate, fmtHours, fmtTime, fmtWeekday, hhmmToMinutes, isoWeekNumber, minutesToHHMM } from '../src/domain/dates.ts'
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
.z-t small{font-size:15px;margin-left:8px}
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
.z-days{display:flex;flex:1;min-height:0;gap:8px}
.z-day{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;font-size:16px}
.z-day-h{font-weight:700;font-size:18px;padding:2px 6px;border:2px solid #000;border-radius:4px}
.z-today .z-day-h{background:#000;color:#fff}
.z-bar{height:12px;border:2px solid #000;border-radius:3px;overflow:hidden}.z-bar i{display:block;height:100%;background:#000}
.z-day .z-t{flex:none;font-size:16px}.z-strong{font-weight:700}
.z-wrow{display:flex;align-items:center;gap:8px;min-height:30px;border-bottom:1px solid #000;font-size:16px}
.z-wrow:last-child{border-bottom:0}.z-wrow .z-bar{flex:none;width:60px}.z-wd{flex:none;width:64px;font-weight:700}
</style>`

interface Ctx {
  d: DisplayData
  t: Translate
  locale: string
  today: ISODate
  now: HHMM
}

function screen(title: string, instance: string, body: string): string {
  return `${STYLE}<div class="layout layout--col layout--top layout--left layout--stretch"><div class="z">${body}</div></div>` +
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
    return `<div class="z-row"><span class="z-box"></span><span class="z-t">${esc(task.title)}${name ? `<small>${esc(name)}</small>` : ''}</span>` +
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
    `<div class="z-row"><span class="z-ring"></span><span class="z-t">${task ? `${esc(p.name)} · ${esc(task.title)}` : esc(t('today.nextMissing', { project: p.name }))}</span></div>`,
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

function dayInfo(c: Ctx, date: ISODate) {
  const { d, t } = c
  const cap = dayCapacity(date, d.settings, d.events, d.blocks, d.tasks)
  const used = cap.fullDay ? 1 : cap.workMinutes ? Math.min(1, (cap.uncoveredMeetingMinutes + cap.blockMinutes) / cap.workMinutes) : 0
  const status = cap.fullDay
    ? t('week.fullDayShort')
    : isOverplanned(cap)
      ? t('week.overplanned')
      : cap.isWorkDay
        ? t('week.free', { hours: fmtHours(cap.freeMinutes, c.locale) })
        : t('week.offDay')
  // One line per project, however many blocks it has that day.
  const sizes = new Map<string | null, number>()
  for (const b of blocksOn(d.blocks, date)) sizes.set(b.projectId, (sizes.get(b.projectId) ?? 0) + b.size)
  const blocks = [...sizes].map(([id, size]) => `${id ? (d.projects.find((p) => p.id === id)?.name ?? '') : t('week.chores')} ${fmtSize(size)}`)
  const events = eventsOn(d.events, date).filter(isBlocking)
  // Appointments that take the day (or half of it) are named; the rest are counted.
  const big = events.filter((e) => e.allDay || e.kind === 'workshop')
  const meetings = events.length - big.length
  // "Mo 26." / "Mon 26": the weekday without its abbreviation dot; German writes the day as an ordinal.
  const label = `${fmtWeekday(date, c.locale).replace(/\.$/, '')} ${fmtDate(date, c.locale, { day: 'numeric' })}${c.locale === 'de' ? '.' : ''}`
  return { used, status, blocks, big: big.map((e) => e.title), meetings, label }
}

const bar = (used: number) => `<div class="z-bar"><i style="width:${Math.round(used * 100)}%"></i></div>`

function weekColumns(c: Ctx, days: number, maxLines: number): string {
  const cols = weekDays(c, days).map((date) => {
    const x = dayInfo(c, date)
    const lines = [
      ...x.big.map((title) => `<span class="z-t z-strong">${esc(title)}</span>`),
      ...x.blocks.map((b) => `<span class="z-t">${esc(b)}</span>`),
      ...(x.meetings ? [`<span class="z-t">${esc(c.t('trmnl.meetings', { count: x.meetings }))}</span>`] : []),
    ]
    const shown = lines.length > maxLines ? [...lines.slice(0, maxLines - 1), `<span class="z-t">${esc(c.t('trmnl.more', { count: lines.length - maxLines + 1 }))}</span>`] : lines
    return `<div class="z-day${date === c.today ? ' z-today' : ''}"><div class="z-day-h">${esc(x.label)}</div>${bar(x.used)}<span>${esc(x.status)}</span>${shown.join('')}</div>`
  })
  return `<div class="z-days">${cols.join('')}</div>`
}

function weekRows(c: Ctx, days: number): string {
  return weekDays(c, days)
    .map((date) => {
      const x = dayInfo(c, date)
      const what = [...x.big, ...x.blocks].join(' · ')
      return `<div class="z-wrow"><span class="z-wd">${esc(x.label)}</span>${bar(x.used)}<span class="z-t">${esc(what)}</span><span class="z-r">${esc(x.status)}</span></div>`
    })
    .join('')
}

const weekTitle = (c: Ctx) => `${c.t('week.weekLabel', { week: isoWeekNumber(c.today) })} · ${updated(c)}`

// ---------- entry ----------

export function renderScreens(view: TrmnlView, state: DisplayState, today: ISODate, now: HHMM): Screens {
  const locale = state.settings.locale ?? DEFAULT_SETTINGS.locale
  const t = translator(locale)
  const c: Ctx = { d: displayData(state, t('trmnl.busy')), t, locale, today, now }
  if (view === 'todos') {
    const title = t('trmnl.todos')
    return {
      markup: screen(title, updated(c), todos(c, 11, false)),
      markup_half_vertical: screen(title, updated(c), todos(c, 11, true)),
      markup_half_horizontal: screen(title, updated(c), todos(c, 5, false)),
      markup_quadrant: screen(title, updated(c), todos(c, 5, true)),
    }
  }
  if (view === 'schedule') {
    const title = t('trmnl.schedule')
    return {
      markup: screen(title, updated(c), schedule(c)),
      markup_half_vertical: screen(title, updated(c), schedule(c, true)),
      markup_half_horizontal: screen(title, updated(c), scheduleList(c, 5)),
      markup_quadrant: screen(title, updated(c), scheduleList(c, 5)),
    }
  }
  const title = t('trmnl.week')
  return {
    markup: screen(title, weekTitle(c), weekColumns(c, 5, 6)),
    markup_half_horizontal: screen(title, weekTitle(c), weekColumns(c, 5, 2)),
    markup_half_vertical: screen(title, weekTitle(c), weekRows(c, 5)),
    markup_quadrant: screen(title, weekTitle(c), weekRows(c, 3)),
  }
}
