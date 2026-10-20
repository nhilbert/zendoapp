import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { DndContext, DragOverlay, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { ChevronLeft, ChevronRight, Lock, MapPin, Plus, Target, Video, X } from 'lucide-react'
import { BLOCK_SIZE_LABEL, type ISODate, type PlanBlock, type Task } from '@/domain/types'
import type { VisibleEvent } from '@/store/visible'
import { addDaysISO, addMinutes, compareISO, durationMinutes, fmtDate, fmtHours, fmtTime, hhmmToMinutes, minutesToHHMM, nowHHMM, todayISO } from '@/domain/dates'
import { type DayCapacity, blocksOn, candidatesForDay, dayCapacity, eventsOn, isBlocking, isOpen, leftoverTasks, projectsWithoutNextAction, safeTimes, sortByTime, sortTasks, tasksPlannedOn } from '@/domain/selectors'
import { useStore } from '@/store/useStore'
import { useVisibleBlocks, useVisibleEvents, useVisibleProjects, useVisibleTasks } from '@/store/visible'
import { useUi } from '@/store/useUi'
import { Draggable, Droppable, collision, useDndSensors } from '@/components/dnd'
import { Button, Checkbox, Chip, IconButton, SectionLabel, Segmented, Textarea, cx, useIsPhone } from '@/components/ui'
import { ProjectChip, ProjectDot, TaskMeta, projectVars, useLocale, useProjectMap } from '@/components/TaskBits'
import { JoinLink } from '@/components/JoinLink'
import { joinUrlOf } from '@/domain/meeting'

const SLOT = 30 // minutes
const MIN_PX = 22 // minimum px per slot; the grid stretches to fill the viewport
const PHONE_PX = 30 // fixed slot height on phones (comfortable touch targets, page scrolls)
const LABEL_W = 52

export default function TodayPage() {
  const { t } = useTranslation()
  const locale = useLocale()
  const [params, setParams] = useSearchParams()
  const today = todayISO()
  const date = params.get('date') ?? today
  const setDate = (d: ISODate) => setParams(d === today ? {} : { date: d })

  const tasks = useVisibleTasks()
  const projects = useVisibleProjects()
  const events = useVisibleEvents()
  const blocks = useVisibleBlocks()
  const settings = safeTimes(useStore((s) => s.settings))
  const reviews = useStore((s) => s.reviews)
  const scheduleTask = useStore((s) => s.scheduleTask)
  const saveReview = useStore((s) => s.saveReview)
  const openTask = useUi((s) => s.openTask)
  const openEvent = useUi((s) => s.openEvent)
  const sensors = useDndSensors()
  const [activeId, setActiveId] = useState<string | null>(null)
  const isPhone = useIsPhone()
  const [phoneView, setPhoneView] = useState<'plan' | 'timeline'>('plan')

  const dayEvents = eventsOn(events, date)
  const planned = tasksPlannedOn(tasks, date).sort(sortTasks)
  const timed = planned.filter((x) => x.plannedStart).sort(sortByTime)
  const untimed = planned.filter((x) => !x.plannedStart)
  const cap = dayCapacity(date, settings, events, blocks, tasks)
  // Rollover: on today, unfinished tasks from earlier days are offered once (and not repeated among the candidates).
  const leftovers = date === today ? leftoverTasks(tasks, today) : []
  const cands = candidatesForDay(date, tasks, blocks, projects, new Set(leftovers.map((x) => x.id)))
  const missingNext = projectsWithoutNextAction(projects, tasks)
  const dayReview = reviews.find((r) => r.kind === 'daily' && r.date === date)
  const [notes, setNotes] = useState(dayReview?.notes ?? '')
  useEffect(() => setNotes(dayReview?.notes ?? ''), [date, dayReview?.notes])

  // Timeline range: working hours, widened to include everything scheduled.
  const { gridStart, gridEnd } = useMemo(() => {
    let s = hhmmToMinutes(settings.workdayStart)
    let e = hhmmToMinutes(settings.workdayEnd)
    for (const ev of dayEvents.filter((x) => !x.allDay)) {
      s = Math.min(s, hhmmToMinutes(ev.start))
      e = Math.max(e, hhmmToMinutes(ev.end))
    }
    for (const x of timed) {
      s = Math.min(s, hhmmToMinutes(x.plannedStart!))
      e = Math.max(e, hhmmToMinutes(x.plannedStart!) + (x.estimateMinutes ?? 30))
    }
    return { gridStart: Math.floor(s / 60) * 60, gridEnd: Math.min(24 * 60, Math.ceil(e / 60) * 60) }
  }, [settings.workdayStart, settings.workdayEnd, dayEvents, timed])
  const slots = useMemo(() => {
    const out: string[] = []
    for (let m = gridStart; m < gridEnd; m += SLOT) out.push(minutesToHHMM(m))
    return out
  }, [gridStart, gridEnd])
  const allDayEvents = dayEvents.filter((x) => x.allDay)

  // The timeline stretches to the available height so the day fills the screen.
  const sectionRef = useRef<HTMLElement>(null)
  const [avail, setAvail] = useState(0)
  useEffect(() => {
    const el = sectionRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setAvail(entry.contentRect.height))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const px = isPhone ? PHONE_PX : Math.max(MIN_PX, Math.floor((avail - (allDayEvents.length ? 44 : 0) - 16) / Math.max(1, slots.length)))
  const height = slots.length * px
  const y = (hhmm: string) => ((hhmmToMinutes(hhmm) - gridStart) / SLOT) * px

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id).replace('task:', ''))
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null)
    const over = e.over?.id ? String(e.over.id) : null
    const id = String(e.active.id).replace('task:', '')
    if (!over) return
    if (over.startsWith('slot:')) scheduleTask(id, date, over.slice(5))
    else if (over === 'untimed') scheduleTask(id, date)
  }
  const activeTask = activeId ? tasks.find((x) => x.id === activeId) : undefined

  const title = fmtDate(date, locale, { weekday: 'long', day: 'numeric', month: 'long' })
  const saveNotes = () => {
    if (notes !== (dayReview?.notes ?? '')) saveReview('daily', date, notes)
  }

  return (
    <div className="flex flex-col md:h-[calc(100dvh-5rem)] md:min-h-[520px]">
      <header className="mb-4 flex items-end justify-between gap-4 md:mb-6 md:gap-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h1 className="text-[22px] font-medium leading-tight tracking-[-0.02em] md:text-[26px]">{date === today ? t('today.title') : title}</h1>
            {date === today && <span className="text-[14px] text-ink-3">{title}</span>}
          </div>
          <p className="tnum mt-1 text-[13px] text-ink-2">
            {t('today.capacity', {
              meetings: fmtHours(cap.meetingMinutes, locale),
              planned: fmtHours(cap.plannedTaskMinutes, locale),
              free: fmtHours(Math.max(0, cap.workMinutes - cap.meetingMinutes - cap.plannedTaskMinutes), locale),
            })}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {date !== today && (
            <Button variant="ghost" size="sm" onClick={() => setDate(today)}>
              {t('common.today')}
            </Button>
          )}
          <IconButton label="‹" onClick={() => setDate(addDaysISO(date, -1))}>
            <ChevronLeft size={16} />
          </IconButton>
          <IconButton label="›" onClick={() => setDate(addDaysISO(date, 1))}>
            <ChevronRight size={16} />
          </IconButton>
        </div>
      </header>

      <div className="mb-4 md:hidden">
        <Segmented<'plan' | 'timeline'>
          value={phoneView}
          onChange={setPhoneView}
          options={[
            { value: 'plan', label: t('today.viewList') },
            { value: 'timeline', label: t('today.viewTimeline') },
          ]}
        />
      </div>

      <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-8 md:grid-cols-[minmax(0,1fr)_360px] md:gap-12">
          {/* Timeline */}
          <section ref={sectionRef} className={cx('min-h-0 overflow-x-hidden pr-1 pt-2 md:block md:overflow-y-auto', phoneView === 'timeline' ? 'block' : 'hidden')}>
            {allDayEvents.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2" style={{ paddingLeft: LABEL_W }}>
                {allDayEvents.map((ev) => (
                  <button key={ev.id} type="button" onClick={() => !ev.masked && openEvent(ev.id)} className={cx('rounded-full bg-surface-2 px-3 py-1 text-[12px] text-ink-2', ev.masked && 'italic text-ink-3')}>
                    {t('today.allDay')} · {ev.title}
                  </button>
                ))}
              </div>
            )}
            <div className="relative select-none" style={{ height }}>
              {slots.map((s, i) => {
                const isHour = s.endsWith(':00')
                return (
                  <div key={s} className="absolute left-0 right-0" style={{ top: i * px, height: px }}>
                    {isHour && (
                      <span className="tnum absolute -top-2 left-0 text-[11px] text-ink-3" style={{ width: LABEL_W - 8 }}>
                        {fmtTime(s, locale)}
                      </span>
                    )}
                    <div className="absolute inset-y-0 right-0" style={{ left: LABEL_W }}>
                      <Droppable id={`slot:${s}`} className={cx('h-full border-t', isHour ? 'border-line' : 'border-line/50')} overClassName="bg-accent-soft/60" data={{ slot: s }} />
                    </div>
                  </div>
                )
              })}
              {/* Slot droppables cover full width; content lanes sit on top with pointer-events on blocks only */}
              <div className="pointer-events-none absolute inset-y-0 right-0" style={{ left: LABEL_W }}>
                <div className="absolute inset-y-0 left-0 w-[38%] pr-2">
                  {dayEvents
                    .filter((x) => !x.allDay)
                    .map((ev) => (
                      <EventBlock key={ev.id} event={ev} top={y(ev.start)} h={Math.max(px, (durationMinutes(ev.start, ev.end) / SLOT) * px)} px={px} />
                    ))}
                </div>
                <div className="absolute inset-y-0 right-0 w-[62%] pl-1">
                  {timed.map((x) => (
                    <div key={x.id} className="pointer-events-auto absolute left-1 right-0" style={{ top: y(x.plannedStart!), height: Math.max(px, ((x.estimateMinutes ?? 30) / SLOT) * px) }}>
                      <Draggable id={`task:${x.id}`} className="h-full" onClick={() => openTask(x.id)}>
                        <TaskBlock task={x} />
                      </Draggable>
                    </div>
                  ))}
                </div>
                {date === today && hhmmToMinutes(nowHHMM()) >= gridStart && hhmmToMinutes(nowHHMM()) <= gridEnd && (
                  <div className="absolute left-0 right-0 flex items-center" style={{ top: y(nowHHMM()) }}>
                    <span className="-ml-1 h-1.5 w-1.5 rounded-full bg-rose" />
                    <span className="h-px flex-1 bg-rose/60" />
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Plan & candidates */}
          <aside className={cx('min-h-0 flex-col gap-8 pb-4 md:flex md:overflow-y-auto md:pr-1', phoneView === 'plan' ? 'flex' : 'hidden')}>
            <Leftovers tasks={leftovers} today={today} />

            <DayBlocks blocks={blocksOn(blocks, date)} cap={cap} dayCapacityHours={settings.dayCapacityHours} />

            <div>
              <SectionLabel>{t('today.plan')}</SectionLabel>
              <Droppable id="untimed" className="min-h-[56px] rounded-xl transition-colors" overClassName="bg-accent-soft/60">
                {untimed.length === 0 && timed.length === 0 ? (
                  <p className="px-1 py-2 text-[13px] text-ink-3">{t('today.emptyPlan')}</p>
                ) : untimed.length === 0 ? (
                  <p className="px-1 py-2 text-[12px] text-ink-3">{t('today.dropHere')}</p>
                ) : (
                  <ul className="flex flex-col">
                    {untimed.map((x) => (
                      <li key={x.id}>
                        <Draggable id={`task:${x.id}`} className="rounded-lg" onClick={() => openTask(x.id)}>
                          <PlanRow task={x} />
                        </Draggable>
                      </li>
                    ))}
                  </ul>
                )}
              </Droppable>
            </div>

            <div>
              <SectionLabel>{t('today.candidates')}</SectionLabel>
              <div className="flex flex-col gap-4">
                <CandidateGroup label={t('today.overdue')} items={cands.overdue} tone="rose" date={date} />
                <CandidateGroup label={t('today.dueToday')} items={cands.due} tone="amber" date={date} />
                {cands.fromBlocks.length > 0 && (
                  <div>
                    <div className="mb-1 text-[12px] text-ink-3">{t('today.fromBlocks')}</div>
                    <ul className="flex flex-col gap-1">
                      {cands.fromBlocks.map(({ project, task }, i) =>
                        project && !task ? (
                          <li key={i} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[13px]" style={projectVars(project.color)}>
                            <span className="flex min-w-0 items-center gap-2 text-amber">
                              <ProjectDot color={project.color} />
                              <span className="truncate">{t('today.nextMissing', { project: project.name })}</span>
                            </span>
                            <Link to={`/projects/${project.id}`} className="shrink-0 text-[12px] text-ink-2 hover:text-ink">
                              {t('today.pick')} →
                            </Link>
                          </li>
                        ) : task ? (
                          <CandidateRow key={task.id} task={task} date={date} />
                        ) : (
                          <li key={i} className="px-2 py-1.5 text-[13px] text-ink-2">
                            <ProjectChip project={null} /> · {t('today.chores')}
                          </li>
                        ),
                      )}
                    </ul>
                  </div>
                )}
                <CandidateGroup label={t('today.chores')} items={cands.chores} date={date} />
                {cands.overdue.length + cands.due.length + cands.fromBlocks.length + cands.chores.length === 0 && (
                  <p className="text-[13px] text-ink-3">{t('today.noCandidates')}</p>
                )}
              </div>
            </div>

            {missingNext.length > 0 && (
              <div>
                <SectionLabel>{t('review.noNextAction')}</SectionLabel>
                <ul className="flex flex-col gap-1">
                  {missingNext.map((p) => (
                    <NextActionPrompt key={p.id} projectId={p.id} tasks={tasks} />
                  ))}
                </ul>
              </div>
            )}

            <div>
              <SectionLabel>{t('today.notes')}</SectionLabel>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={saveNotes} placeholder={t('today.notesPlaceholder')} className="min-h-[96px]" />
            </div>
          </aside>
        </div>
        <DragOverlay dropAnimation={null}>{activeTask ? <PlanRow task={activeTask} overlay /> : null}</DragOverlay>
      </DndContext>
    </div>
  )
}

