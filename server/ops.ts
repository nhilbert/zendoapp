import type { Repo, Record_ } from './repo.ts'
import { BadRequest } from './repo.ts'
import type {
  BlockSize,
  CalendarEvent,
  InboxItem,
  ISODate,
  PlanBlock,
  Priority,
  Project,
  ProjectColor,
  ProjectGoal,
  ProjectStatus,
  Recurrence,
  Review,
  Settings,
  Task,
  TaskStatus,
} from '../src/domain/types.ts'
import { BLOCK_SIZES, DEFAULT_SETTINGS } from '../src/domain/types.ts'
import { addDaysISO, fmtWeekday, isISODate, isoWeekday, nowHHMM, rangeISO, todayISO } from '../src/domain/dates.ts'
import {
  blocksOn,
  candidatesForDay,
  dayCapacity,
  eventsOn,
  isOpen,
  isOverplanned,
  leftoverTasks,
  nextActionOf,
  overdueTasks,
  projectsWithoutNextAction,
  sortByTime,
  sortTasks,
  tasksPlannedOn,
  upcomingMeetings,
  visibleBlocks,
} from '../src/domain/selectors.ts'
import { completeWithRecurrence, nextColor, uncomplete, withSingleNext } from '../src/domain/taskRules.ts'

/**
 * Zendo operations for agents (the MCP tools): reads and writes on the server database with the
 * same rules as the app – one next action per project, recurring tasks spawn their next occurrence,
 * blocks only for active projects. Every write goes through Repo.applyChanges, so the browser picks
 * it up on its next refresh (window focus) like any other change.
 */

interface Data {
  inbox: InboxItem[]
  projects: Project[]
  tasks: Task[]
  events: CalendarEvent[]
  blocks: PlanBlock[]
  reviews: Review[]
  settings: Settings
}
type Writable = 'inbox' | 'projects' | 'tasks' | 'blocks' | 'reviews'
const WRITABLE: Writable[] = ['inbox', 'projects', 'tasks', 'blocks', 'reviews']

export interface OpsOptions {
  /** Leave private projects, tasks and their blocks out and mask private appointments (ZENDO_MCP_HIDE_PRIVATE). */
  hidePrivate?: boolean
  /** Injectable clock for tests. */
  today?: () => ISODate
  now?: () => string
}

export interface TaskInput {
  title?: string
  description?: string | null
  project?: string | null
  status?: TaskStatus
  priority?: Priority
  estimateMinutes?: number | null
  dueDate?: ISODate | null
  plannedDate?: ISODate | null
  plannedStart?: string | null
  waitingFor?: string | null
  recurrence?: Recurrence | null
  private?: boolean
}

export interface ProjectInput {
  name?: string
  status?: ProjectStatus
  notes?: string | null
  appendNotes?: string
  goals?: string[]
  dueDate?: ISODate | null
  color?: ProjectColor
  private?: boolean
}

export interface TaskFilter {
  project?: string | null
  status?: TaskStatus[]
  query?: string
  dueBefore?: ISODate
  plannedOn?: ISODate
  includeDone?: boolean
  limit?: number
}

const stamp = () => new Date().toISOString()
const uid = () => crypto.randomUUID()

/** Drops undefined, null and empty values so answers stay short. */
function compact<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0))) as Partial<T>
}

function checkDate(d: unknown, field: string): void {
  if (d !== undefined && d !== null && !isISODate(d)) throw new BadRequest(`${field} must be a date YYYY-MM-DD`)
}

export class Ops {
  private repo: Repo
  private hidePrivate: boolean
  private today: () => ISODate
  private now: () => string

  constructor(repo: Repo, options: OpsOptions = {}) {
    this.repo = repo
    this.hidePrivate = options.hidePrivate ?? false
    this.today = options.today ?? todayISO
    this.now = options.now ?? nowHHMM
  }

  // ---------- reading and writing ----------

