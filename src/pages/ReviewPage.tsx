import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Task } from '@/domain/types'
import { addDaysISO, daysBetween, fmtDate, fmtHours, fmtTime, fmtWeekday, isoWeekNumber, rangeISO, startOfWeekISO, toISODate, todayISO } from '@/domain/dates'
import { blocksOn, eventsOn, isOpen, overdueTasks, plannedVsActual, projectsWithoutNextAction, sortTasks, tasksPlannedOn } from '@/domain/selectors'
import { useStore } from '@/store/useStore'
import { useVisibleBlocks, useVisibleEvents, useVisibleProjects, useVisibleTasks } from '@/store/visible'
import { useUi } from '@/store/useUi'
import { Button, Checkbox, IconButton, PageHeader, SectionLabel, Segmented, Textarea, cx } from '@/components/ui'
import { ProjectChip, ProjectDot, TaskMeta, projectVars, useLocale, useProjectMap, useRelDay } from '@/components/TaskBits'

type Mode = 'daily' | 'weekly'

export default function ReviewPage() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const mode = (params.get('mode') as Mode) || 'daily'
  const today = todayISO()
  const date = params.get('date') ?? today
  const set = (next: { mode?: Mode; date?: string }) => setParams({ mode: next.mode ?? mode, date: next.date ?? date })

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={t('review.title')}
        right={
          <Segmented<Mode>
            value={mode}
            onChange={(m) => set({ mode: m, date: m === 'weekly' ? startOfWeekISO(date) : date })}
            options={[
              { value: 'daily', label: t('review.daily') },
              { value: 'weekly', label: t('review.weekly') },
            ]}
          />
        }
      />
      {mode === 'daily' ? <Daily date={date} setDate={(d) => set({ date: d })} /> : <Weekly monday={startOfWeekISO(date)} setMonday={(d) => set({ date: d })} />}
    </div>
  )
}

function Nav({ label, onPrev, onNext, onToday }: { label: string; onPrev: () => void; onNext: () => void; onToday?: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="mb-6 flex items-center justify-between">
      <h2 className="text-[18px] font-medium tracking-[-0.01em]">{label}</h2>
      <div className="flex items-center gap-1">
        {onToday && (
          <Button variant="ghost" size="sm" onClick={onToday}>
            {t('common.today')}
          </Button>
        )}
        <IconButton label="‹" onClick={onPrev}>
          <ChevronLeft size={16} />
        </IconButton>
        <IconButton label="›" onClick={onNext}>
          <ChevronRight size={16} />
        </IconButton>
      </div>
    </div>
  )
}

function Journal({ kind, date }: { kind: Mode; date: string }) {
  const { t } = useTranslation()
  const review = useStore((s) => s.reviews.find((r) => r.kind === kind && r.date === date))
  const saveReview = useStore((s) => s.saveReview)
  const [value, setValue] = useState(review?.notes ?? '')
  const latest = useRef(value)
  const typing = useRef(false)
  const edit = (v: string) => {
    latest.current = v
    setValue(v)
  }
  // only persist real changes – visiting a day must not create an empty review
  const persist = (v: string) => {
    const stored = useStore.getState().reviews.find((r) => r.kind === kind && r.date === date)?.notes ?? ''
    if (v !== stored) saveReview(kind, date, v)
  }
  // Another day, or a change from elsewhere while not typing here.
  useEffect(() => edit(review?.notes ?? ''), [kind, date]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!typing.current) edit(review?.notes ?? '')
  }, [review?.notes])
  // Saved shortly after typing stops, and when the day, the page or the tab is left – not only on blur.
  useEffect(() => {
    const timer = window.setTimeout(() => persist(value), 800)
    return () => window.clearTimeout(timer)
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onHide = () => persist(latest.current)
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      persist(latest.current)
    }
  }, [kind, date]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      <SectionLabel>{t('review.journal')}</SectionLabel>
      <Textarea
        value={value}
        onChange={(e) => edit(e.target.value)}
        onFocus={() => (typing.current = true)}
        onBlur={() => {
          typing.current = false
          persist(value)
        }}
        placeholder={kind === 'daily' ? t('review.journalDaily') : t('review.journalWeekly')}
        className="min-h-[120px]"
      />
    </div>
  )
}

