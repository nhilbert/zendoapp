/**
 * Zendo domain model.
 *
 * Vocabulary (GTD-inspired):
 *  - InboxItem   raw capture, not yet clarified
 *  - Task        an actionable item. projectId === null means it is a "chore"
 *                (a standalone single action that belongs to no project)
 *  - Project     any outcome that needs more than one action. Every active
 *                project should have exactly ONE task with status "next".
 *  - CalendarEvent  the "hard landscape": meetings, workshops, coaching sessions
 *  - PlanBlock   a rough weekly-planning allocation: "½ day on project X on date Y"
 *  - Review      free-form notes of a daily or weekly review
 */

export type ISODate = string // 'YYYY-MM-DD' (local calendar date)
export type ISODateTime = string // ISO 8601 timestamp
export type HHMM = string // 'HH:mm' (local time of day)

export type Locale = 'en' | 'de'

export interface InboxItem {
  id: string
  text: string
  createdAt: ISODateTime
}

/**
 * Project lifecycle:
 *  active   – working on it: in every list, the week palette, and the one-next-action rule
 *  planned  – prepared, comes up later: in dropdowns, board and deadlines, but not plannable per week
 *  someday  – an idea without commitment: only on the projects page
 *  archived – kept for reference, read-only: no lists, no dropdowns, no new actions
 */
export type ProjectStatus = 'active' | 'planned' | 'someday' | 'archived'
export const PROJECT_STATUSES: ProjectStatus[] = ['active', 'planned', 'someday', 'archived']

export const PROJECT_COLORS = [
  'sage',
  'clay',
  'slate',
  'plum',
  'ochre',
  'moss',
  'dusk',
  'sand',
] as const
export type ProjectColor = (typeof PROJECT_COLORS)[number]

/** An explicit high-level goal of a project (from the offer, or personal). Ordered, few. */
export interface ProjectGoal {
  id: string
  text: string
}

