import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type {
  BlockSize,
  CalendarEvent,
  InboxItem,
  ISODate,
  Locale,
  PlanBlock,
  Project,
  ProjectColor,
  Review,
  Settings,
  Task,
  TaskStatus,
} from '@/domain/types'
import { DEFAULT_SETTINGS, PROJECT_COLORS } from '@/domain/types'
import { buildSampleData } from '@/domain/sample'
import { addDaysISO, daysBetween, nextOccurrenceFrom, todayISO } from '@/domain/dates'
import { STORE_VERSION, migratePersisted } from '@/domain/migrations'

export { STORE_VERSION, migratePersisted }
import { urgencyComparator } from '@/domain/selectors'

const now = () => new Date().toISOString()
const uid = () => crypto.randomUUID()

export interface DataSnapshot {
  version: number
  exportedAt: string
  inbox: InboxItem[]
  projects: Project[]
  tasks: Task[]
  events: CalendarEvent[]
  blocks: PlanBlock[]
  reviews: Review[]
  settings: Settings
}

interface State {
  inbox: InboxItem[]
  projects: Project[]
  tasks: Task[]
  events: CalendarEvent[]
  blocks: PlanBlock[]
  reviews: Review[]
  settings: Settings
  seeded: boolean

  // inbox
  addInboxItem: (text: string) => InboxItem
  updateInboxItem: (id: string, text: string) => void
  removeInboxItem: (id: string) => void
  deferInboxItem: (id: string) => void

  // projects
  addProject: (input: Partial<Project> & { name: string }) => Project
  updateProject: (id: string, patch: Partial<Project>) => void
  deleteProject: (id: string) => void

  // tasks
  addTask: (input: Partial<Task> & { title: string }) => Task
  updateTask: (id: string, patch: Partial<Task>) => void
  deleteTask: (id: string) => void
  setTaskStatus: (id: string, status: TaskStatus) => void
  /** Move a task into a column at a position: before the given task, or at the end (beforeId null). */
  reorderTask: (id: string, status: TaskStatus, beforeId: string | null) => void
  /** Re-apply the automatic urgency order (priority, due date) to one column. */
  sortColumnByUrgency: (status: TaskStatus) => void
  completeTask: (id: string, done?: boolean) => void
  addTaskNote: (id: string, text: string) => void
  scheduleTask: (id: string, date: ISODate | undefined, start?: string) => void

  // events
  addEvent: (input: Omit<CalendarEvent, 'id' | 'source'> & { source?: CalendarEvent['source'] }) => CalendarEvent
  updateEvent: (id: string, patch: Partial<CalendarEvent>) => void
  deleteEvent: (id: string) => void
  /** Replaces the previous import of that source: its old events are dropped, the new ones added (kind/project overrides survive). */
  importEvents: (events: CalendarEvent[], source: 'ics' | 'm365') => { total: number; kept: number; removed: number }

  // plan blocks
  addBlock: (date: ISODate, projectId: string | null, size?: BlockSize) => PlanBlock
  updateBlock: (id: string, patch: Partial<PlanBlock>) => void
  removeBlock: (id: string) => void

  // reviews
  saveReview: (kind: Review['kind'], date: ISODate, notes: string) => void

  // settings & data
  updateSettings: (patch: Partial<Settings>) => void
  loadSample: (locale: Locale) => void
  clearAll: () => void
  exportData: () => DataSnapshot
  importData: (snapshot: DataSnapshot) => void
}

/** True when the object looks like a Zendo export (arrays present, version numeric or missing). */
export function isDataSnapshot(x: unknown): x is DataSnapshot {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  const arrays = ['inbox', 'projects', 'tasks', 'events', 'blocks']
  return arrays.every((k) => Array.isArray(o[k])) && (o.version === undefined || typeof o.version === 'number')
}

