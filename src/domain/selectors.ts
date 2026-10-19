import type { BlockSize, CalendarEvent, ISODate, PlanBlock, Project, Settings, Task } from './types'
import { DEFAULT_SETTINGS } from './types'
import { compareISO, daysBetween, durationMinutes, hhmmToMinutes, isHHMM, isoWeekday, toISODate } from './dates'

/** Settings with any malformed time replaced by its default, so capacity never turns into NaN. */
export function safeTimes(settings: Settings): Settings {
  const pick = (v: unknown, d: string) => (isHHMM(v) ? v : d)
  return {
    ...settings,
    workdayStart: pick(settings.workdayStart, DEFAULT_SETTINGS.workdayStart),
    workdayEnd: pick(settings.workdayEnd, DEFAULT_SETTINGS.workdayEnd),
    budgetStart: pick(settings.budgetStart, DEFAULT_SETTINGS.budgetStart),
    budgetEnd: pick(settings.budgetEnd, DEFAULT_SETTINGS.budgetEnd),
    dayCapacityHours: Number.isFinite(settings.dayCapacityHours) && settings.dayCapacityHours > 0 ? settings.dayCapacityHours : DEFAULT_SETTINGS.dayCapacityHours,
  }
}

export const isOpen = (t: Task) => t.status !== 'done'

/** Events shown as "free" (reminders, other people's holidays) never block time. */
export const isBlocking = (e: CalendarEvent) => (e.availability ?? 'busy') !== 'free'

/** A workshop of this length (or longer) costs the whole day; shorter workshops cost at least half a day. */
export const WORKSHOP_FULL_DAY_MINUTES = 5 * 60

export function nextActionOf(tasks: Task[], projectId: string): Task | undefined {
  return tasks.find((t) => t.projectId === projectId && t.status === 'next')
}

export function tasksOfProject(tasks: Task[], projectId: string | null): Task[] {
  return tasks.filter((t) => t.projectId === projectId)
}

export function openTasksOfProject(tasks: Task[], projectId: string): Task[] {
  return tasks.filter((t) => t.projectId === projectId && isOpen(t))
}

export function activeProjects(projects: Project[]): Project[] {
  return projects.filter((p) => p.status === 'active')
}

/** Projects that may receive and manage actions (dropdowns, board, today). */
export const isWorkable = (p: Project) => p.status === 'active' || p.status === 'planned'
/** Projects that can be edited at all (everything but archived). */
export const isManageable = (p: Project) => p.status !== 'archived'
export function workableProjects(projects: Project[]): Project[] {
  return projects.filter(isWorkable)
}

/** Active projects that violate the "exactly one next action" rule. */
export function projectsWithoutNextAction(projects: Project[], tasks: Task[]): Project[] {
  return activeProjects(projects).filter((p) => !nextActionOf(tasks, p.id))
}

export function tasksPlannedOn(tasks: Task[], date: ISODate): Task[] {
  return tasks.filter((t) => t.plannedDate === date)
}

export function tasksDueOn(tasks: Task[], date: ISODate): Task[] {
  return tasks.filter((t) => t.dueDate === date)
}

export function overdueTasks(tasks: Task[], today: ISODate): Task[] {
  return tasks.filter((t) => isOpen(t) && t.dueDate && compareISO(t.dueDate, today) < 0)
}

export function eventsOn<E extends CalendarEvent>(events: E[], date: ISODate): E[] {
  return events
    .filter((e) => e.date === date)
    .sort((a, b) => (a.allDay ? -1 : b.allDay ? 1 : hhmmToMinutes(a.start) - hhmmToMinutes(b.start)))
}

export function blocksOn(blocks: PlanBlock[], date: ISODate): PlanBlock[] {
  return blocks.filter((b) => b.date === date)
}

export function blockHours(size: BlockSize, settings: Settings): number {
  return size * settings.dayCapacityHours
}

export interface DayCapacity {
  workMinutes: number
  /** all blocking meetings of the day, clipped to the budget window */
  meetingMinutes: number
  /** meetings not covered by a plan block (no project, or the project has no block that day) */
  uncoveredMeetingMinutes: number
  /** effective block time: per project the larger of the block and that project's meetings */
  blockMinutes: number
  /** meeting minutes that sit inside blocks */
  absorbedMinutes: number
  plannedTaskMinutes: number
  /** work minus uncovered meetings minus effective blocks (0 when overplanned) */
  freeMinutes: number
  isWorkDay: boolean
  /** the whole day is taken: all-day busy event or a full-day workshop */
  fullDay: boolean
  /** per block: effective minutes and the meeting minutes it absorbs */
  blocks: { id: string; projectId: string | null; minutes: number; meetingMinutes: number }[]
}

