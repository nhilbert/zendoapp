import { type RefObject, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
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
import type { ProjectColor, Task, TaskStatus } from '@/domain/types'
import { TASK_STATUSES } from '@/domain/types'
import { sortTasks } from '@/domain/selectors'
import { useStore } from '@/store/useStore'
import { useVisibleProjects, useVisibleTasks } from '@/store/visible'
import { useUi } from '@/store/useUi'
import { Draggable, Droppable, useDndSensors } from '@/components/dnd'
import { IconButton, PageHeader, Segmented, cx, isTyping, useIsPhone, useLocalState } from '@/components/ui'
import { ProjectDot, TaskMeta, projectVars, useProjectMap } from '@/components/TaskBits'

const CHORES = '__chores__'
/** color null = chores (neutral dot); no color = "all projects" (no dot). */
type ScopeItem = { id: string; name: string; color?: ProjectColor | null }
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
  const scopeItems: ScopeItem[] = [
    { id: CHORES, name: t('board.chores'), color: null },
    ...projects.filter((p) => p.status === 'active' || p.status === 'planned').map((p) => ({ id: p.id, name: p.name, color: p.color })),
  ]
  const scopes = scopeItems.map((i) => i.id)
  const pickItems: ScopeItem[] = [...scopeItems, { id: '', name: t('board.all') }]
  // Per device: the board opens where it was left (first time: chores), and on phones as a list.
  const [stored, setFilter] = useLocalState('zendo.board.scope', CHORES)
  const filter = stored === '' || scopes.includes(stored) ? stored : CHORES
  const step = (delta: 1 | -1) => {
    const i = scopes.indexOf(filter)
    setFilter(scopes[i < 0 ? (delta > 0 ? 0 : scopes.length - 1) : (i + delta + scopes.length) % scopes.length])
  }
  const [storedView, setView] = useLocalState('zendo.board.view', 'list')
  const view = storedView === 'board' ? 'board' : 'list'
  const asList = isPhone && view === 'list'
  // In the phone list, "someday" and "done" start folded so the day's work stays on top.
  const [unfolded, setUnfolded] = useState<TaskStatus[]>([])
  const [picking, setPicking] = useState(false)
  const pickerButton = useRef<HTMLButtonElement>(null)
  const pickerId = useId()
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
  const scope = pickItems.find((i) => i.id === filter)

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
            {/* the name opens a short list with the project colours to jump directly */}
            <div className="relative min-w-0">
              <button
                ref={pickerButton}
                type="button"
                onClick={() => setPicking((v) => !v)}
                // while the list is open, a click here only toggles it; focus stays in the list
                onMouseDown={(e) => picking && e.preventDefault()}
                aria-haspopup="listbox"
                aria-expanded={picking}
                aria-controls={picking ? pickerId : undefined}
                title={t('board.pick')}
                className="flex min-w-0 max-w-[62vw] items-center gap-2 rounded-lg px-2 py-1 hover:bg-surface-2 md:max-w-[340px]"
              >
                {scope?.color !== undefined && <ProjectDot color={scope.color} />}
                <span className="truncate text-[15px] font-medium">{scope?.name}</span>
              </button>
              {picking && (
                <ScopeMenu id={pickerId} items={pickItems} value={filter} label={t('board.pick')} anchor={pickerButton} onPick={setFilter} onClose={() => setPicking(false)} />
              )}
            </div>
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

/**
 * The list behind the project name: like a native picker (arrows, Home/End, typing a name's first letters,
 * Enter or Space, Escape, Tab or click away), but with the project colours, which a native select cannot show.
 */
function ScopeMenu({
  id,
  items,
  value,
  label,
  anchor,
  onPick,
  onClose,
}: {
  id: string
  items: ScopeItem[]
  value: string
  label: string
  anchor: RefObject<HTMLButtonElement | null>
  onPick: (id: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLUListElement>(null)
  // The highlight follows an id, not a row number, so it survives the list changing underneath.
  const [activeId, setActiveId] = useState(value)
  const active = Math.max(0, items.findIndex((i) => i.id === activeId))
  const move = (i: number) => setActiveId(items[Math.max(0, Math.min(items.length - 1, i))].id)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  // Escape and picking hand the focus back to the name; Tab and clicks leave it where the user put it.
  const close = (refocus: boolean) => {
    closeRef.current()
    if (refocus) anchor.current?.focus()
  }
  const typed = useRef({ text: '', at: 0 })
  // Space picks on release, so the release does not land on the name button and open the list again.
  const spaceDown = useRef(false)
  const [left, setLeft] = useState(0)

  useEffect(() => ref.current?.focus(), [])
  useEffect(() => {
    ref.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])
  useEffect(() => {
    // the toggle button sits next to the list, so it counts as inside
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.parentElement?.contains(e.target as Node)) closeRef.current()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [])
  // Start under the name, shifted left as far as needed to stay on screen.
  useLayoutEffect(() => {
    const place = () => {
      const list = ref.current
      const box = list?.parentElement?.getBoundingClientRect()
      if (!list || !box) return
      const gutter = 16
      const x = Math.max(gutter, Math.min(box.left, document.documentElement.clientWidth - list.offsetWidth - gutter))
      setLeft(x - box.left)
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [])

  const typing = () => Date.now() - typed.current.at < 700
  const typeAhead = (key: string) => {
    const text = (typing() ? typed.current.text : '') + key.toLowerCase()
    typed.current = { text, at: Date.now() }
    // a repeated single letter steps through the names starting with it, as in a native select
    const repeat = text.length > 1 && [...text].every((c) => c === text[0])
    const prefix = repeat ? text[0] : text
    const from = repeat || text.length === 1 ? active + 1 : active
    const order = items.map((_, k) => (from + k) % items.length)
    const hit = order.find((k) => items[k].name.toLowerCase().startsWith(prefix))
    if (hit !== undefined) move(hit)
  }

  return (
    <ul
      ref={ref}
      id={id}
      role="listbox"
      aria-label={label}
      aria-activedescendant={`${id}-${active}`}
      tabIndex={-1}
      onBlur={(e) => {
        // a click elsewhere is the pointerdown listener's; here only focus moving on (Tab, Shift+Tab)
        if (e.relatedTarget) close(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Tab' || e.metaKey || e.ctrlKey || e.altKey) return
        if (e.key === 'ArrowDown') move(active + 1)
        else if (e.key === 'ArrowUp') move(active - 1)
        else if (e.key === 'Home' || e.key === 'PageUp') move(0)
        else if (e.key === 'End' || e.key === 'PageDown') move(items.length - 1)
        else if (e.key === 'Enter') {
          onPick(items[active].id)
          close(true)
        } else if (e.key === ' ' && !typing()) spaceDown.current = true
        else if (e.key === 'Escape') close(true)
        else if (e.key.length === 1) typeAhead(e.key)
        else return
        e.preventDefault()
        e.stopPropagation()
      }}
      onKeyUp={(e) => {
        if (e.key !== ' ' || !spaceDown.current) return
        spaceDown.current = false
        onPick(items[active].id)
        close(true)
      }}
      style={{ left }}
      className="card fade-in absolute top-full z-30 mt-1 max-h-[60vh] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto p-1 shadow-[var(--shadow)] outline-none md:w-96"
    >
      {items.map((item, i) => (
        <li
          key={item.id || 'all'}
          id={`${id}-${i}`}
          role="option"
          aria-selected={item.id === value}
          onPointerEnter={() => setActiveId(item.id)}
          onClick={() => {
            onPick(item.id)
            close(true)
          }}
          className={cx('flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[14px]', i === active && 'bg-surface-2', item.id === value ? 'font-medium text-ink' : 'text-ink-2')}
        >
          {item.color !== undefined ? <ProjectDot color={item.color} /> : <span className="w-2 shrink-0" />}
          <span className="truncate">{item.name}</span>
        </li>
      ))}
    </ul>
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
