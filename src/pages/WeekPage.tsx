import { useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { DndContext, DragOverlay, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { ChevronLeft, ChevronRight, Lock, MapPin, Plus, Video, X } from 'lucide-react'
import type { ISODate, PlanBlock, Project } from '@/domain/types'
import type { VisibleEvent } from '@/store/visible'
import { BLOCK_SIZES, BLOCK_SIZE_LABEL } from '@/domain/types'
import { addDaysISO, fmtDate, fmtHours, fmtTime, fmtWeekday, isoWeekNumber, rangeISO, startOfWeekISO, todayISO } from '@/domain/dates'
import { blocksOn, dayCapacity, eventsOn, isBlocking, tasksDueOn } from '@/domain/selectors'
import { useStore } from '@/store/useStore'
import { useVisibleBlocks, useVisibleEvents, useVisibleProjects, useVisibleTasks } from '@/store/visible'
import { useUi } from '@/store/useUi'
import { Draggable, Droppable, collision, useDndSensors } from '@/components/dnd'
import { Button, IconButton, PageHeader, cx, useIsPhone } from '@/components/ui'
import { ProjectDot, projectVars, useLocale, useProjectMap } from '@/components/TaskBits'

const CHORES = 'chores'

export default function WeekPage() {
  const { t } = useTranslation()
  const locale = useLocale()
  const [offset, setOffset] = useState(0)
  const [active, setActive] = useState<{ type: 'proj' | 'block'; id: string } | null>(null)
  const today = todayISO()
  const start = addDaysISO(startOfWeekISO(today), offset * 7)
  const weeks = [rangeISO(start, 7), rangeISO(addDaysISO(start, 7), 7)]

  const projects = useVisibleProjects()
  const blocks = useVisibleBlocks()
  const addBlock = useStore((s) => s.addBlock)
  const updateBlock = useStore((s) => s.updateBlock)
  const projectMap = useProjectMap()
  const sensors = useDndSensors()
  const activeProjects = projects.filter((p) => p.status === 'active')
  const isPhone = useIsPhone()

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id)
    setActive(id.startsWith('proj:') ? { type: 'proj', id: id.slice(5) } : { type: 'block', id: id.slice(6) })
  }
  const onDragEnd = (e: DragEndEvent) => {
    setActive(null)
    const over = e.over?.id ? String(e.over.id) : null
    if (!over?.startsWith('day:')) return
    const date = over.slice(4)
    const id = String(e.active.id)
    if (id.startsWith('proj:')) {
      const pid = id.slice(5)
      addBlock(date, pid === CHORES ? null : pid, 0.5)
    } else if (id.startsWith('block:')) {
      updateBlock(id.slice(6), { date })
    }
  }

  const weekTitle = (days: ISODate[]) =>
    `${t('week.weekLabel', { week: isoWeekNumber(days[0]) })} · ${fmtDate(days[0], locale)} – ${fmtDate(days[6], locale, { day: 'numeric', month: 'short' })}`

  return (
    <div>
      <PageHeader
        title={t('week.title')}
        subtitle={isPhone ? t('week.subtitlePhone') : t('week.subtitle')}
        right={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOffset(0)} disabled={offset === 0}>
              {t('week.thisWeek')}
            </Button>
            <IconButton label="‹" onClick={() => setOffset((o) => o - 1)}>
              <ChevronLeft size={16} />
            </IconButton>
            <IconButton label="›" onClick={() => setOffset((o) => o + 1)}>
              <ChevronRight size={16} />
            </IconButton>
          </>
        }
      />

      <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        {/* Drag palette: desktop only – on phones each day has a "Block" picker instead. */}
        <div className="mb-6 hidden flex-wrap items-center gap-2 md:flex">
          <span className="mr-2 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-3">{t('week.palette')}</span>
          {activeProjects.map((p) => (
            <Draggable key={p.id} id={`proj:${p.id}`}>
              <PaletteChip project={p} />
            </Draggable>
          ))}
          <Draggable id={`proj:${CHORES}`}>
            <PaletteChip project={null} />
          </Draggable>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          {weeks.map((days) => (
            <section key={days[0]}>
              <h2 className="mb-3 text-[13px] font-medium text-ink-2">{weekTitle(days)}</h2>
              <div className="card divide-y divide-line overflow-hidden">
                {days.map((date) => (
                  <DayRow key={date} date={date} today={today} />
                ))}
              </div>
            </section>
          ))}
        </div>
        <p className="mt-4 text-[12px] text-ink-3">
          {t('week.capacityLegend')} · {t('week.clickToResize')}
        </p>

        <DragOverlay dropAnimation={null}>
          {active?.type === 'proj' ? (
            <PaletteChip project={active.id === CHORES ? null : (projectMap.get(active.id) ?? null)} />
          ) : active?.type === 'block' ? (
            (() => {
              const b = blocks.find((x) => x.id === active.id)
              return b ? <BlockChip block={b} project={b.projectId ? (projectMap.get(b.projectId) ?? null) : null} /> : null
            })()
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}

function PaletteChip({ project }: { project: Project | null }) {
  const { t } = useTranslation()
  return (
    <span style={projectVars(project?.color ?? null)} className="pc-soft inline-flex h-7 select-none items-center gap-1.5 rounded-full px-3 text-[12.5px] text-ink">
      <ProjectDot color={project?.color ?? null} size={7} />
      {project ? project.name : t('week.chores')}
    </span>
  )
}

function BlockChip({
  block,
  project,
  onCycle,
  onRemove,
  absorbed,
}: {
  block: PlanBlock
  project: Project | null
  onCycle?: () => void
  onRemove?: () => void
  absorbed?: { minutes: number; meetingMinutes: number }
}) {
  const { t } = useTranslation()
  const locale = useLocale()
  const dayCapacityHours = useStore((s) => s.settings.dayCapacityHours)
  const own = block.size * dayCapacityHours * 60
  const exceeds = absorbed && absorbed.minutes > own
  return (
    <span
      style={projectVars(project?.color ?? null)}
      title={absorbed && absorbed.meetingMinutes > 0 ? t('week.blockIncludes', { hours: fmtHours(absorbed.meetingMinutes, locale) }) : undefined}
      className="pc-soft group/blk inline-flex h-6 max-w-full select-none items-center gap-1.5 rounded-full pl-2.5 pr-1 text-[12px] text-ink"
    >
      <ProjectDot color={project?.color ?? null} size={6} />
      <span className="truncate">{project ? project.name : t('week.chores')}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onCycle?.()
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="tnum rounded-full px-1.5 font-medium hover:bg-surface"
        title={t('week.clickToResize')}
      >
        {BLOCK_SIZE_LABEL[block.size]}
        {exceeds && <span className="tnum ml-1 text-ink-2">· {fmtHours(absorbed.minutes, locale)}</span>}
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="reveal rounded-full p-0.5 text-ink-3 opacity-0 hover:text-ink group-hover/blk:opacity-100"
          aria-label={t('common.remove')}
        >
          <X size={11} />
        </button>
      )}
    </span>
  )
}

