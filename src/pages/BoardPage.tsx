import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type CollisionDetection,
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  pointerWithin,
  rectIntersection,
  useDroppable,
} from '@dnd-kit/core'
import { ArrowDownNarrowWide, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import type { Task, TaskStatus } from '@/domain/types'
import { TASK_STATUSES } from '@/domain/types'
import { sortTasks } from '@/domain/selectors'
import { useStore } from '@/store/useStore'
import { useVisibleProjects, useVisibleTasks } from '@/store/visible'
import { useUi } from '@/store/useUi'
import { Draggable, Droppable, useDndSensors } from '@/components/dnd'
import { IconButton, PageHeader, Segmented, cx, isTyping, useIsPhone } from '@/components/ui'
import { ProjectDot, TaskMeta, projectVars, useProjectMap } from '@/components/TaskBits'

const CHORES = '__chores__'
/** Per device: the board opens where it was left (first time: chores), and on phones as a list. */
const SCOPE_KEY = 'zendo.board.scope'
const VIEW_KEY = 'zendo.board.view'
const readLocal = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const writeLocal = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // private window or blocked storage: the choice just isn't remembered
  }
}
type Indicator = { cardId: string; position: 'before' | 'after' } | null

/** Prefer the card under the pointer (for positional drops), then the column, then any overlap. */
const boardCollision: CollisionDetection = (args) => {
  const self = `card:${String(args.active.id).replace('task:', '')}`
  const within = pointerWithin(args)
  const card = within.find((c) => String(c.id).startsWith('card:') && String(c.id) !== self)
  if (card) return [card]
  const col = within.find((c) => String(c.id).startsWith('col:'))
  if (col) return [col]
  return rectIntersection(args).filter((c) => String(c.id) !== self)
}

