import { useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { CalendarClock, Lock, Plus } from 'lucide-react'
import type { Project } from '@/domain/types'
import { compareISO, fmtTime, nowHHMM, todayISO } from '@/domain/dates'
import { nextActionOf, openTasksOfProject, upcomingMeetings } from '@/domain/selectors'
import type { Task } from '@/domain/types'
import { useStore } from '@/store/useStore'
import { useVisibleEvents, useVisibleProjects, useVisibleTasks, type VisibleEvent } from '@/store/visible'
import { Button, Chip, Empty, Input, PageHeader, SectionLabel } from '@/components/ui'
import { ProjectDot, useLocale, useRelDay } from '@/components/TaskBits'

export default function ProjectsPage() {
  const { t } = useTranslation()
  const projects = useVisibleProjects({ includeArchived: true })
  // someday and archived projects are listed too, with their own open tasks
  const tasks = useVisibleTasks({ includeInactive: true })
  // masked private meetings show no project (CAL-7)
  const events = useVisibleEvents().filter((e) => !e.masked)
  const addProject = useStore((s) => s.addProject)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  const byDue = (a: Project, b: Project) => (a.dueDate && b.dueDate ? compareISO(a.dueDate, b.dueDate) : a.dueDate ? -1 : b.dueDate ? 1 : a.name.localeCompare(b.name))
  const active = projects.filter((p) => p.status === 'active').sort(byDue)
  const planned = projects.filter((p) => p.status === 'planned').sort(byDue)
  const inactive = projects.filter((p) => p.status === 'someday' || p.status === 'archived')

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={t('projects.title')}
        subtitle={t('projects.subtitle')}
        right={
          <Button onClick={() => setAdding(true)}>
            <Plus size={14} /> {t('projects.new')}
          </Button>
        }
      />
      {adding && (
        <form
          className="mb-6 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) addProject({ name })
            setName('')
            setAdding(false)
          }}
        >
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t('projects.namePlaceholder')} onBlur={() => !name && setAdding(false)} />
          <Button variant="primary" type="submit">
            {t('common.add')}
          </Button>
        </form>
      )}

      {projects.length === 0 && !adding && <Empty title={t('projects.empty')} />}

      <div className="flex flex-col gap-2">
        {active.map((p) => (
          <ProjectRow key={p.id} project={p} tasks={tasks} events={events} />
        ))}
      </div>

      {planned.length > 0 && (
        <>
          <SectionLabel className="mt-10">{t('projects.planned')}</SectionLabel>
          <div className="flex flex-col gap-2">
            {planned.map((p) => (
              <ProjectRow key={p.id} project={p} tasks={tasks} events={events} />
            ))}
          </div>
        </>
      )}

      {inactive.length > 0 && (
        <details className="mt-10">
          <summary className="cursor-pointer select-none text-[11px] font-medium uppercase tracking-[0.12em] text-ink-3">{t('projects.inactive')}</summary>
          <div className="mt-3 flex flex-col gap-2">
            {inactive.map((p) => (
              <ProjectRow key={p.id} project={p} tasks={tasks} events={events} muted />
            ))}
          </div>
        </details>
      )}
      <div className="h-10" />
    </div>
  )
}

function ProjectRow({ project, tasks, events, muted }: { project: Project; tasks: Task[]; events: VisibleEvent[]; muted?: boolean }) {
  const { t } = useTranslation()
  const rel = useRelDay()
  const locale = useLocale()
  const next = nextActionOf(tasks, project.id)
  const meeting = upcomingMeetings(events, project.id, todayISO(), nowHHMM())[0]
  const open = openTasksOfProject(tasks, project.id).length
  return (
      <Link to={`/projects/${project.id}`} className={`card flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-surface-2 md:px-5 md:py-4 ${muted ? 'opacity-70' : ''}`}>
        <ProjectDot color={project.color} size={10} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <span className="truncate text-[15px] font-medium">{project.name}</span>
            {project.private && <Lock size={13} className="shrink-0 text-ink-3" />}
            {project.status !== 'active' && <Chip>{t(`project.status${project.status === 'planned' ? 'Planned' : project.status === 'someday' ? 'Someday' : 'Archived'}`)}</Chip>}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[13px]">
            {next ? (
              <>
                <span className="text-accent">→</span>
                <span className="truncate text-ink-2">{next.title}</span>
              </>
            ) : project.status === 'active' ? (
              <span className="text-amber">{t('projects.needsNext')}</span>
            ) : null}
          </div>
          {meeting && (
            <div className="tnum mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-3">
              <CalendarClock size={12} className="shrink-0" />
              <span className="truncate">{t('projects.nextMeeting', { when: `${rel(meeting.date)}${meeting.allDay ? '' : ` ${fmtTime(meeting.start, locale)}`}` })}</span>
            </div>
          )}
        </div>
        <div className="hidden shrink-0 items-center gap-2 text-[12px] text-ink-3 sm:flex">
          {project.dueDate && <span>{t('projects.due', { date: rel(project.dueDate) })}</span>}
          <span className="tnum">{t('projects.open', { count: open })}</span>
        </div>
      </Link>
    )
}