export interface Project {
  id: string
  name: string
  /** Explicit high-level goals (from the offer, or personal); the first one is the headline. */
  goals?: ProjectGoal[]
  /** Free-form notes: goals, commitments, agreements. */
  notes?: string
  status: ProjectStatus
  color: ProjectColor
  dueDate?: ISODate
  /** Private (non-work) project; hidden when "hide private" is on. All its tasks count as private. */
  private?: boolean
  /** Outlook series linked as a whole (CAL-10): new occurrences of these series get this project on sync. */
  meetingSeries?: string[]
  /** Place in the user's own order (dragged on the projects page); without one, due date and name decide. */
  order?: number
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

/**
 * Task status doubles as the Kanban column.
 *  next     – the ONE next action of a project (or a chore that is up next)
 *  todo     – actionable, but not the next action
 *  waiting  – delegated / waiting for someone else
 *  someday  – maybe later, not committed
 *  done     – completed
 */
export type TaskStatus = 'next' | 'todo' | 'waiting' | 'someday' | 'done'
export const TASK_STATUSES: TaskStatus[] = ['next', 'todo', 'waiting', 'someday', 'done']

export type Priority = 'high' | 'normal' | 'low'

export interface TaskNote {
  id: string
  text: string
  createdAt: ISODateTime
}

export interface Task {
  id: string
  title: string
  description?: string
  /** null = chore (standalone action without a project) */
  projectId: string | null
  status: TaskStatus
  priority: Priority
  estimateMinutes?: number
  /** Deadline – the date by which it must be done. */
  dueDate?: ISODate
  /** The date I intend to work on it. */
  plannedDate?: ISODate
  /** Optional time-of-day on plannedDate (daily timetable). */
  plannedStart?: HHMM
  waitingFor?: string
  recurrence?: Recurrence
  /** First due/planned date of the recurring series; keeps "the 31st" from drifting after February. */
  recurrenceAnchor?: ISODate
  /** Id of the completed task this occurrence was spawned from (removed again if that completion is undone). */
  spawnedFrom?: string
  /** Status the task had before it was completed, restored when un-completed. */
  statusBeforeDone?: TaskStatus
  /** Private (non-work) task; hidden when "hide private" is on. */
  private?: boolean
  notes: TaskNote[]
  order: number
  createdAt: ISODateTime
  updatedAt: ISODateTime
  completedAt?: ISODateTime
}

export type EventKind = 'online' | 'workshop' | 'in_person' | 'coaching' | 'other'
export const EVENT_KINDS: EventKind[] = ['online', 'in_person', 'workshop', 'coaching', 'other']

/**
 * Whether an event blocks time. Mirrors Outlook's "Show as" (ICS: TRANSP and
 * X-MICROSOFT-CDO-BUSYSTATUS, Graph: showAs). Only "free" does not block.
 */
export type Availability = 'busy' | 'free' | 'tentative' | 'oof'
export const AVAILABILITIES: Availability[] = ['busy', 'free', 'tentative', 'oof']

/** Simple recurrence for chores; the next occurrence is created when the task is completed. */
export type Recurrence = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly'
export const RECURRENCES: Recurrence[] = ['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly']

export interface CalendarEvent {
  id: string
  title: string
  date: ISODate
  start: HHMM
  end: HHMM
  allDay?: boolean
  kind: EventKind
  /** undefined = busy */
  availability?: Availability
  /** Private appointment (Outlook sensitivity private/personal, or set by hand). Masked while "hide private" is on; still blocks time. */
  private?: boolean
  location?: string
  /** online meeting link (Teams, Zoom …) behind the Join button; http(s) only, see domain/meeting.ts */
  joinUrl?: string
  projectId?: string | null
  source: 'manual' | 'ics' | 'm365'
  /** external id (ICS UID) for de-duplication on re-import */
  externalId?: string
  /** Outlook series (seriesMasterId) this occurrence belongs to; see Project.meetingSeries */
  seriesId?: string
}

export type BlockSize = 0.25 | 0.5 | 0.75 | 1
export const BLOCK_SIZES: BlockSize[] = [0.25, 0.5, 0.75, 1]
/** Share of the day as shown on block chips (Week) and block rows (Today). */
export const BLOCK_SIZE_LABEL: Record<BlockSize, string> = { 0.25: '¼', 0.5: '½', 0.75: '¾', 1: '1' }

export interface PlanBlock {
  id: string
  date: ISODate
  /** null = chores / admin time */
  projectId: string | null
  size: BlockSize
  note?: string
}

export interface Review {
  id: string
  kind: 'daily' | 'weekly'
  /** the day, or the Monday of the week */
  date: ISODate
  notes: string
  updatedAt: ISODateTime
}

export interface Settings {
  locale: Locale
  workdayStart: HHMM
  workdayEnd: HHMM
  /** ISO weekday numbers, 1 = Monday … 7 = Sunday */
  workDays: number[]
  /** Only the part of a meeting inside this window counts against the day's budget (evenings don't). */
  budgetStart: HHMM
  budgetEnd: HHMM
  /** hours of focused work a full "1 day" block represents */
  dayCapacityHours: number
  /** Hide private tasks, projects and their blocks everywhere (toggle in the sidebar, key h). */
  hidePrivate?: boolean
  /** Clarify asks the AI for a proposal by itself (current and next item), instead of only on "a". */
  autoClarify?: boolean
  /** Microsoft 365 connection as last seen by the app (the token cache lives in the calendar service). */
  calendar?: { account: string | null; lastSync?: ISODateTime }
}

export const DEFAULT_SETTINGS: Settings = {
  locale: 'en',
  workdayStart: '08:00',
  workdayEnd: '18:00',
  workDays: [1, 2, 3, 4, 5],
  budgetStart: '07:00',
  budgetEnd: '19:00',
  dayCapacityHours: 8,
}