function nextColor(projects: Project[]): ProjectColor {
  const used = new Map<ProjectColor, number>()
  for (const p of projects) used.set(p.color, (used.get(p.color) ?? 0) + 1)
  return [...PROJECT_COLORS].sort((a, b) => (used.get(a) ?? 0) - (used.get(b) ?? 0))[0]
}

/** Mark a task done; a recurring task spawns its next occurrence (dates shifted, kept in the future). */
function completeWithRecurrence(tasks: Task[], target: Task): Task[] {
  const stamp = now()
  let result = tasks.map((t) =>
    t.id === target.id ? { ...t, status: 'done' as TaskStatus, statusBeforeDone: t.status === 'done' ? t.statusBeforeDone : t.status, completedAt: stamp, updatedAt: stamp } : t,
  )
  if (target.recurrence && target.status !== 'done') {
    const today = todayISO()
    const base = target.dueDate ?? target.plannedDate ?? today
    const anchor = target.recurrenceAnchor ?? base
    const next = nextOccurrenceFrom(anchor, target.recurrence, base > today ? base : today)
    const shift = daysBetween(base, next)
    const clone: Task = {
      ...target,
      id: uid(),
      status: target.status,
      notes: [],
      order: Date.now(),
      createdAt: stamp,
      updatedAt: stamp,
      completedAt: undefined,
      statusBeforeDone: undefined,
      recurrenceAnchor: anchor,
      spawnedFrom: target.id,
      dueDate: target.dueDate ? addDaysISO(target.dueDate, shift) : undefined,
      plannedDate: target.plannedDate ? addDaysISO(target.plannedDate, shift) : undefined,
    }
    result = [...(clone.status === 'next' ? withSingleNext(result, clone.id, clone.projectId) : result), clone]
  }
  return result
}

/** Undo a completion: drop the untouched occurrence it spawned and restore the previous status. */
function uncomplete(tasks: Task[], target: Task, status?: TaskStatus): Task[] {
  const restored = status ?? target.statusBeforeDone ?? 'todo'
  let result = tasks
    .filter((t) => !(t.spawnedFrom === target.id && t.status !== 'done'))
    .map((t) => (t.id === target.id ? { ...t, status: restored, completedAt: undefined, statusBeforeDone: undefined, updatedAt: now() } : t))
  if (restored === 'next') result = withSingleNext(result, target.id, target.projectId)
  return result
}