export function dayCapacity(
  date: ISODate,
  rawSettings: Settings,
  events: CalendarEvent[],
  blocks: PlanBlock[],
  tasks: Task[],
): DayCapacity {
  const settings = safeTimes(rawSettings)
  const isWorkDay = settings.workDays.includes(isoWeekday(date))
  const workMinutes = isWorkDay ? durationMinutes(settings.workdayStart, settings.workdayEnd) : 0
  const dayLength = workMinutes || settings.dayCapacityHours * 60
  let fullDay = false
  const windowStart = hhmmToMinutes(settings.budgetStart)
  const windowEnd = hhmmToMinutes(settings.budgetEnd)
  // Meeting minutes per project (null = no project), each event clipped to the budget window.
  const byProject = new Map<string | null, number>()
  for (const e of eventsOn(events, date).filter(isBlocking)) {
    if (e.allDay) {
      fullDay = true
      continue
    }
    // Only the overlap with the budget window counts: evening and early-morning events are free of charge.
    const dur = Math.max(0, Math.min(hhmmToMinutes(e.end), windowEnd) - Math.max(hhmmToMinutes(e.start), windowStart))
    if (dur === 0) continue
    let cost = dur
    if (e.kind === 'workshop') {
      if (dur >= WORKSHOP_FULL_DAY_MINUTES) fullDay = true
      cost = Math.max(dur, dayLength / 2)
    }
    const key = e.projectId ?? null
    byProject.set(key, (byProject.get(key) ?? 0) + cost)
  }
  const meetingMinutesRaw = [...byProject.values()].reduce((a, b) => a + b, 0)
  const meetingMinutes = fullDay ? Math.max(meetingMinutesRaw, dayLength) : meetingMinutesRaw

  // A block for project X already contains X's meetings that day: the block costs max(block, meetings of X).
  const dayBlocks = blocksOn(blocks, date)
  const blockByProject = new Map<string | null, number>()
  for (const b of dayBlocks) blockByProject.set(b.projectId, (blockByProject.get(b.projectId) ?? 0) + blockHours(b.size, settings) * 60)
  const blockInfos = dayBlocks.map((b) => {
    const own = blockHours(b.size, settings) * 60
    const projectMeetings = b.projectId ? byProject.get(b.projectId) ?? 0 : 0
    const projectBlocks = blockByProject.get(b.projectId) ?? own
    // share this project's meetings across its blocks proportionally (usually there is just one)
    const share = (projectMeetings * own) / projectBlocks
    return { id: b.id, projectId: b.projectId, minutes: Math.max(own, share), meetingMinutes: Math.min(own, share) }
  })
  const blockMinutes = blockInfos.reduce((sum, b) => sum + b.minutes, 0)
  const absorbedMinutes = blockInfos.reduce((sum, b) => sum + b.meetingMinutes, 0)
  const coveredProjects = new Set(dayBlocks.map((b) => b.projectId).filter((p): p is string => !!p))
  const uncoveredRaw = [...byProject.entries()].filter(([pid]) => !pid || !coveredProjects.has(pid)).reduce((sum, [, m]) => sum + m, 0)
  const uncoveredMeetingMinutes = fullDay ? Math.max(uncoveredRaw, dayLength - blockMinutes) : uncoveredRaw

  const plannedTaskMinutes = tasksPlannedOn(tasks, date)
    .filter(isOpen)
    .reduce((sum, t) => sum + (t.estimateMinutes ?? 30), 0)
  const freeMinutes = Math.max(0, workMinutes - uncoveredMeetingMinutes - blockMinutes)
  return { workMinutes, meetingMinutes, uncoveredMeetingMinutes, blockMinutes, absorbedMinutes, plannedTaskMinutes, freeMinutes, isWorkDay, fullDay, blocks: blockInfos }
}

