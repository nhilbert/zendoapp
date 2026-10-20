import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { CalendarEvent, PlanBlock, Project, Task } from '@/domain/types'
import { isWorkable, visibleBlocks } from '@/domain/selectors'
import { useStore } from './useStore'

/**
 * "Hide private" mode: pages read tasks/projects/blocks through these hooks so
 * private items (and everything belonging to a private project) disappear from
 * every list, board, plan and review at once. Detail views keep full access.
 */
export function isPrivateTask(task: Task, projects: Map<string, Project>): boolean {
  return !!task.private || (!!task.projectId && !!projects.get(task.projectId)?.private)
}

export function useHidePrivate(): boolean {
  return useStore((s) => !!s.settings.hidePrivate)
}

/** Listed projects: not archived (unless asked for) and not private while hiding. */
export function useVisibleProjects(opts: { includeArchived?: boolean } = {}): Project[] {
  const projects = useStore((s) => s.projects)
  const hide = useHidePrivate()
  const includeArchived = !!opts.includeArchived
  return useMemo(
    () => projects.filter((p) => (includeArchived || p.status !== 'archived') && (!hide || !p.private)),
    [projects, hide, includeArchived],
  )
}

/** Workable tasks: chores plus tasks of active/planned projects; private ones removed while hiding. */
export function useVisibleTasks(): Task[] {
  const tasks = useStore((s) => s.tasks)
  const projects = useStore((s) => s.projects)
  const hide = useHidePrivate()
  return useMemo(() => {
    const map = new Map(projects.map((p) => [p.id, p]))
    return tasks.filter((t) => {
      const project = t.projectId ? map.get(t.projectId) : undefined
      if (t.projectId && (!project || !isWorkable(project))) return false
      return !hide || !isPrivateTask(t, map)
    })
  }, [tasks, projects, hide])
}

export function useVisibleBlocks(): PlanBlock[] {
  const blocks = useStore((s) => s.blocks)
  const projects = useStore((s) => s.projects)
  const hide = useHidePrivate()
  return useMemo(() => visibleBlocks(blocks, projects, hide), [blocks, projects, hide])
}

export type VisibleEvent = CalendarEvent & { masked?: boolean }

/**
 * Events are never removed while hiding private items – their time is still
 * taken – but private ones are masked: generic title, no location, no project,
 * and they cannot be opened.
 */
export function useVisibleEvents(): VisibleEvent[] {
  const events = useStore((s) => s.events)
  const hide = useHidePrivate()
  const { t, i18n } = useTranslation()
  return useMemo(
    () => (hide ? events.map((e) => (e.private ? { ...e, title: t('privacy.privateEvent'), location: undefined, masked: true } : e)) : events),
    [events, hide, t, i18n.language],
  )
}