/** Enforce: at most one task with status "next" per project. */
function withSingleNext(tasks: Task[], promotedId: string, projectId: string | null): Task[] {
  if (projectId === null) return tasks
  return tasks.map((t) =>
    t.id !== promotedId && t.projectId === projectId && t.status === 'next'
      ? { ...t, status: 'todo' as TaskStatus, updatedAt: now() }
      : t,
  )
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      inbox: [],
      projects: [],
      tasks: [],
      events: [],
      blocks: [],
      reviews: [],
      settings: DEFAULT_SETTINGS,
      seeded: false,

      addInboxItem: (text) => {
        const item: InboxItem = { id: uid(), text: text.trim(), createdAt: now() }
        set((s) => ({ inbox: [...s.inbox, item] }))
        return item
      },
      updateInboxItem: (id, text) => set((s) => ({ inbox: s.inbox.map((i) => (i.id === id ? { ...i, text } : i)) })),
      removeInboxItem: (id) => set((s) => ({ inbox: s.inbox.filter((i) => i.id !== id) })),
      deferInboxItem: (id) =>
        set((s) => {
          const item = s.inbox.find((i) => i.id === id)
          if (!item) return {}
          return { inbox: [...s.inbox.filter((i) => i.id !== id), item] }
        }),

      addProject: (input) => {
        const project: Project = {
          id: uid(),
          status: 'active',
          color: nextColor(get().projects),
          createdAt: now(),
          updatedAt: now(),
          ...input,
          name: input.name.trim(),
        }
        set((s) => ({ projects: [...s.projects, project] }))
        return project
      },
      updateProject: (id, patch) =>
        set((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: now() } : p)) })),
      deleteProject: (id) =>
        set((s) => ({
          projects: s.projects.filter((p) => p.id !== id),
          tasks: s.tasks.filter((t) => t.projectId !== id),
          blocks: s.blocks.filter((b) => b.projectId !== id),
          events: s.events.map((e) => (e.projectId === id ? { ...e, projectId: null } : e)),
        })),

      addTask: (input) => {
        const task: Task = {
          id: uid(),
          projectId: null,
          status: 'todo',
          priority: 'normal',
          notes: [],
          order: Date.now(),
          createdAt: now(),
          updatedAt: now(),
          ...input,
          title: input.title.trim(),
        }
        set((s) => ({
          tasks: [...(task.status === 'next' ? withSingleNext(s.tasks, task.id, task.projectId) : s.tasks), task],
        }))
        return task
      },
      updateTask: (id, patch) =>
        set((s) => {
          let tasks = s.tasks.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: now() } : t))
          const updated = tasks.find((t) => t.id === id)
          if (updated && updated.status === 'next') tasks = withSingleNext(tasks, id, updated.projectId)
          return { tasks }
        }),
      deleteTask: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
      setTaskStatus: (id, status) =>
        set((s) => {
          const target = s.tasks.find((t) => t.id === id)
          if (!target) return {}
          if (status === 'done') return { tasks: completeWithRecurrence(s.tasks, target) }
          if (target.status === 'done') return { tasks: uncomplete(s.tasks, target, status) }
          let tasks = s.tasks.map((t) =>
            t.id === id
              ? {
                  ...t,
                  status,
                  order: Date.now(),
                  updatedAt: now(),
                  completedAt: undefined,
                }
              : t,
          )
          if (status === 'next') tasks = withSingleNext(tasks, id, target.projectId)
          return { tasks }
        }),
      reorderTask: (id, status, beforeId) =>
        set((s) => {
          const target = s.tasks.find((t) => t.id === id)
          if (!target) return {}
          let tasks: Task[]
          if (status === 'done' && target.status !== 'done') tasks = completeWithRecurrence(s.tasks, target)
          else tasks = s.tasks.map((t) => (t.id === id ? { ...t, status, updatedAt: now(), completedAt: status === 'done' ? t.completedAt : undefined } : t))
          if (status === 'next') tasks = withSingleNext(tasks, id, target.projectId)
          const moved = tasks.find((t) => t.id === id)!
          const column = tasks.filter((t) => t.status === status && t.id !== id).sort((a, b) => a.order - b.order)
          const at = beforeId ? column.findIndex((t) => t.id === beforeId) : -1
          column.splice(at >= 0 ? at : column.length, 0, moved)
          const orders = new Map(column.map((t, i) => [t.id, (i + 1) * 1000]))
          return { tasks: tasks.map((t) => (orders.has(t.id) ? { ...t, order: orders.get(t.id)! } : t)) }
        }),
      sortColumnByUrgency: (status) =>
        set((s) => {
          const column = s.tasks.filter((t) => t.status === status).sort(urgencyComparator(todayISO()))
          const orders = new Map(column.map((t, i) => [t.id, (i + 1) * 1000]))
          return { tasks: s.tasks.map((t) => (orders.has(t.id) ? { ...t, order: orders.get(t.id)!, updatedAt: now() } : t)) }
        }),
      completeTask: (id, done = true) =>
        set((s) => {
          const target = s.tasks.find((t) => t.id === id)
          if (!target) return {}
          if (done) return { tasks: completeWithRecurrence(s.tasks, target) }
          return { tasks: uncomplete(s.tasks, target) }
        }),
      addTaskNote: (id, text) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id ? { ...t, notes: [...t.notes, { id: uid(), text: text.trim(), createdAt: now() }], updatedAt: now() } : t,
          ),
        })),
      scheduleTask: (id, date, start) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id ? { ...t, plannedDate: date, plannedStart: date ? start : undefined, updatedAt: now() } : t,
          ),
        })),

      addEvent: (input) => {
        const event: CalendarEvent = { id: uid(), source: 'manual', ...input }
        set((s) => ({ events: [...s.events, event] }))
        return event
      },
      updateEvent: (id, patch) => set((s) => ({ events: s.events.map((e) => (e.id === id ? { ...e, ...patch } : e)) })),
      deleteEvent: (id) => set((s) => ({ events: s.events.filter((e) => e.id !== id) })),
      importEvents: (incoming, source) => {
        let kept = 0
        let removed = 0
        set((s) => {
          const previous = s.events.filter((e) => e.source === source)
          const byKey = new Map(previous.map((e) => [e.externalId, e]))
          const merged = incoming.map((ev) => {
            const prev = ev.externalId ? byKey.get(ev.externalId) : undefined
            if (!prev) return ev
            kept += 1
            byKey.delete(ev.externalId)
            return { ...ev, id: prev.id, kind: prev.kind, projectId: prev.projectId, private: prev.private ?? ev.private }
          })
          removed = byKey.size
          return { events: [...s.events.filter((e) => e.source !== source), ...merged] }
        })
        return { total: incoming.length, kept, removed }
      },

      addBlock: (date, projectId, size = 0.5) => {
        const block: PlanBlock = { id: uid(), date, projectId, size }
        set((s) => ({ blocks: [...s.blocks, block] }))
        return block
      },
      updateBlock: (id, patch) => set((s) => ({ blocks: s.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) })),
      removeBlock: (id) => set((s) => ({ blocks: s.blocks.filter((b) => b.id !== id) })),

      saveReview: (kind, date, notes) =>
        set((s) => {
          const existing = s.reviews.find((r) => r.kind === kind && r.date === date)
          if (existing) {
            return { reviews: s.reviews.map((r) => (r.id === existing.id ? { ...r, notes, updatedAt: now() } : r)) }
          }
          return { reviews: [...s.reviews, { id: uid(), kind, date, notes, updatedAt: now() }] }
        }),

      updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      loadSample: (locale) => {
        const data = buildSampleData(locale)
        set((s) => ({ ...data, settings: { ...s.settings, locale }, seeded: true }))
      },
      clearAll: () => set({ inbox: [], projects: [], tasks: [], events: [], blocks: [], reviews: [], seeded: true }),
      exportData: () => {
        const s = get()
        return {
          version: STORE_VERSION,
          exportedAt: now(),
          inbox: s.inbox,
          projects: s.projects,
          tasks: s.tasks,
          events: s.events,
          blocks: s.blocks,
          reviews: s.reviews,
          settings: s.settings,
        }
      },
      importData: (raw) => {
        if (!isDataSnapshot(raw)) throw new Error('not_a_snapshot')
        const snap = migratePersisted({ ...raw } as DataSnapshot, raw.version ?? 1)
        set({
          inbox: snap.inbox ?? [],
          projects: snap.projects ?? [],
          tasks: snap.tasks ?? [],
          events: snap.events ?? [],
          blocks: snap.blocks ?? [],
          reviews: snap.reviews ?? [],
          settings: { ...DEFAULT_SETTINGS, ...(snap.settings ?? {}) },
          seeded: true,
        })
      },
    }),
    {
      name: 'zendo.v1',
      storage: createJSONStorage(() => localStorage),
      version: STORE_VERSION,
      migrate: (persisted, version) => migratePersisted(persisted as Partial<State>, version) as State,
      partialize: (s) => ({
        inbox: s.inbox,
        projects: s.projects,
        tasks: s.tasks,
        events: s.events,
        blocks: s.blocks,
        reviews: s.reviews,
        settings: s.settings,
        seeded: s.seeded,
      }),
    },
  ),
)