/** Candidates for today's plan, in a sensible order. */
export function candidatesForDay(
  date: ISODate,
  tasks: Task[],
  blocks: PlanBlock[],
  projects: Project[],
): { overdue: Task[]; due: Task[]; fromBlocks: { project: Project | null; task: Task | undefined }[]; chores: Task[] } {
  const open = tasks.filter((t) => isOpen(t) && t.plannedDate !== date)
  const overdue = open.filter((t) => t.dueDate && compareISO(t.dueDate, date) < 0)
  const due = open.filter((t) => t.dueDate === date)
  const todaysBlocks = blocksOn(blocks, date)
  const fromBlocks = todaysBlocks
    .map((b) => {
      const project = b.projectId ? projects.find((p) => p.id === b.projectId) ?? null : null
      const next = project ? tasks.find((t) => t.projectId === project.id && t.status === 'next' && isOpen(t)) : undefined
      // Already in today's plan → nothing to suggest for this block.
      if (next && next.plannedDate === date) return null
      return { project, task: next }
    })
    .filter((x): x is { project: Project | null; task: Task | undefined } => x !== null)
  const listed = new Set([...overdue, ...due].map((t) => t.id))
  const chores = open.filter((t) => t.projectId === null && t.status === 'next' && !listed.has(t.id))
  return { overdue, due, fromBlocks, chores }
}

const STATUS_RANK = { next: 0, todo: 1, waiting: 2, someday: 3, done: 4 }

/** Default order everywhere: by status, then the user's manual order (board position). */
export function sortTasks(a: Task, b: Task): number {
  if (a.status !== b.status) return STATUS_RANK[a.status] - STATUS_RANK[b.status]
  return a.order - b.order
}

export const URGENCY_HORIZON_DAYS = 14

/**
 * Urgency order, applied on request ("sort by urgency"):
 *  1. due within the horizon (overdue first), by due date, then priority
 *  2. no due date, by priority
 *  3. due later than the horizon, by due date, then priority
 * Ties keep the manual order.
 */
export function urgencyComparator(today: ISODate, horizonDays = URGENCY_HORIZON_DAYS): (a: Task, b: Task) => number {
  const prio = { high: 0, normal: 1, low: 2 }
  const tier = (t: Task) => (!t.dueDate ? 1 : daysBetween(today, t.dueDate) <= horizonDays ? 0 : 2)
  return (a, b) => {
    const ta = tier(a)
    const tb = tier(b)
    if (ta !== tb) return ta - tb
    if (ta !== 1 && a.dueDate !== b.dueDate) return compareISO(a.dueDate!, b.dueDate!)
    if (prio[a.priority] !== prio[b.priority]) return prio[a.priority] - prio[b.priority]
    return a.order - b.order
  }
}

export function sortByTime(a: { plannedStart?: string }, b: { plannedStart?: string }): number {
  if (!a.plannedStart) return 1
  if (!b.plannedStart) return -1
  return hhmmToMinutes(a.plannedStart) - hhmmToMinutes(b.plannedStart)
}

/** Weekly review: planned block hours vs. hours of completed tasks per project. */
export function plannedVsActual(
  weekDates: ISODate[],
  projects: Project[],
  tasks: Task[],
  blocks: PlanBlock[],
  settings: Settings,
): { project: Project | null; plannedMinutes: number; actualMinutes: number; doneCount: number }[] {
  const inWeek = (d?: ISODate) => !!d && weekDates.includes(d)
  const rows = new Map<string | null, { plannedMinutes: number; actualMinutes: number; doneCount: number }>()
  const bump = (key: string | null) => {
    if (!rows.has(key)) rows.set(key, { plannedMinutes: 0, actualMinutes: 0, doneCount: 0 })
    return rows.get(key)!
  }
  for (const b of blocks.filter((b) => inWeek(b.date))) bump(b.projectId).plannedMinutes += blockHours(b.size, settings) * 60
  for (const t of tasks.filter((t) => t.status === 'done' && t.completedAt && inWeek(toISODate(new Date(t.completedAt))))) {
    const r = bump(t.projectId)
    r.actualMinutes += t.estimateMinutes ?? 30
    r.doneCount += 1
  }
  return [...rows.entries()]
    .map(([key, v]) => ({ project: key ? projects.find((p) => p.id === key) ?? null : null, ...v }))
    .sort((a, b) => b.plannedMinutes + b.actualMinutes - (a.plannedMinutes + a.actualMinutes))
}
