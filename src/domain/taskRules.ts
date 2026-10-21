import type { Project, ProjectColor, Task, TaskStatus } from './types.ts'
import { PROJECT_COLORS } from './types.ts'
import { addDaysISO, daysBetween, nextOccurrenceFrom, todayISO } from './dates.ts'

/**
 * Task and project rules shared by the browser store and the server (MCP tools).
 * Pure: they return new arrays and keep unchanged records as the same objects.
 */

const now = () => new Date().toISOString()
const uid = () => crypto.randomUUID()

export function nextColor(projects: Project[]): ProjectColor {
  const used = new Map<ProjectColor, number>()
  for (const p of projects) used.set(p.color, (used.get(p.color) ?? 0) + 1)
  return [...PROJECT_COLORS].sort((a, b) => (used.get(a) ?? 0) - (used.get(b) ?? 0))[0]
}

/** Mark a task done; a recurring task spawns its next occurrence (dates shifted, kept in the future). */
export function completeWithRecurrence(tasks: Task[], target: Task): Task[] {
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

/** A spawned occurrence nobody has edited since (no notes, never updated): undoing the completion may drop it. */
const untouched = (t: Task) => t.updatedAt === t.createdAt && !t.notes?.length

/** Undo a completion: drop the untouched occurrence it spawned (an edited one stays) and restore the previous status. */
export function uncomplete(tasks: Task[], target: Task, status?: TaskStatus): Task[] {
  const restored = status ?? target.statusBeforeDone ?? 'todo'
  let result = tasks
    .filter((t) => !(t.spawnedFrom === target.id && t.status !== 'done' && untouched(t)))
    .map((t) => (t.id === target.id ? { ...t, status: restored, completedAt: undefined, statusBeforeDone: undefined, updatedAt: now() } : t))
  if (restored === 'next') result = withSingleNext(result, target.id, target.projectId)
  return result
}

/** Enforce: at most one task with status "next" per project. */
export function withSingleNext(tasks: Task[], promotedId: string, projectId: string | null): Task[] {
  if (projectId === null) return tasks
  return tasks.map((t) =>
    t.id !== promotedId && t.projectId === projectId && t.status === 'next'
      ? { ...t, status: 'todo' as TaskStatus, updatedAt: now() }
      : t,
  )
}