function DayRow({ date, today }: { date: ISODate; today: ISODate }) {
  const { t } = useTranslation()
  const locale = useLocale()
  const projects = useVisibleProjects()
  const tasks = useVisibleTasks()
  const events = useVisibleEvents()
  const blocks = useVisibleBlocks()
  const settings = useStore((s) => s.settings)
  const updateBlock = useStore((s) => s.updateBlock)
  const removeBlock = useStore((s) => s.removeBlock)
  const addBlock = useStore((s) => s.addBlock)
  const openEvent = useUi((s) => s.openEvent)
  const projectMap = useProjectMap()
  const activeProjects = projects.filter((p) => p.status === 'active')

  const cap = dayCapacity(date, settings, events, blocks, tasks)
  const dayEvents = eventsOn(events, date)
  const dayBlocks = blocksOn(blocks, date)
  const due = tasksDueOn(tasks, date).filter((x) => x.status !== 'done')
  const dueProjects = projects.filter((p) => p.dueDate === date && (p.status === 'active' || p.status === 'planned'))
  const isToday = date === today
  const past = date < today
  const compact = !cap.isWorkDay && dayEvents.length === 0 && dayBlocks.length === 0
  const total = Math.max(cap.workMinutes, cap.uncoveredMeetingMinutes + cap.blockMinutes, 1)
  const over = cap.uncoveredMeetingMinutes + cap.blockMinutes > cap.workMinutes && cap.isWorkDay
  const capOf = (id: string) => cap.blocks.find((b) => b.id === id)
  const cycleSize = (b: PlanBlock) => {
    const i = BLOCK_SIZES.indexOf(b.size)
    updateBlock(b.id, { size: BLOCK_SIZES[(i + 1) % BLOCK_SIZES.length] })
  }

  return (
    <Droppable id={`day:${date}`} className={cx('group flex gap-4 px-4 transition-colors', compact ? 'py-1.5' : 'py-3', past && 'opacity-60', isToday && 'bg-accent-soft/30')} overClassName="bg-accent-soft/70">
      <Link to={`/today?date=${date}`} className="w-14 shrink-0 pt-0.5 hover:text-accent">
        <div className={cx('text-[11px] uppercase tracking-wide', isToday ? 'text-accent' : 'text-ink-3')}>{fmtWeekday(date, locale)}</div>
        <div className={cx('tnum text-[18px] leading-tight', isToday ? 'font-medium text-accent' : 'text-ink')}>{Number(date.slice(8, 10))}</div>
      </Link>
      <div className="min-w-0 flex-1">
        {!compact && (
          <div className="flex items-center gap-3">
            <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
              {cap.uncoveredMeetingMinutes > 0 && <div className="h-full bg-ink-3" style={{ width: `${(cap.uncoveredMeetingMinutes / total) * 100}%` }} />}
              {cap.blocks.map((b) => (
                <div key={b.id} className="flex h-full" style={{ ...projectVars(b.projectId ? projectMap.get(b.projectId)?.color : null), width: `${(b.minutes / total) * 100}%` }}>
                  {b.meetingMinutes > 0 && <div className="pc-dark h-full" style={{ width: `${(b.meetingMinutes / b.minutes) * 100}%` }} />}
                  <div className="pc-dot h-full flex-1" />
                </div>
              ))}
            </div>
            <span className={cx('tnum shrink-0 text-[11px]', over ? 'text-amber' : 'text-ink-3')}>
              {!cap.isWorkDay ? t('week.offDay') : over ? t('week.overplanned') : cap.fullDay ? t('week.fullDay') : t('week.free', { hours: fmtHours(cap.freeMinutes, locale) })}
            </span>
            {/* Non-drag way to add a block: works on phones and with the keyboard. */}
            <label className="reveal relative text-ink-3 opacity-0 transition-opacity hover:text-ink focus-within:opacity-100 group-hover:opacity-100" title={t('week.addBlock')}>
              <span className="sr-only">{t('week.addBlock')}</span>
              <span aria-hidden className="flex h-5 items-center rounded-full border border-line px-1.5 text-[10px] uppercase tracking-wide">{t('week.block')}</span>
              <select
                className="absolute inset-0 cursor-pointer opacity-0"
                value=""
                onChange={(e) => {
                  if (e.target.value) addBlock(date, e.target.value === CHORES ? null : e.target.value, 0.5)
                }}
              >
                <option value="">{t('week.addBlock')}</option>
                {activeProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                <option value={CHORES}>{t('week.chores')}</option>
              </select>
            </label>
            <button type="button" onClick={() => openEvent(null, { date })} className="reveal text-ink-3 opacity-0 transition-opacity hover:text-ink group-hover:opacity-100" aria-label={t('week.addMeeting')}>
              <Plus size={14} />
            </button>
          </div>
        )}
        {dayEvents.length > 0 && (
          <ul className="mt-2 flex flex-col gap-0.5">
            {dayEvents.map((e) => (
              <EventLine key={e.id} event={e} />
            ))}
          </ul>
        )}
        {(due.length > 0 || dueProjects.length > 0) && (
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {dueProjects.map((p) => (
              <li key={p.id} className="truncate text-[12px] text-rose">
                ● {t('week.due')}: {p.name}
              </li>
            ))}
            {due.map((x) => (
              <li key={x.id} className="truncate text-[12px] text-amber">
                ● {t('week.due')}: {x.title}
              </li>
            ))}
          </ul>
        )}
        {!compact && (
          <div className="mt-2 flex min-h-[26px] flex-wrap gap-1.5">
            {dayBlocks.map((b) => (
              <Draggable key={b.id} id={`block:${b.id}`} className="max-w-full">
                <BlockChip block={b} project={b.projectId ? (projectMap.get(b.projectId) ?? null) : null} onCycle={() => cycleSize(b)} onRemove={() => removeBlock(b.id)} absorbed={capOf(b.id)} />
              </Draggable>
            ))}
          </div>
        )}
      </div>
    </Droppable>
  )
}

function EventLine({ event }: { event: VisibleEvent }) {
  const { t } = useTranslation()
  const locale = useLocale()
  const projectMap = useProjectMap()
  const openEvent = useUi((s) => s.openEvent)
  const project = event.projectId && !event.masked ? projectMap.get(event.projectId) : null
  return (
    <li>
      <button
        type="button"
        onClick={() => !event.masked && openEvent(event.id)}
        className={cx('flex w-full items-center gap-2 text-left text-[12.5px] text-ink-2', event.masked ? 'cursor-default' : 'hover:text-ink', !isBlocking(event) && 'opacity-60')}
      >
        <span className="tnum w-[88px] shrink-0 text-ink-3">{event.allDay ? t('today.allDay') : `${fmtTime(event.start, locale)}–${fmtTime(event.end, locale)}`}</span>
        {event.kind === 'online' ? <Video size={12} className="shrink-0 text-ink-3" /> : <MapPin size={12} className="shrink-0 text-ink-3" />}
        <span className={cx('truncate', event.masked && 'italic text-ink-3')}>{event.title}</span>
        {event.private && <Lock size={11} className="shrink-0 text-ink-3" />}
        {!isBlocking(event) && <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink-3">{t('event.freeTag')}</span>}
        {project && <ProjectDot color={project.color} size={6} />}
      </button>
    </li>
  )
}