  private read(): Data {
    const s = this.repo.loadState()
    const data: Data = {
      inbox: s.inbox as unknown as InboxItem[],
      projects: s.projects as unknown as Project[],
      tasks: s.tasks as unknown as Task[],
      events: s.events as unknown as CalendarEvent[],
      blocks: s.blocks as unknown as PlanBlock[],
      reviews: s.reviews as unknown as Review[],
      settings: { ...DEFAULT_SETTINGS, ...(s.settings ?? {}) },
    }
    if (!this.hidePrivate) return data
    // Hidden records never enter `before`, so a write can neither change nor delete them.
    const hidden = new Set(data.projects.filter((p) => p.private).map((p) => p.id))
    return {
      ...data,
      projects: data.projects.filter((p) => !p.private),
      tasks: data.tasks.filter((t) => !t.private && !(t.projectId && hidden.has(t.projectId))),
      blocks: data.blocks.filter((b) => !(b.projectId && hidden.has(b.projectId))),
      events: data.events.map((e) => (e.private ? { ...e, title: 'private', location: undefined, joinUrl: undefined } : e)),
    }
  }

  /** Writes what differs between `before` and `after`: changed objects are upserted, missing ones deleted. */
  private write(before: Data, after: Partial<Pick<Data, Writable>>): void {
    const upserts: Partial<Record<Writable, Record_[]>> = {}
    const deletes: Partial<Record<Writable, string[]>> = {}
    for (const col of WRITABLE) {
      const next = after[col] as unknown as Record_[] | undefined
      if (!next) continue
      const prev = new Map((before[col] as unknown as Record_[]).map((r) => [r.id, r]))
      const ups = next.filter((r) => prev.get(r.id) !== r)
      const keep = new Set(next.map((r) => r.id))
      const dels = [...prev.keys()].filter((id) => !keep.has(id))
      if (ups.length) upserts[col] = ups
      if (dels.length) deletes[col] = dels
    }
    if (Object.keys(upserts).length || Object.keys(deletes).length) this.repo.applyChanges({ upserts, deletes })
  }

  // ---------- lookups and views ----------

  /** A project by id, or by name (exact, case-insensitive; else a unique partial match). */
  private project(d: Data, ref: string): Project {
    const byId = d.projects.find((p) => p.id === ref)
    if (byId) return byId
    const q = ref.trim().toLowerCase()
    const exact = d.projects.filter((p) => p.name.toLowerCase() === q)
    if (exact.length === 1) return exact[0]
    const partial = exact.length ? exact : d.projects.filter((p) => p.name.toLowerCase().includes(q))
    if (partial.length === 1) return partial[0]
    if (!partial.length) throw new BadRequest(`no project matches "${ref}"`)
    throw new BadRequest(`"${ref}" matches several projects: ${partial.map((p) => `${p.name} (${p.id})`).join(', ')}`)
  }

  private task(d: Data, id: string): Task {
    const t = d.tasks.find((x) => x.id === id)
    if (!t) throw new BadRequest(`no task with id ${id}`)
    return t
  }

  private taskView(d: Data, t: Task, full = false) {
    const project = t.projectId ? d.projects.find((p) => p.id === t.projectId) : undefined
    return compact({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority === 'normal' ? undefined : t.priority,
      project: project?.name,
      projectId: t.projectId ?? undefined,
      dueDate: t.dueDate,
      plannedDate: t.plannedDate,
      plannedStart: t.plannedStart,
      estimateMinutes: t.estimateMinutes,
      waitingFor: t.waitingFor,
      recurrence: t.recurrence,
      private: t.private || undefined,
      description: full ? t.description : t.description ? t.description.slice(0, 160) : undefined,
      notes: full ? t.notes.map((n) => ({ text: n.text, createdAt: n.createdAt })) : undefined,
      completedAt: t.completedAt,
    })
  }