/** Rollover: tasks planned for earlier days and not done – into today, back to the lists, or ticked off. */
function Leftovers({ tasks, today }: { tasks: Task[]; today: ISODate }) {
  const { t } = useTranslation()
  const locale = useLocale()
  const projectMap = useProjectMap()
  const openTask = useUi((s) => s.openTask)
  const completeTask = useStore((s) => s.completeTask)
  const rescheduleTasks = useStore((s) => s.rescheduleTasks)
  if (tasks.length === 0) return null
  const ids = tasks.map((x) => x.id)
  return (
    <div>
      <SectionLabel>{t('today.leftover')}</SectionLabel>
      <ul className="flex flex-col">
        {tasks.map((task) => {
          const project = task.projectId ? projectMap.get(task.projectId) : null
          // Leftovers are not repeated under Overdue / Due today, so they carry that deadline marker here.
          const overdue = !!task.dueDate && compareISO(task.dueDate, today) < 0
          const dueToday = task.dueDate === today
          return (
            <li key={task.id} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-surface-2">
              <Checkbox checked={false} onChange={(v) => completeTask(task.id, v)} className="shrink-0" />
              <button type="button" onClick={() => openTask(task.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left text-[13px]">
                <ProjectDot color={project?.color ?? null} size={6} />
                <span className="truncate">{task.title}</span>
                <span className="tnum shrink-0 text-[11px] text-ink-3">{fmtDate(task.plannedDate!, locale, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                {(overdue || dueToday) && (
                  <Chip tone={overdue ? 'rose' : 'amber'} className="shrink-0">
                    {overdue ? t('task.overdue') : t('task.dueToday')}
                  </Chip>
                )}
              </button>
              <IconButton label={t('today.toToday')} onClick={() => rescheduleTasks([task.id], today)}>
                <Plus size={14} />
              </IconButton>
              <IconButton label={t('today.unplan')} onClick={() => rescheduleTasks([task.id], undefined)}>
                <X size={14} />
              </IconButton>
            </li>
          )
        })}
      </ul>
      {tasks.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-2 px-1">
          <Button size="sm" onClick={() => rescheduleTasks(ids, today)}>
            {t('today.allToToday')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => rescheduleTasks(ids, undefined)}>
            {t('today.allBack')}
          </Button>
        </div>
      )}
    </div>
  )
}

/** The day's blocks from the week plan: which projects (or chores) the day is reserved for, and how much. */
function DayBlocks({ blocks, cap, dayCapacityHours }: { blocks: PlanBlock[]; cap: DayCapacity; dayCapacityHours: number }) {
  const { t } = useTranslation()
  const locale = useLocale()
  const projectMap = useProjectMap()
  const location = useLocation()
  if (blocks.length === 0 && !cap.isWorkDay) return null
  return (
    <div>
      <SectionLabel>{t('today.blocks')}</SectionLabel>
      {blocks.length === 0 ? (
        <p className="px-1 text-[13px] text-ink-3">
          {t('today.noBlocks')}{' '}
          <Link to="/week" className="whitespace-nowrap text-ink-2 hover:text-ink">
            {t('today.planWeek')} →
          </Link>
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {blocks.map((b) => {
            const project = b.projectId ? (projectMap.get(b.projectId) ?? null) : null
            const info = cap.blocks.find((x) => x.id === b.id)
            const minutes = info?.minutes ?? b.size * dayCapacityHours * 60
            const name = project ? project.name : t('week.chores')
            return (
              <li key={b.id} style={projectVars(project?.color ?? null)} className="pc-soft rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 text-[13.5px] text-ink">
                  <ProjectDot color={project?.color ?? null} size={7} />
                  {project ? (
                    <Link to={`/projects/${project.id}`} className="min-w-0 flex-1 truncate hover:underline">
                      {name}
                    </Link>
                  ) : (
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                  )}
                  <span className="tnum shrink-0 text-[12px] text-ink-2">
                    {BLOCK_SIZE_LABEL[b.size]} · {fmtHours(minutes, locale)}
                  </span>
                  {project && (
                    <Link to={`/focus/${project.id}`} state={{ from: location.pathname + location.search }} title={t('focus.startTitle')} aria-label={t('focus.start')} className="pc-text -mr-1 shrink-0 rounded p-0.5 opacity-70 hover:opacity-100">
                      <Target size={14} />
                    </Link>
                  )}
                </div>
                {(b.note || (info && info.meetingMinutes > 0)) && (
                  <div className="mt-0.5 pl-[15px] text-[12px] leading-snug text-ink-3">
                    {[b.note, info && info.meetingMinutes > 0 ? t('week.blockIncludes', { hours: fmtHours(info.meetingMinutes, locale) }) : null].filter(Boolean).join(' · ')}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function EventBlock({ event, top, h, px }: { event: VisibleEvent; top: number; h: number; px: number }) {
  const { t } = useTranslation()
  const locale = useLocale()
  const projectMap = useProjectMap()
  const openEvent = useUi((s) => s.openEvent)
  const project = event.projectId && !event.masked ? projectMap.get(event.projectId) : null
  const canJoin = !event.masked && !!joinUrlOf(event)
  return (
    <div
      style={{ top, height: h - 2, ...projectVars(project?.color ?? null) }}
      className={cx(
        'pointer-events-auto absolute left-0 right-0 overflow-hidden rounded-md border-l-2',
        isBlocking(event) ? 'bg-surface-2' : 'border-dashed bg-transparent opacity-70',
        project ? 'pc-line' : 'border-ink-3',
      )}
    >
      <button type="button" onClick={() => !event.masked && openEvent(event.id)} className={cx('h-full w-full px-2 py-1 text-left', canJoin && 'pr-8 md:pr-[72px]')}>
        <div className="flex items-center gap-1 truncate text-[12.5px] leading-tight text-ink">
          {/* on phones the Join icon already says "online": its room goes to the title */}
          {event.kind === 'online' ? <Video size={11} className={cx('shrink-0 text-ink-3', canJoin && 'hidden md:block')} /> : <MapPin size={11} className="shrink-0 text-ink-3" />}
          <span className={cx('truncate', event.masked && 'italic text-ink-3')}>{event.title}</span>
          {event.private && <Lock size={10} className="ml-1 shrink-0 text-ink-3" />}
          {!isBlocking(event) && <span className="ml-1 shrink-0 text-[10px] uppercase tracking-wide text-ink-3">{t('event.freeTag')}</span>}
        </div>
        {h >= px * 1.5 && (
          <div className="tnum mt-0.5 text-[11px] text-ink-3">
            {fmtTime(event.start, locale)}–{fmtTime(event.end, locale)}
          </div>
        )}
      </button>
      {/* vertically centred like the block's text */}
      <JoinLink event={event} iconOnPhone className="absolute right-1 top-1/2 -translate-y-1/2" />
    </div>
  )
}

function TaskBlock({ task }: { task: Task }) {
  const locale = useLocale()
  const projectMap = useProjectMap()
  const completeTask = useStore((s) => s.completeTask)
  const project = task.projectId ? projectMap.get(task.projectId) : null
  const end = addMinutes(task.plannedStart!, task.estimateMinutes ?? 30)
  return (
    <div
      style={projectVars(project?.color ?? null)}
      className={cx('flex h-full items-start gap-2 overflow-hidden rounded-md border-l-2 px-2 py-1', task.status === 'done' ? 'border-line-2 bg-surface-2/60' : 'pc-line bg-accent-soft/70')}
    >
      <Checkbox checked={task.status === 'done'} onChange={(v) => completeTask(task.id, v)} className="mt-[2px] scale-90" />
      <div className="min-w-0">
        <div className={cx('truncate text-[12.5px] leading-tight', task.status === 'done' && 'strike')}>{task.title}</div>
        {(task.estimateMinutes ?? 30) >= 45 && (
          <div className="tnum mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-3">
            <span className="whitespace-nowrap">
              {fmtTime(task.plannedStart!, locale)}–{fmtTime(end, locale)}
            </span>
            {project && (
              <>
                <ProjectDot color={project.color} size={5} /> <span className="truncate">{project.name}</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function PlanRow({ task, overlay }: { task: Task; overlay?: boolean }) {
  const completeTask = useStore((s) => s.completeTask)
  return (
    <div className={cx('flex items-start gap-3 rounded-lg px-2 py-2', overlay ? 'card w-[320px] shadow-[var(--shadow)]' : 'hover:bg-surface-2')}>
      <Checkbox checked={task.status === 'done'} onChange={(v) => completeTask(task.id, v)} className="mt-[3px]" />
      <div className="min-w-0 flex-1">
        <div className={cx('text-[14px] leading-snug', task.status === 'done' && 'strike')}>{task.title}</div>
        <TaskMeta task={task} className="mt-1" />
      </div>
    </div>
  )
}

function CandidateGroup({ label, items, tone, date }: { label: string; items: Task[]; tone?: 'rose' | 'amber'; date: ISODate }) {
  if (items.length === 0) return null
  return (
    <div>
      <div className={cx('mb-1 text-[12px]', tone === 'rose' ? 'text-rose' : tone === 'amber' ? 'text-amber' : 'text-ink-3')}>{label}</div>
      <ul className="flex flex-col gap-1">
        {items.map((x) => (
          <CandidateRow key={x.id} task={x} date={date} />
        ))}
      </ul>
    </div>
  )
}

function CandidateRow({ task, date }: { task: Task; date: ISODate }) {
  const { t } = useTranslation()
  const projectMap = useProjectMap()
  const openTask = useUi((s) => s.openTask)
  const scheduleTask = useStore((s) => s.scheduleTask)
  const project = task.projectId ? projectMap.get(task.projectId) : null
  return (
    <li className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-2">
      <button type="button" onClick={() => openTask(task.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left text-[13px]">
        <ProjectDot color={project?.color ?? null} size={6} />
        <span className="truncate">{task.title}</span>
        {task.status === 'next' && project && <span className="text-[10px] uppercase tracking-wide text-accent">{t('today.nextAction')}</span>}
      </button>
      <IconButton label={t('today.addToDay')} onClick={() => scheduleTask(task.id, date)} className="reveal opacity-0 group-hover:opacity-100">
        <Plus size={14} />
      </IconButton>
    </li>
  )
}

function NextActionPrompt({ projectId, tasks }: { projectId: string; tasks: Task[] }) {
  const { t } = useTranslation()
  const projectMap = useProjectMap()
  const setTaskStatus = useStore((s) => s.setTaskStatus)
  const addTask = useStore((s) => s.addTask)
  const [value, setValue] = useState('')
  const project = projectMap.get(projectId)
  if (!project) return null
  const candidates = tasks.filter((x) => x.projectId === projectId && isOpen(x) && x.status !== 'someday').sort(sortTasks)
  return (
    <li className="rounded-xl border border-dashed border-amber/50 px-3 py-2" style={projectVars(project.color)}>
      <div className="flex items-center gap-2 text-[13px]">
        <ProjectDot color={project.color} />
        <span className="truncate font-medium">{project.name}</span>
      </div>
      <ul className="mt-1 flex flex-col">
        {candidates.slice(0, 3).map((x) => (
          <li key={x.id} className="flex items-center justify-between gap-2 py-0.5 text-[12.5px] text-ink-2">
            <span className="truncate">{x.title}</span>
            <button type="button" onClick={() => setTaskStatus(x.id, 'next')} className="shrink-0 text-[12px] text-accent hover:underline">
              {t('today.pick')}
            </button>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (value.trim()) addTask({ title: value, projectId, status: 'next' })
          setValue('')
        }}
      >
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={t('today.addNext')} className="mt-1 w-full bg-transparent py-1 text-[12.5px] placeholder:text-ink-3 focus:outline-none" />
      </form>
    </li>
  )
}