export default function BoardPage() {
  const { t } = useTranslation()
  const tasks = useVisibleTasks()
  const projects = useVisibleProjects()
  const reorderTask = useStore((s) => s.reorderTask)
  const sortColumnByUrgency = useStore((s) => s.sortColumnByUrgency)
  const addTask = useStore((s) => s.addTask)
  const openTask = useUi((s) => s.openTask)
  const sensors = useDndSensors()
  const isPhone = useIsPhone()
  // One project at a time: chores, then the active and planned projects; "all" only through the picker.
  const scopes = [CHORES, ...projects.filter((p) => p.status === 'active' || p.status === 'planned').map((p) => p.id)]
  const [stored, setStored] = useState(() => readLocal(SCOPE_KEY) ?? CHORES)
  const filter = stored === '' || scopes.includes(stored) ? stored : CHORES
  const setFilter = (value: string) => {
    setStored(value)
    writeLocal(SCOPE_KEY, value)
  }
  const step = (delta: 1 | -1) => {
    const i = scopes.indexOf(filter)
    setFilter(scopes[i < 0 ? (delta > 0 ? 0 : scopes.length - 1) : (i + delta + scopes.length) % scopes.length])
  }
  const [view, setViewState] = useState<'list' | 'board'>(() => (readLocal(VIEW_KEY) === 'board' ? 'board' : 'list'))
  const setView = (v: 'list' | 'board') => {
    setViewState(v)
    writeLocal(VIEW_KEY, v)
  }
  const asList = isPhone && view === 'list'
  // In the phone list, "someday" and "done" start folded so the day's work stays on top.
  const [unfolded, setUnfolded] = useState<TaskStatus[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [indicator, setIndicator] = useState<Indicator>(null)
  const indicatorRef = useRef<Indicator>(null)

  const weekAgo = Date.now() - 7 * 86_400_000
  const visible = tasks
    .filter((x) => (filter === '' ? true : filter === CHORES ? x.projectId === null : x.projectId === filter))
    .filter((x) => x.status !== 'done' || (x.completedAt && new Date(x.completedAt).getTime() > weekAgo))
    .sort(sortTasks)
  const column = (status: TaskStatus) => {
    const col = visible.filter((x) => x.status === status)
    return status === 'done' ? col.sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')) : col
  }

  const setInd = (next: Indicator) => {
    indicatorRef.current = next
    setIndicator(next)
  }

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id).replace('task:', ''))
  const onDragMove = (e: DragMoveEvent) => {
    const over = e.over
    const rect = e.active.rect.current.translated
    if (!over || !rect || !String(over.id).startsWith('card:')) {
      if (indicatorRef.current) setInd(null)
      return
    }
    const position: 'before' | 'after' = rect.top + rect.height / 2 < over.rect.top + over.rect.height / 2 ? 'before' : 'after'
    const cardId = String(over.id).slice(5)
    if (indicatorRef.current?.cardId !== cardId || indicatorRef.current.position !== position) setInd({ cardId, position })
  }
  const onDragEnd = (e: DragEndEvent) => {
    const id = String(e.active.id).replace('task:', '')
    const over = e.over ? String(e.over.id) : null
    const ind = indicatorRef.current
    setActiveId(null)
    setInd(null)
    if (!over) return
    // The insertion line is the contract: drop exactly where it was shown.
    if (ind && ind.cardId !== id) {
      const target = tasks.find((x) => x.id === ind.cardId)
      if (!target) return
      if (target.status === 'done') {
        reorderTask(id, 'done', null)
        return
      }
      const col = column(target.status).filter((x) => x.id !== id)
      const idx = col.findIndex((x) => x.id === ind.cardId)
      const beforeId = ind.position === 'after' ? (col[idx + 1]?.id ?? null) : ind.cardId
      reorderTask(id, target.status, beforeId)
      return
    }
    const status = over.startsWith('col:') ? (over.slice(4) as TaskStatus) : over.startsWith('card:') ? tasks.find((x) => x.id === over.slice(5))?.status : undefined
    if (status) reorderTask(id, status, null)
  }

  const activeTask = activeId ? tasks.find((x) => x.id === activeId) : undefined
  const scopeProject = projects.find((p) => p.id === filter)
  const scopeName = filter === '' ? t('board.all') : filter === CHORES ? t('board.chores') : (scopeProject?.name ?? '')

  // [ and ] step through the projects.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return
      if (e.key === '[') step(-1)
      else if (e.key === ']') step(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div>
      <PageHeader
        title={t('board.title')}
        subtitle={t('board.subtitle')}
        right={
          <div className="flex min-w-0 items-center gap-1">
            <IconButton label={t('board.prev')} onClick={() => step(-1)}>
              <ChevronLeft size={16} />
            </IconButton>
            {/* the name opens the native picker to jump directly (works with touch and keyboard) */}
            <label className="relative flex min-w-0 max-w-[62vw] cursor-pointer items-center gap-2 rounded-lg px-2 py-1 hover:bg-surface-2 md:max-w-[340px]" title={t('board.pick')}>
              {scopeProject && <ProjectDot color={scopeProject.color} />}
              <span className="truncate text-[15px] font-medium">{scopeName}</span>
              <select className="absolute inset-0 cursor-pointer opacity-0" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={t('board.pick')}>
                <option value={CHORES}>{t('board.chores')}</option>
                {scopes.slice(1).map((id) => (
                  <option key={id} value={id}>
                    {projects.find((p) => p.id === id)?.name}
                  </option>
                ))}
                <option value="">{t('board.all')}</option>
              </select>
            </label>
            <IconButton label={t('board.next')} onClick={() => step(1)}>
              <ChevronRight size={16} />
            </IconButton>
          </div>
        }
      />
      {isPhone && (
        <div className="mb-4">
          <Segmented<'list' | 'board'>
            value={view}
            onChange={setView}
            options={[
              { value: 'list', label: t('board.viewList') },
              { value: 'board', label: t('board.viewBoard') },
            ]}
          />
        </div>
      )}
      <DndContext sensors={sensors} collisionDetection={boardCollision} onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd} onDragCancel={() => setInd(null)}>
        <div
          className={
            asList
              ? 'flex flex-col gap-3'
              : '-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-5 md:gap-4 md:overflow-visible md:px-0 md:pb-0'
          }
        >
          {TASK_STATUSES.map((status) => {
            const col = column(status)
            const folded = asList && (status === 'someday' || status === 'done') && !unfolded.includes(status)
            const label = <span className={cx('text-[12px] font-medium uppercase tracking-[0.1em]', status === 'next' ? 'text-accent' : 'text-ink-3')}>{t(`status.${status}`)}</span>
            return (
              <Droppable
                key={status}
                id={`col:${status}`}
                className={cx(
                  'group/col flex flex-col rounded-2xl bg-surface-2/60 p-2 transition-colors',
                  !asList && 'min-h-[60vh] w-[82vw] max-w-[340px] shrink-0 snap-start md:w-auto md:max-w-none',
                )}
                overClassName={indicator ? '' : 'bg-accent-soft/70'}
              >
                <div className={cx('flex items-center justify-between px-2 pt-1', !folded && 'mb-2')}>
                  {asList && (status === 'someday' || status === 'done') ? (
                    <button
                      type="button"
                      onClick={() => setUnfolded((u) => (u.includes(status) ? u.filter((x) => x !== status) : [...u, status]))}
                      aria-expanded={!folded}
                      className="-my-1 flex items-center gap-1 py-1"
                    >
                      {label}
                      <span className="text-[11px] text-ink-3">{folded ? '▸' : '▾'}</span>
                    </button>
                  ) : (
                    label
                  )}
                  <span className="flex items-center gap-1">
                    {status !== 'done' && col.length > 1 && (
                      <IconButton label={t('board.sortUrgency')} onClick={() => sortColumnByUrgency(status)} className="reveal h-6 w-6 opacity-0 transition-opacity group-hover/col:opacity-100">
                        <ArrowDownNarrowWide size={13} />
                      </IconButton>
                    )}
                    <span className="tnum text-[11px] text-ink-3">{status === 'done' && !folded ? t('board.doneHint') : col.length || ''}</span>
                  </span>
                </div>
                {!folded && (
                  <>
                    <div className="flex flex-col gap-2">
                      {col.map((task) => (
                        <CardSlot key={task.id} task={task} indicator={indicator?.cardId === task.id ? indicator.position : null}>
                          <Draggable id={`task:${task.id}`} onClick={() => openTask(task.id)}>
                            <Card task={task} hideProject={filter !== ''} />
                          </Draggable>
                        </CardSlot>
                      ))}
                    </div>
                    {status !== 'done' && <QuickAdd onAdd={(title) => addTask({ title, status, projectId: filter && filter !== CHORES ? filter : null })} />}
                  </>
                )}
              </Droppable>
            )
          })}
        </div>
        <DragOverlay dropAnimation={null}>{activeTask ? <Card task={activeTask} hideProject={filter !== ''} dragging /> : null}</DragOverlay>
      </DndContext>
    </div>
  )
}