  private projectSummary(d: Data, p: Project) {
    const open = d.tasks.filter((t) => t.projectId === p.id && isOpen(t))
    const next = nextActionOf(d.tasks, p.id)
    const meeting = upcomingMeetings(d.events, p.id, this.today(), this.now())[0]
    return compact({
      id: p.id,
      name: p.name,
      status: p.status,
      goal: p.goals?.[0]?.text,
      dueDate: p.dueDate,
      private: p.private || undefined,
      nextAction: next ? { id: next.id, title: next.title } : undefined,
      missingNextAction: p.status === 'active' && !next ? true : undefined,
      openTasks: open.length,
      nextMeeting: meeting ? `${meeting.date} ${meeting.allDay ? '' : meeting.start} ${meeting.title}`.replace(/\s+/g, ' ') : undefined,
    })
  }

  private eventView(d: Data, e: CalendarEvent) {
    const project = e.projectId ? d.projects.find((p) => p.id === e.projectId) : undefined
    return compact({
      title: e.title,
      start: e.allDay ? undefined : e.start,
      end: e.allDay ? undefined : e.end,
      allDay: e.allDay || undefined,
      kind: e.kind,
      availability: e.availability && e.availability !== 'busy' ? e.availability : undefined,
      location: e.location,
      project: project?.name,
    })
  }

  private blockView(d: Data, b: PlanBlock) {
    const project = b.projectId ? d.projects.find((p) => p.id === b.projectId) : undefined
    return compact({ id: b.id, project: project?.name ?? (b.projectId ? undefined : 'chores/admin'), projectId: b.projectId ?? undefined, size: b.size, hours: b.size * d.settings.dayCapacityHours, note: b.note })
  }

  // ---------- inbox ----------

  inboxList() {
    return this.read().inbox.map((i) => ({ id: i.id, text: i.text, createdAt: i.createdAt }))
  }

  inboxAdd(texts: string[]): InboxItem[] {
    const items = texts.map((t) => t.trim()).filter(Boolean).map((text) => ({ id: uid(), text, createdAt: stamp() }))
    if (!items.length) throw new BadRequest('nothing to add')
    const d = this.read()
    this.write(d, { inbox: [...d.inbox, ...items] })
    return items
  }

  inboxUpdate(id: string, text: string): InboxItem {
    const d = this.read()
    const item = d.inbox.find((i) => i.id === id)
    if (!item) throw new BadRequest(`no inbox item with id ${id}`)
    if (!text.trim()) throw new BadRequest('text required')
    const updated = { ...item, text: text.trim() }
    this.write(d, { inbox: d.inbox.map((i) => (i.id === id ? updated : i)) })
    return updated
  }

  /** Clarify one inbox item: it becomes a task or a project, or is dropped. */
  inboxClarify(id: string, into: 'task' | 'project' | 'delete', input: { task?: TaskInput; project?: ProjectInput & { nextAction?: string } } = {}) {
    const d = this.read()
    const item = d.inbox.find((i) => i.id === id)
    if (!item) throw new BadRequest(`no inbox item with id ${id}`)
    const inbox = d.inbox.filter((i) => i.id !== id)
    if (into === 'delete') {
      this.write(d, { inbox })
      return { deleted: item.text }
    }
    if (into === 'task') {
      const { tasks, task } = this.buildTask(d, { title: item.text, ...input.task })
      this.write(d, { inbox, tasks })
      return { task: this.taskView({ ...d, tasks }, task, true) }
    }
    const { projects, tasks, project } = this.buildProject(d, { name: item.text, ...input.project })
    this.write(d, { inbox, projects, tasks })
    return { project: this.projectSummary({ ...d, projects, tasks }, project) }
  }

  // ---------- tasks ----------

