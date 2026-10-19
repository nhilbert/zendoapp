import { type CSSProperties, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock, Hourglass, Lock, Repeat } from 'lucide-react'
import type { ISODate, Project, ProjectColor, Task } from '@/domain/types'
import { compareISO, fmtDate, fmtWeekday, todayISO } from '@/domain/dates'
import { useStore } from '@/store/useStore'
import { Chip, cx } from './ui'

export function useLocale(): string {
  const { i18n } = useTranslation()
  return i18n.language.startsWith('de') ? 'de-DE' : 'en-GB'
}

export function projectVars(color?: ProjectColor | null): CSSProperties {
  return { '--pc': `var(--c-${color ?? 'neutral'})` } as CSSProperties
}

export function useProjectMap(): Map<string, Project> {
  const projects = useStore((s) => s.projects)
  return useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])
}

export function ProjectDot({ color, size = 8, className }: { color?: ProjectColor | null; size?: number; className?: string }) {
  return <span className={cx('pc-dot inline-block shrink-0 rounded-full', className)} style={{ ...projectVars(color), width: size, height: size }} />
}

export function ProjectChip({ project, className }: { project: Project | null | undefined; className?: string }) {
  const { t } = useTranslation()
  return (
    <span className={cx('inline-flex min-w-0 items-center gap-1.5 text-[12px] text-ink-2', className)}>
      <ProjectDot color={project?.color ?? null} />
      <span className="truncate">{project ? project.name : t('task.chore')}</span>
    </span>
  )
}

export function fmtEstimate(min: number | undefined, t: (k: 'estimate.15' | 'estimate.30' | 'estimate.60' | 'estimate.120' | 'estimate.240' | 'estimate.480') => string): string {
  switch (min) {
    case 15:
      return t('estimate.15')
    case 30:
      return t('estimate.30')
    case 60:
      return t('estimate.60')
    case 120:
      return t('estimate.120')
    case 240:
      return t('estimate.240')
    case 480:
      return t('estimate.480')
    case undefined:
      return ''
    default:
      return min >= 60 ? `${Math.round((min / 60) * 10) / 10} h` : `${min} min`
  }
}

/** "Today" / "Tomorrow" / "Mon 21 Oct" */
export function useRelDay() {
  const { t } = useTranslation()
  const locale = useLocale()
  const today = todayISO()
  return (iso: ISODate): string => {
    const diff = compareISO(iso, today)
    if (diff === 0) return t('common.today')
    const d = new Date(iso).getTime() - new Date(today).getTime()
    if (d === 86_400_000) return t('common.tomorrow')
    if (d === -86_400_000) return t('common.yesterday')
    return `${fmtWeekday(iso, locale)} ${fmtDate(iso, locale)}`
  }
}

export function TaskMeta({ task, hideProject, className }: { task: Task; hideProject?: boolean; className?: string }) {
  const { t } = useTranslation()
  const projects = useProjectMap()
  const rel = useRelDay()
  const today = todayISO()
  const project = task.projectId ? projects.get(task.projectId) : null
  const overdue = task.status !== 'done' && task.dueDate && compareISO(task.dueDate, today) < 0
  const dueToday = task.dueDate === today
  return (
    <div className={cx('flex flex-wrap items-center gap-1.5', className)}>
      {!hideProject && <ProjectChip project={project} className="mr-1" />}
      {task.estimateMinutes && (
        <Chip>
          <Hourglass size={11} />
          {fmtEstimate(task.estimateMinutes, t)}
        </Chip>
      )}
      {task.dueDate && (
        <Chip tone={overdue ? 'rose' : dueToday ? 'amber' : 'neutral'}>
          {overdue ? t('task.overdue') : dueToday ? t('task.dueToday') : t('task.dueOn', { date: rel(task.dueDate) })}
        </Chip>
      )}
      {task.plannedDate && task.plannedDate !== task.dueDate && (
        <Chip>
          <Clock size={11} />
          {rel(task.plannedDate)}
        </Chip>
      )}
      {(task.private || project?.private) && (
        <Chip>
          <Lock size={11} />
          {t('privacy.private')}
        </Chip>
      )}
      {task.recurrence && (
        <Chip>
          <Repeat size={11} />
          {t(`recurrence.${task.recurrence}`)}
        </Chip>
      )}
      {task.status === 'waiting' && task.waitingFor && <Chip>{task.waitingFor}</Chip>}
    </div>
  )
}