/** hideProject: with one project (or chores) chosen, every card would repeat its name. */
function Card({ task, dragging, hideProject }: { task: Task; dragging?: boolean; hideProject?: boolean }) {
  const projectMap = useProjectMap()
  const project = task.projectId ? projectMap.get(task.projectId) : null
  return (
    <div
      style={projectVars(project?.color ?? null)}
      className={cx('card px-3 py-2.5 transition-shadow', dragging ? 'rotate-[0.5deg] shadow-[var(--shadow)]' : 'hover:shadow-[var(--shadow)]')}
    >
      {task.priority === 'high' && task.status !== 'done' && <span className="mb-1 block h-1 w-6 rounded-full bg-amber" />}
      <div className={cx('text-[13.5px] leading-snug', task.status === 'done' && 'strike')}>{task.title}</div>
      <TaskMeta task={task} hideProject={hideProject} className="mt-1.5" />
    </div>
  )
}

/** A card's drop target: shows a thin line above or below while another card hovers over it. */
function CardSlot({ task, indicator, children }: { task: Task; indicator: 'before' | 'after' | null; children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({ id: `card:${task.id}`, data: { status: task.status } })
  return (
    <div ref={setNodeRef} className="relative">
      {indicator === 'before' && <span className="pointer-events-none absolute -top-[5px] left-1 right-1 h-[2px] rounded-full bg-accent" />}
      {children}
      {indicator === 'after' && <span className="pointer-events-none absolute -bottom-[5px] left-1 right-1 h-[2px] rounded-full bg-accent" />}
    </div>
  )
}

function QuickAdd({ onAdd }: { onAdd: (title: string) => void }) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  return (
    <form
      className="mt-2 flex items-center gap-1.5 px-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (value.trim()) onAdd(value)
        setValue('')
      }}
    >
      <Plus size={13} className="shrink-0 text-ink-3" />
      <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={t('common.add')} className="w-full bg-transparent py-1 text-[13px] placeholder:text-ink-3 focus:outline-none" />
    </form>
  )
}