  taskList(f: TaskFilter = {}) {
    const d = this.read()
    const projectId = f.project === undefined ? undefined : f.project === null ? null : this.project(d, f.project).id
    const q = f.query?.trim().toLowerCase()
    checkDate(f.dueBefore, 'dueBefore')
    checkDate(f.plannedOn, 'plannedOn')
    const list = d.tasks
      .filter((t) => (projectId === undefined ? true : t.projectId === projectId))
      .filter((t) => (f.status?.length ? f.status.includes(t.status) : f.includeDone || isOpen(t)))
      .filter((t) => !q || t.title.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q))
      .filter((t) => !f.dueBefore || (!!t.dueDate && t.dueDate <= f.dueBefore))
      .filter((t) => !f.plannedOn || t.plannedDate === f.plannedOn)
      .sort(sortTasks)
    const limit = f.limit ?? 100
    return { total: list.length, tasks: list.slice(0, limit).map((t) => this.taskView(d, t)) }
  }

  taskGet(id: string) {
    const d = this.read()
    return this.taskView(d, this.task(d, id), true)
  }

  private buildTask(d: Data, input: TaskInput & { title: string }): { tasks: Task[]; task: Task } {
    if (!input.title.trim()) throw new BadRequest('title required')
    const projectId = input.project ? this.project(d, input.project).id : null
    if (projectId && d.projects.find((p) => p.id === projectId)?.status === 'archived') throw new BadRequest('the project is archived; reactivate it first')
    const task: Task = {
      id: uid(),
      projectId,
      status: input.status === 'done' ? 'todo' : (input.status ?? 'todo'),
      priority: input.priority ?? 'normal',
      notes: [],
      order: Date.now(),
      createdAt: stamp(),
      updatedAt: stamp(),
      title: input.title.trim(),
    }
    this.applyFields(task, input)
    return { tasks: [...(task.status === 'next' ? withSingleNext(d.tasks, task.id, task.projectId) : d.tasks), task], task }
  }

  /** Copies the optional fields of the input onto a task; null clears a field. */
  private applyFields(t: Task, input: TaskInput): void {
    for (const f of ['dueDate', 'plannedDate'] as const) checkDate(input[f], f)
    if (input.plannedStart && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.plannedStart)) throw new BadRequest('plannedStart must be HH:mm')
    if (input.estimateMinutes != null && !(input.estimateMinutes > 0)) throw new BadRequest('estimateMinutes must be positive')
    const set = <K extends keyof Task>(key: K, value: Task[K] | null | undefined) => {
      if (value === undefined) return
      if (value === null || value === '') delete t[key]
      else t[key] = value
    }
    set('description', input.description)
    set('estimateMinutes', input.estimateMinutes)
    set('dueDate', input.dueDate)
    set('plannedDate', input.plannedDate)
    set('plannedStart', input.plannedStart)
    set('waitingFor', input.waitingFor)
    set('recurrence', input.recurrence)
    if (input.recurrence === null) delete t.recurrenceAnchor
    if (input.private !== undefined) t.private = input.private || undefined
    if (input.priority) t.priority = input.priority
    if (!t.plannedDate) delete t.plannedStart
  }

  taskCreate(input: TaskInput & { title: string }) {
    const d = this.read()
    const { tasks, task } = this.buildTask(d, input)
    this.write(d, { tasks })
    return this.taskView({ ...d, tasks }, task, true)
  }

  /** Several tasks in one write, e.g. the action items of a meeting. */
  taskCreateMany(inputs: (TaskInput & { title: string })[]) {
    const d = this.read()
    let tasks = d.tasks
    const created: Task[] = []
    for (const input of inputs) {
      const r = this.buildTask({ ...d, tasks }, input)
      tasks = r.tasks
      created.push(r.task)
    }
    this.write(d, { tasks })
    return created.map((t) => this.taskView({ ...d, tasks }, t))
  }

  taskUpdate(id: string, input: TaskInput) {
    const d = this.read()
    const target = this.task(d, id)
    const changed: Task = { ...target, updatedAt: stamp() }
    if (input.title !== undefined) {
      if (!input.title.trim()) throw new BadRequest('title must not be empty')
      changed.title = input.title.trim()
    }
    if (input.project !== undefined) changed.projectId = input.project === null ? null : this.project(d, input.project).id
    this.applyFields(changed, input)
    let tasks = d.tasks.map((t) => (t.id === id ? changed : t))
    const status = input.status
    if (status && status !== target.status) {
      if (status === 'done') tasks = completeWithRecurrence(tasks, changed)
      else if (target.status === 'done') tasks = uncomplete(tasks, changed, status)
      else tasks = tasks.map((t) => (t.id === id ? { ...changed, status, order: Date.now() } : t))
    }
    const updated = tasks.find((t) => t.id === id)!
    if (updated.status === 'next') tasks = withSingleNext(tasks, id, updated.projectId)
    this.write(d, { tasks })
    return this.taskView({ ...d, tasks }, updated, true)
  }

  taskComplete(id: string, done = true) {
    const d = this.read()
    const target = this.task(d, id)
    if (done === (target.status === 'done')) return { task: this.taskView(d, target) }
    const tasks = done ? completeWithRecurrence(d.tasks, target) : uncomplete(d.tasks, target)
    this.write(d, { tasks })
    const spawned = done ? tasks.find((t) => t.spawnedFrom === id && t.status !== 'done') : undefined
    const project = target.projectId ? d.projects.find((p) => p.id === target.projectId) : undefined
    const next = project ? nextActionOf(tasks, project.id) : undefined
    return compact({
      task: this.taskView({ ...d, tasks }, tasks.find((t) => t.id === id)!),
      nextOccurrence: spawned ? this.taskView({ ...d, tasks }, spawned) : undefined,
      hint: done && project?.status === 'active' && !next ? `Project "${project.name}" has no next action now.` : undefined,
    })
  }

  taskAddNote(id: string, text: string) {
    if (!text.trim()) throw new BadRequest('text required')
    const d = this.read()
    const target = this.task(d, id)
    const changed = { ...target, notes: [...target.notes, { id: uid(), text: text.trim(), createdAt: stamp() }], updatedAt: stamp() }
    const tasks = d.tasks.map((t) => (t.id === id ? changed : t))
    this.write(d, { tasks })
    return this.taskView({ ...d, tasks }, changed, true)
  }

  taskDelete(id: string) {
    const d = this.read()
    const target = this.task(d, id)
    this.write(d, { tasks: d.tasks.filter((t) => t.id !== id) })
    return { deleted: target.title }
  }

  /** Plan tasks for a day (optionally at a time), or take them off the plan with date null. */
  taskSchedule(ids: string[], date: ISODate | null, start?: string) {
    checkDate(date, 'date')
    if (start && !/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) throw new BadRequest('start must be HH:mm')
    const d = this.read()
    for (const id of ids) this.task(d, id)
    const set_ = new Set(ids)
    const tasks = d.tasks.map((t) => {
      if (!set_.has(t.id)) return t
      const next: Task = { ...t, updatedAt: stamp() }
      if (date) next.plannedDate = date
      else delete next.plannedDate
      if (date && start && ids.length === 1) next.plannedStart = start
      else delete next.plannedStart
      return next
    })
    this.write(d, { tasks })
    return tasks.filter((t) => set_.has(t.id)).map((t) => this.taskView({ ...d, tasks }, t))
  }

  // ---------- projects ----------

  projectList(status?: ProjectStatus[]) {
    const d = this.read()
    const wanted = status?.length ? status : (['active', 'planned'] as ProjectStatus[])
    return d.projects.filter((p) => wanted.includes(p.status)).map((p) => this.projectSummary(d, p))
  }

  projectGet(ref: string) {
    const d = this.read()
    const p = this.project(d, ref)
    const today = this.today()
    const tasks = d.tasks.filter((t) => t.projectId === p.id).sort(sortTasks)
    return compact({
      ...this.projectSummary(d, p),
      color: p.color,
      goals: p.goals?.map((g) => g.text),
      notes: p.notes,
      tasks: tasks.filter(isOpen).map((t) => this.taskView(d, t)),
      recentlyDone: tasks
        .filter((t) => t.status === 'done')
        .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
        .slice(0, 10)
        .map((t) => ({ title: t.title, completedAt: t.completedAt })),
      upcomingMeetings: upcomingMeetings(d.events, p.id, today, this.now()).slice(0, 10).map((e) => ({ date: e.date, ...this.eventView(d, e) })),
      plannedBlocks: d.blocks
        .filter((b) => b.projectId === p.id && b.date >= today)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((b) => ({ date: b.date, ...this.blockView(d, b) })),
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    })
  }

  private goalsFrom(texts: string[], previous: ProjectGoal[] = []): ProjectGoal[] {
    return texts
      .map((t) => t.trim())
      .filter(Boolean)
      .map((text) => previous.find((g) => g.text === text) ?? { id: uid(), text })
  }

  private buildProject(d: Data, input: ProjectInput & { name: string; nextAction?: string; tasks?: string[] }) {
    const name = input.name.trim()
    if (!name) throw new BadRequest('name required')
    if (d.projects.some((p) => p.name.toLowerCase() === name.toLowerCase() && p.status !== 'archived')) throw new BadRequest(`a project named "${name}" exists already`)
    checkDate(input.dueDate, 'dueDate')
    const project: Project = {
      id: uid(),
      name,
      status: input.status ?? 'active',
      color: input.color ?? nextColor(d.projects),
      createdAt: stamp(),
      updatedAt: stamp(),
    }
    if (input.goals?.length) project.goals = this.goalsFrom(input.goals)
    const notes = [input.notes, input.appendNotes].filter((x) => x?.trim()).join('\n\n')
    if (notes) project.notes = notes
    if (input.dueDate) project.dueDate = input.dueDate
    if (input.private) project.private = true
    const projects = [...d.projects, project]
    let tasks = d.tasks
    const titles = [...(input.nextAction?.trim() ? [input.nextAction] : []), ...(input.tasks ?? [])]
    titles.forEach((title, i) => {
      if (!title.trim()) return
      const status: TaskStatus = i === 0 && input.nextAction?.trim() ? 'next' : 'todo'
      tasks = this.buildTask({ ...d, projects, tasks }, { title, project: project.id, status }).tasks
    })
    return { projects, tasks, project }
  }

  projectCreate(input: ProjectInput & { name: string; nextAction?: string; tasks?: string[] }) {
    const d = this.read()
    const { projects, tasks, project } = this.buildProject(d, input)
    this.write(d, { projects, tasks })
    return this.projectSummary({ ...d, projects, tasks }, project)
  }

  projectUpdate(ref: string, input: ProjectInput) {
    const d = this.read()
    const p = this.project(d, ref)
    const changed: Project = { ...p, updatedAt: stamp() }
    if (input.name !== undefined) {
      if (!input.name.trim()) throw new BadRequest('name must not be empty')
      changed.name = input.name.trim()
    }
    if (input.status) changed.status = input.status
    if (input.color) changed.color = input.color
    if (input.private !== undefined) changed.private = input.private || undefined
    if (input.goals) changed.goals = this.goalsFrom(input.goals, p.goals)
    checkDate(input.dueDate, 'dueDate')
    if (input.dueDate === null) delete changed.dueDate
    else if (input.dueDate) changed.dueDate = input.dueDate
    if (input.notes === null) delete changed.notes
    else if (input.notes !== undefined) changed.notes = input.notes
    if (input.appendNotes?.trim()) changed.notes = [changed.notes?.trim(), input.appendNotes.trim()].filter(Boolean).join('\n\n')
    const projects = d.projects.map((x) => (x.id === p.id ? changed : x))
    this.write(d, { projects })
    return this.projectSummary({ ...d, projects }, changed)
  }

  // ---------- plan ----------

  day(date: ISODate = this.today()) {
    checkDate(date, 'date')
    const d = this.read()
    const today = this.today()
    const blocks = visibleBlocks(d.blocks, d.projects, false)
    const cap = dayCapacity(date, d.settings, d.events, blocks, d.tasks)
    const planned = tasksPlannedOn(d.tasks, date).sort((a, b) => sortByTime(a, b) || sortTasks(a, b))
    const leftovers = date === today ? leftoverTasks(d.tasks, today) : []
    const overdue = date === today ? overdueTasks(d.tasks, today).filter((t) => t.plannedDate !== date) : []
    const exclude = new Set([...leftovers, ...planned].map((t) => t.id))
    const cand = candidatesForDay(date, d.tasks, blocks, d.projects, exclude)
    return compact({
      date,
      weekday: fmtWeekday(date, 'en', 'long'),
      isWorkDay: cap.isWorkDay,
      capacity: {
        workMinutes: cap.workMinutes,
        meetingMinutes: cap.meetingMinutes,
        blockMinutes: cap.blockMinutes,
        plannedTaskMinutes: cap.plannedTaskMinutes,
        freeMinutes: cap.freeMinutes,
        fullDay: cap.fullDay,
        overplanned: isOverplanned(cap),
      },
      events: eventsOn(d.events, date).map((e) => this.eventView(d, e)),
      blocks: blocksOn(blocks, date).map((b) => this.blockView(d, b)),
      planned: planned.map((t) => this.taskView(d, t)),
      dueToday: cand.due.map((t) => this.taskView(d, t)),
      overdue: overdue.map((t) => this.taskView(d, t)),
      leftoversFromEarlierDays: leftovers.map((t) => this.taskView(d, t)),
      suggestedFromBlocks: cand.fromBlocks.filter((x) => x.task).map((x) => this.taskView(d, x.task!)),
      nextChores: cand.chores.slice(0, 10).map((t) => this.taskView(d, t)),
      review: d.reviews.find((r) => r.kind === 'daily' && r.date === date)?.notes,
    })
  }

  week(start: ISODate = this.today(), days = 7) {
    checkDate(start, 'start')
    if (!(days >= 1 && days <= 28)) throw new BadRequest('days must be 1–28')
    const d = this.read()
    const blocks = visibleBlocks(d.blocks, d.projects, false)
    const range = rangeISO(start, days)
    const end = range[range.length - 1]
    return {
      from: start,
      to: end,
      days: range.map((date) => {
        const cap = dayCapacity(date, d.settings, d.events, blocks, d.tasks)
        const events = eventsOn(d.events, date).filter((e) => (e.availability ?? 'busy') !== 'free')
        return compact({
          date,
          weekday: fmtWeekday(date, 'en', 'short'),
          isWorkDay: cap.isWorkDay || undefined,
          meetings: events.map((e) => `${e.allDay ? 'all day' : `${e.start}–${e.end}`} ${e.title}`),
          blocks: blocksOn(blocks, date).map((b) => this.blockView(d, b)),
          plannedTasks: tasksPlannedOn(d.tasks, date).filter(isOpen).map((t) => t.title),
          freeMinutes: cap.isWorkDay ? cap.freeMinutes : undefined,
          overplanned: isOverplanned(cap) || undefined,
          fullDay: cap.fullDay || undefined,
        })
      }),
      deadlines: d.tasks
        .filter((t) => isOpen(t) && t.dueDate && t.dueDate >= start && t.dueDate <= end)
        .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))
        .map((t) => this.taskView(d, t)),
      projectDeadlines: d.projects
        .filter((p) => p.status !== 'archived' && p.dueDate && p.dueDate <= end)
        .map((p) => ({ project: p.name, dueDate: p.dueDate })),
      activeProjectsWithoutNextAction: projectsWithoutNextAction(d.projects, d.tasks).map((p) => p.name),
      week: { workDays: d.settings.workDays, dayCapacityHours: d.settings.dayCapacityHours, workday: `${d.settings.workdayStart}–${d.settings.workdayEnd}` },
    }
  }

  private checkBlock(d: Data, project: string | null | undefined, size?: number): { projectId: string | null } {
    if (size !== undefined && !BLOCK_SIZES.includes(size as BlockSize)) throw new BadRequest(`size must be one of ${BLOCK_SIZES.join(', ')}`)
    if (!project) return { projectId: null }
    const p = this.project(d, project)
    if (p.status !== 'active') throw new BadRequest(`blocks are only for active projects; "${p.name}" is ${p.status}`)
    return { projectId: p.id }
  }

  blockAdd(date: ISODate, project: string | null, size: BlockSize = 0.5, note?: string) {
    checkDate(date, 'date')
    const d = this.read()
    const { projectId } = this.checkBlock(d, project, size)
    const block: PlanBlock = { id: uid(), date, projectId, size, ...(note?.trim() ? { note: note.trim() } : {}) }
    const blocks = [...d.blocks, block]
    this.write(d, { blocks })
    return { date, ...this.blockView(d, block) }
  }

  blockUpdate(id: string, patch: { date?: ISODate; project?: string | null; size?: BlockSize; note?: string | null }) {
    checkDate(patch.date, 'date')
    const d = this.read()
    const b = d.blocks.find((x) => x.id === id)
    if (!b) throw new BadRequest(`no block with id ${id}`)
    const changed: PlanBlock = { ...b }
    if (patch.project !== undefined) changed.projectId = this.checkBlock(d, patch.project).projectId
    if (patch.size !== undefined) {
      this.checkBlock(d, null, patch.size)
      changed.size = patch.size
    }
    if (patch.date) changed.date = patch.date
    if (patch.note === null || patch.note === '') delete changed.note
    else if (patch.note) changed.note = patch.note.trim()
    this.write(d, { blocks: d.blocks.map((x) => (x.id === id ? changed : x)) })
    return { date: changed.date, ...this.blockView(d, changed) }
  }

  blockRemove(id: string) {
    const d = this.read()
    if (!d.blocks.some((b) => b.id === id)) throw new BadRequest(`no block with id ${id}`)
    this.write(d, { blocks: d.blocks.filter((b) => b.id !== id) })
    return { removed: id }
  }

  // ---------- reviews (daily and weekly notes) ----------

  private reviewDate(kind: Review['kind'], date?: ISODate): ISODate {
    checkDate(date, 'date')
    const day = date ?? this.today()
    return kind === 'weekly' ? addDaysISO(day, 1 - isoWeekday(day)) : day
  }

  reviewGet(kind: Review['kind'], date?: ISODate) {
    const d = this.read()
    const day = this.reviewDate(kind, date)
    const r = d.reviews.find((x) => x.kind === kind && x.date === day)
    return { kind, date: day, notes: r?.notes ?? '', updatedAt: r?.updatedAt }
  }

  reviewSave(kind: Review['kind'], notes: string, options: { date?: ISODate; append?: boolean } = {}) {
    const d = this.read()
    const day = this.reviewDate(kind, options.date)
    const existing = d.reviews.find((x) => x.kind === kind && x.date === day)
    const text = options.append && existing?.notes.trim() ? `${existing.notes.trim()}\n\n${notes.trim()}` : notes
    const review: Review = existing ? { ...existing, notes: text, updatedAt: stamp() } : { id: uid(), kind, date: day, notes: text, updatedAt: stamp() }
    this.write(d, { reviews: existing ? d.reviews.map((x) => (x.id === existing.id ? review : x)) : [...d.reviews, review] })
    return { kind, date: day, notes: review.notes }
  }
}