function TaskList({ items, empty }: { items: Task[]; empty?: string }) {
  const { t } = useTranslation()
  const openTask = useUi((s) => s.openTask)
  const completeTask = useStore((s) => s.completeTask)
  if (items.length === 0) return <p className="text-[13px] text-ink-3">{empty ?? t('review.nothing')}</p>
  return (
    <ul className="flex flex-col">
      {items.map((x) => (
        <li key={x.id} className="flex items-start gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-2">
          <Checkbox checked={x.status === 'done'} onChange={(v) => completeTask(x.id, v)} className="mt-[3px]" />
          <button type="button" onClick={() => openTask(x.id)} className="min-w-0 flex-1 text-left">
            <div className={cx('text-[14px]', x.status === 'done' && 'strike')}>{x.title}</div>
            <TaskMeta task={x} className="mt-0.5" />
          </button>
        </li>
      ))}
    </ul>
  )
}

function Daily({ date, setDate }: { date: string; setDate: (d: string) => void }) {
  const { t } = useTranslation()
  const locale = useLocale()
  const today = todayISO()
  const tasks = useVisibleTasks()
  const events = useVisibleEvents()
  const blocks = useVisibleBlocks()
  const projects = useVisibleProjects()
  const dayCapacityHours = useStore((s) => s.settings.dayCapacityHours)
  const scheduleTask = useStore((s) => s.scheduleTask)
  const projectMap = useProjectMap()
  const rel = useRelDay()
  const tomorrow = addDaysISO(date, 1)
  const completed = tasks.filter((x) => x.status === 'done' && x.completedAt && toISODate(new Date(x.completedAt)) === date).sort(sortTasks)
  const notesMade = tasks.flatMap((x) => x.notes.filter((n) => toISODate(new Date(n.createdAt)) === date).map((n) => ({ task: x, note: n })))
  const stillOpen = tasksPlannedOn(tasks, date).filter(isOpen)
  const tomorrowTasks = tasksPlannedOn(tasks, tomorrow).filter(isOpen)
  const tomorrowEvents = eventsOn(events, tomorrow)
  const tomorrowBlocks = blocksOn(blocks, tomorrow)
  const missing = projectsWithoutNextAction(projects, tasks)

  return (
    <div className="flex flex-col gap-10">
      <Nav label={rel(date)} onPrev={() => setDate(addDaysISO(date, -1))} onNext={() => setDate(addDaysISO(date, 1))} onToday={date !== today ? () => setDate(today) : undefined} />

      <div>
        <SectionLabel>
          {t('review.completed')} · {completed.length}
        </SectionLabel>
        <TaskList items={completed} />
      </div>

      {notesMade.length > 0 && (
        <div>
          <SectionLabel>{t('review.notesMade')}</SectionLabel>
          <ul className="flex flex-col gap-2">
            {notesMade.map(({ task, note }) => (
              <li key={note.id} className="rounded-lg bg-surface-2 px-3 py-2 text-[13px]">
                <div className="mb-0.5 text-[12px] text-ink-3">{task.title}</div>
                <div className="whitespace-pre-wrap">{note.text}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <SectionLabel
          right={
            stillOpen.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => stillOpen.forEach((x) => scheduleTask(x.id, tomorrow))}>
                {t('review.moveToTomorrow')}
              </Button>
            )
          }
        >
          {t('review.stillOpen')} · {stillOpen.length}
        </SectionLabel>
        <TaskList items={stillOpen} empty={t('review.allGood')} />
      </div>

      <div>
        <SectionLabel right={<Link to={`/today?date=${tomorrow}`} className="text-[12px] text-ink-2 hover:text-ink">{t('review.openToday')} →</Link>}>
          {t('review.tomorrow')} · {fmtWeekday(tomorrow, locale)} {fmtDate(tomorrow, locale)}
        </SectionLabel>
        {tomorrowEvents.length + tomorrowTasks.length + tomorrowBlocks.length === 0 ? (
          <p className="text-[13px] text-ink-3">{t('review.nothing')}</p>
        ) : (
          <div className="flex flex-col gap-2 text-[13px]">
            {tomorrowEvents.map((e) => (
              <div key={e.id} className="flex items-center gap-3 text-ink-2">
                <span className="tnum w-[88px] shrink-0 text-ink-3">{e.allDay ? t('today.allDay') : `${fmtTime(e.start, locale)}–${fmtTime(e.end, locale)}`}</span>
                <span className={cx('truncate', e.masked && 'italic text-ink-3')}>{e.title}</span>
              </div>
            ))}
            {tomorrowBlocks.map((b) => {
              const p = b.projectId ? projectMap.get(b.projectId) : null
              return (
                <div key={b.id} className="flex items-center gap-2 text-ink-2" style={projectVars(p?.color ?? null)}>
                  <ProjectDot color={p?.color ?? null} size={6} />
                  {p ? p.name : t('week.chores')} · {b.size * dayCapacityHours} h
                </div>
              )
            })}
            {tomorrowTasks.length > 0 && <TaskList items={tomorrowTasks} />}
          </div>
        )}
      </div>

      <Journal kind="daily" date={date} />
      {missing.length > 0 && (
        <p className="text-[12px] text-amber">
          {t('review.noNextAction')}: {missing.map((p) => p.name).join(', ')}
        </p>
      )}
    </div>
  )
}

function Weekly({ monday, setMonday }: { monday: string; setMonday: (d: string) => void }) {
  const { t } = useTranslation()
  const locale = useLocale()
  const today = todayISO()
  const tasks = useVisibleTasks()
  const projects = useVisibleProjects()
  const blocks = useVisibleBlocks()
  const settings = useStore((s) => s.settings)
  const days = rangeISO(monday, 7)
  const rows = plannedVsActual(days, projects, tasks, blocks, settings)
  const max = Math.max(1, ...rows.map((r) => Math.max(r.plannedMinutes, r.actualMinutes)))
  const doneCount = rows.reduce((n, r) => n + r.doneCount, 0)
  const missing = projectsWithoutNextAction(projects, tasks)
  const waiting = tasks.filter((x) => x.status === 'waiting')
  const overdue = overdueTasks(tasks, today)
  const label = `${t('review.weekOf', { week: isoWeekNumber(monday) })} · ${fmtDate(monday, locale)} – ${fmtDate(days[6], locale)}`

  return (
    <div className="flex flex-col gap-10">
      <Nav label={label} onPrev={() => setMonday(addDaysISO(monday, -7))} onNext={() => setMonday(addDaysISO(monday, 7))} onToday={monday !== startOfWeekISO(today) ? () => setMonday(startOfWeekISO(today)) : undefined} />

      <div>
        <SectionLabel right={<Link to="/week" className="text-[12px] text-ink-2 hover:text-ink">{t('review.openWeek')} →</Link>}>
          {t('review.plannedVsActual')} · {t('review.done', { count: doneCount })}
        </SectionLabel>
        {rows.length === 0 ? (
          <p className="text-[13px] text-ink-3">{t('review.nothing')}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((r, i) => (
              <li key={r.project?.id ?? `chores-${i}`} style={projectVars(r.project?.color ?? null)}>
                <div className="mb-1 flex items-center justify-between text-[13px]">
                  <ProjectChip project={r.project} className="text-[13px] text-ink" />
                  <span className="tnum text-[12px] text-ink-3">
                    {fmtHours(r.plannedMinutes, locale)} {t('review.planned')} · {fmtHours(r.actualMinutes, locale)} {t('review.actual')} · {t('review.done', { count: r.doneCount })}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <div className="h-1.5 rounded-full bg-surface-3">
                    <div className="pc-dot h-full rounded-full opacity-50" style={{ width: `${(r.plannedMinutes / max) * 100}%` }} />
                  </div>
                  <div className="h-1.5 rounded-full bg-surface-3">
                    <div className="pc-dot h-full rounded-full" style={{ width: `${(r.actualMinutes / max) * 100}%` }} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <div>
          <SectionLabel>{t('review.noNextAction')}</SectionLabel>
          {missing.length === 0 ? (
            <p className="text-[13px] text-ink-3">{t('review.allGood')}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-[13px]">
              {missing.map((p) => (
                <li key={p.id}>
                  <Link to={`/projects/${p.id}`} className="flex items-center gap-2 text-amber hover:underline">
                    <ProjectDot color={p.color} /> {p.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <SectionLabel>{t('review.overdue')}</SectionLabel>
          <TaskList items={overdue} empty={t('review.allGood')} />
        </div>
      </div>

      <div>
        <SectionLabel>{t('review.waiting')}</SectionLabel>
        {waiting.length === 0 ? (
          <p className="text-[13px] text-ink-3">{t('review.nothing')}</p>
        ) : (
          <ul className="flex flex-col">
            {waiting.map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-[13px] hover:bg-surface-2">
                <span className="min-w-0 truncate">
                  {x.title}
                  {x.waitingFor && <span className="text-ink-3"> · {x.waitingFor}</span>}
                </span>
                <span className="tnum shrink-0 text-[12px] text-ink-3">{daysBetween(toISODate(new Date(x.updatedAt)), today)} d</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Journal kind="weekly" date={monday} />
    </div>
  )
}
