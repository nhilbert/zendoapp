import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { DndContext, DragOverlay, type DragEndEvent, type DragMoveEvent, KeyboardSensor, MouseSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core'
import { CalendarClock, Lock, Plus } from 'lucide-react'
import type { Project } from '@/domain/types'
import { fmtTime, nowHHMM, todayISO } from '@/domain/dates'
import { nextActionOf, openTasksOfProject, upcomingMeetings } from '@/domain/selectors'
import type { Task } from '@/domain/types'
import { useStore } from '@/store/useStore'
import { useVisibleEvents, useVisibleProjects, useVisibleTasks, type VisibleEvent } from '@/store/visible'
import { Button, Chip, Empty, Input, PageHeader, SectionLabel, cx } from '@/components/ui'
import { collision } from '@/components/dnd'
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

  const reorderProject = useStore((s) => s.reorderProject)
  // already in the user's order (useVisibleProjects); dragging sorts within a section
  const active = projects.filter((p) => p.status === 'active')
  const planned = projects.filter((p) => p.status === 'planned')
  const inactive = projects.filter((p) => p.status === 'someday' || p.status === 'archived')
  const sections = [active, planned, inactive]
  const sectionOf = (id: string) => sections.find((list) => list.some((p) => p.id === id)) ?? []

  // Drag and drop: a thin line shows where the project lands; Enter still opens it, Space picks it up.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] } }),
  )
  const [dragId, setDragId] = useState<string | null>(null)
  const [line, setLine] = useState<Line>(null)
  const lineRef = useRef<Line>(null)
  const droppedAt = useRef(0)
  const showLine = (next: Line) => {
    lineRef.current = next
    setLine(next)
  }
  const onDragMove = (e: DragMoveEvent) => {
    const rect = e.active.rect.current.translated
    const overId = e.over ? String(e.over.id).slice(5) : null
    if (!e.over || !rect || !overId || overId === e.active.id || !sectionOf(String(e.active.id)).some((p) => p.id === overId)) {
      if (lineRef.current) showLine(null)
      return
    }
    const position = rect.top + rect.height / 2 < e.over.rect.top + e.over.rect.height / 2 ? 'before' : 'after'
    if (lineRef.current?.id !== overId || lineRef.current.position !== position) showLine({ id: overId, position })
  }
  const onDragEnd = (e: DragEndEvent) => {
    const id = String(e.active.id)
    const at = lineRef.current
    setDragId(null)
    showLine(null)
    droppedAt.current = Date.now()
    if (!at) return
    const rest = sectionOf(id).filter((p) => p.id !== id)
    const beforeId = at.position === 'before' ? at.id : (rest[rest.findIndex((p) => p.id === at.id) + 1]?.id ?? null)
    reorderProject(id, beforeId)
  }
  const rows = (list: Project[], muted?: boolean) =>
    list.map((p) => (
      <SortableRow key={p.id} id={p.id} line={line?.id === p.id ? line.position : null}>
        <ProjectRow project={p} tasks={tasks} events={events} muted={muted} />
      </SortableRow>
    ))
  const dragged = dragId ? projects.find((p) => p.id === dragId) : undefined

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

      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        onDragStart={(e) => setDragId(String(e.active.id))}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setDragId(null)
          showLine(null)
        }}
      >
        <div
          onClickCapture={(e) => {
            // the release that ends a drag must not open the project
            if (Date.now() - droppedAt.current < 300) {
              e.preventDefault()
              e.stopPropagation()
            }
          }}
        >
          <div className="flex flex-col gap-2">{rows(active)}</div>

          {planned.length > 0 && (
            <>
              <SectionLabel className="mt-10">{t('projects.planned')}</SectionLabel>
              <div className="flex flex-col gap-2">{rows(planned)}</div>
            </>
          )}

          {inactive.length > 0 && (
            <details className="mt-10">
              <summary className="cursor-pointer select-none text-[11px] font-medium uppercase tracking-[0.12em] text-ink-3">{t('projects.inactive')}</summary>
              <div className="mt-3 flex flex-col gap-2">{rows(inactive, true)}</div>
            </details>
          )}
        </div>
        <DragOverlay dropAnimation={null}>
          {dragged ? (
            <div className="rounded-xl shadow-[var(--shadow)]">
              <ProjectRow project={dragged} tasks={tasks} events={events} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      <div className="h-10" />
    </div>
  )
}

type Line = { id: string; position: 'before' | 'after' } | null

/** A row that can be dragged within its section and dropped on; line: where the dragged project would land. */
function SortableRow({ id, line, children }: { id: string; line: 'before' | 'after' | null; children: React.ReactNode }) {
  const drag = useDraggable({ id })
  const drop = useDroppable({ id: `drop:${id}` })
  return (
    <div
      ref={(el) => {
        drag.setNodeRef(el)
        drop.setNodeRef(el)
      }}
      {...drag.listeners}
      className={cx('relative cursor-grab touch-manipulation select-none [-webkit-touch-callout:none] active:cursor-grabbing', drag.isDragging && 'opacity-40')}
    >
      {line === 'before' && <span className="pointer-events-none absolute -top-[5px] left-2 right-2 h-[2px] rounded-full bg-accent" />}
      {children}
      {line === 'after' && <span className="pointer-events-none absolute -bottom-[5px] left-2 right-2 h-[2px] rounded-full bg-accent" />}
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
      <Link to={`/projects/${project.id}`} draggable={false} className={`card flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-surface-2 md:px-5 md:py-4 ${muted ? 'opacity-70' : ''}`}>
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
