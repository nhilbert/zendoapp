import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Target, X } from 'lucide-react'
import type { BlockSize, Task } from '@/domain/types'
import { BLOCK_SIZE_LABEL } from '@/domain/types'
import { fmtHours, fmtTime, toISODate, todayISO } from '@/domain/dates'
import { blocksOn, eventsOn, isOpen, nextActionOf, safeTimes, sortTasks } from '@/domain/selectors'
import { useStore } from '@/store/useStore'
import { useUi } from '@/store/useUi'
import { Button, Checkbox, SectionLabel, Textarea, cx } from '@/components/ui'
import { ProjectDot, TaskMeta, projectVars, useLocale } from '@/components/TaskBits'

const THEN_LIMIT = 5

/**
 * Focus on one project: its next action large, what comes after, and nothing else of the app
 * (the shell hides navigation on /focus). Quick capture (n) stays available to park distracting
 * thoughts; Esc ends the focus and returns to where it was started.
 */
export default function FocusPage() {
  const { t } = useTranslation()
  const locale = useLocale()
  const navigate = useNavigate()
  const location = useLocation()
  const { id } = useParams()
  const project = useStore((s) => s.projects.find((p) => p.id === id))
  const tasks = useStore((s) => s.tasks)
  const events = useStore((s) => s.events)
  const blocks = useStore((s) => s.blocks)
  const settings = safeTimes(useStore((s) => s.settings))
  const completeTask = useStore((s) => s.completeTask)
  const setTaskStatus = useStore((s) => s.setTaskStatus)
  const addTask = useStore((s) => s.addTask)
  const updateProject = useStore((s) => s.updateProject)
  const openTask = useUi((s) => s.openTask)
  const [showAll, setShowAll] = useState(false)
  const [newNext, setNewNext] = useState('')
  const [newTask, setNewTask] = useState('')

  const from = (location.state as { from?: string } | null)?.from
  const exit = () => navigate(from ?? (project ? `/projects/${project.id}` : '/today'))
  const exitRef = useRef(exit)
  exitRef.current = exit
  useEffect(() => {
    // Capture phase: runs before the shell's Escape handler, so an open dialog is closed first instead of ending focus.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.metaKey || e.ctrlKey || e.altKey) return
      const ui = useUi.getState()
      if (ui.captureOpen || ui.taskId || ui.event) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
        el.blur()
        return
      }
      exitRef.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  if (!project || project.status === 'archived') {
    return (
      <div className="mx-auto max-w-2xl pt-[12vh] text-center">
        <p className="text-[14px] text-ink-2">{t('focus.unavailable')}</p>
        <Button className="mt-4" onClick={exit}>
          {t('focus.exit')}
        </Button>
      </div>
    )
  }

  const today = todayISO()
  const mine = tasks.filter((x) => x.projectId === project.id)
  const next = nextActionOf(tasks, project.id)
  const open = mine.filter(isOpen).sort(sortTasks)
  const then = open.filter((x) => x.status === 'todo')
  const waiting = open.filter((x) => x.status === 'waiting')
  const doneToday = mine.filter((x) => x.status === 'done' && x.completedAt && toISODate(new Date(x.completedAt)) === today)
  const goal = project.goals?.[0]?.text?.trim()
  const blocked = blocksOn(blocks, today)
    .filter((b) => b.projectId === project.id)
    .reduce((sum, b) => sum + b.size, 0)
  const meetings = eventsOn(events, today).filter((e) => e.projectId === project.id && !e.allDay)

  const submit = (value: string, status: Task['status'], reset: () => void) => {
    if (value.trim()) addTask({ title: value, projectId: project.id, status })
    reset()
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col" style={projectVars(project.color)}>
      <div className="flex items-center justify-between">
        <span className="pc-text flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em]">
          <Target size={13} /> {t('focus.label')}
        </span>
        <Button variant="ghost" size="sm" onClick={exit}>
          <X size={14} /> {t('focus.exit')}
        </Button>
      </div>

      <header className="mt-8 md:mt-14">
        <div className="flex items-center gap-3">
          <ProjectDot color={project.color} size={12} />
          <h1 className="text-[24px] font-medium leading-tight tracking-[-0.02em] md:text-[30px]">{project.name}</h1>
        </div>
        {goal && <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{goal}</p>}
        <p className="tnum mt-3 text-[13px] text-ink-3">
          {blocked > 0
            ? t('focus.dayBlocked', { size: BLOCK_SIZE_LABEL[blocked as BlockSize] ?? String(blocked), hours: fmtHours(blocked * settings.dayCapacityHours * 60, locale) })
            : t('focus.notBlocked')}
          {meetings.map((e) => (
            <span key={e.id}>
              {' · '}
              {fmtTime(e.start, locale)}–{fmtTime(e.end, locale)} {e.title}
            </span>
          ))}
        </p>
      </header>

      <section className="mt-10">
        <SectionLabel>{t('focus.next')}</SectionLabel>
        {next ? (
          <div className="card flex items-start gap-4 px-5 py-4">
            <Checkbox checked={false} onChange={(v) => completeTask(next.id, v)} className="mt-[7px]" />
            <button type="button" onClick={() => openTask(next.id)} className="min-w-0 flex-1 text-left">
              <div className="text-[18px] leading-snug md:text-[21px]">{next.title}</div>
              <TaskMeta task={next} hideProject className="mt-2" />
            </button>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-line-2 px-5 py-4">
            <p className="text-[14px] text-ink-2">{t('focus.noNext')}</p>
            {then.length > 0 && (
              <ul className="mt-2 flex flex-col">
                {then.slice(0, THEN_LIMIT).map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-2 py-1 text-[14px]">
                    <span className="truncate">{x.title}</span>
                    <Button size="sm" variant="ghost" onClick={() => setTaskStatus(x.id, 'next')}>
                      {t('project.makeNext')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault()
                submit(newNext, 'next', () => setNewNext(''))
              }}
            >
              <input value={newNext} onChange={(e) => setNewNext(e.target.value)} placeholder={t('focus.addNext')} className="mt-2 w-full bg-transparent py-1.5 text-[15px] placeholder:text-ink-3 focus:outline-none" />
            </form>
          </div>
        )}
      </section>

      {next && then.length > 0 && (
        <section className="mt-8">
          <SectionLabel>{t('focus.then')}</SectionLabel>
          <ul className="flex flex-col">
            {(showAll ? then : then.slice(0, THEN_LIMIT)).map((x) => (
              <FocusRow key={x.id} task={x} onOpen={() => openTask(x.id)} onDone={(v) => completeTask(x.id, v)} onMakeNext={() => setTaskStatus(x.id, 'next')} />
            ))}
          </ul>
          {then.length > THEN_LIMIT && !showAll && (
            <button type="button" onClick={() => setShowAll(true)} className="mt-1 px-2 text-[12px] text-ink-3 hover:text-ink">
              {t('focus.showAll', { count: then.length })}
            </button>
          )}
        </section>
      )}

      {waiting.length > 0 && (
        <section className="mt-8">
          <SectionLabel>{t('focus.waiting')}</SectionLabel>
          <ul className="flex flex-col">
            {waiting.map((x) => (
              <FocusRow key={x.id} task={x} onOpen={() => openTask(x.id)} onDone={(v) => completeTask(x.id, v)} />
            ))}
          </ul>
        </section>
      )}

      {doneToday.length > 0 && (
        <section className="mt-8">
          <SectionLabel>{t('focus.doneToday')}</SectionLabel>
          <ul className="flex flex-col">
            {doneToday.map((x) => (
              <FocusRow key={x.id} task={x} onOpen={() => openTask(x.id)} onDone={(v) => completeTask(x.id, v)} />
            ))}
          </ul>
        </section>
      )}

      <form
        className="mt-8"
        onSubmit={(e) => {
          e.preventDefault()
          submit(newTask, 'todo', () => setNewTask(''))
        }}
      >
        <input value={newTask} onChange={(e) => setNewTask(e.target.value)} placeholder={t('focus.addTask')} className="w-full border-b border-line bg-transparent px-2 py-2 text-[14px] placeholder:text-ink-3 focus:border-line-2 focus:outline-none" />
      </form>

      <details className="mt-8" open={!!project.notes?.trim()}>
        <summary className="cursor-pointer select-none text-[11px] font-medium uppercase tracking-[0.12em] text-ink-3">{t('focus.notes')}</summary>
        <Textarea value={project.notes ?? ''} onChange={(e) => updateProject(project.id, { notes: e.target.value })} className="mt-3 min-h-[120px]" />
      </details>

      <p className="mt-10 hidden text-center text-[12px] text-ink-3 md:block">{t('focus.hint')}</p>
    </div>
  )
}

function FocusRow({ task, onOpen, onDone, onMakeNext }: { task: Task; onOpen: () => void; onDone: (done: boolean) => void; onMakeNext?: () => void }) {
  const { t } = useTranslation()
  return (
    <li className="group flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-surface-2">
      <Checkbox checked={task.status === 'done'} onChange={onDone} className="mt-[3px]" />
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className={cx('text-[14px]', task.status === 'done' && 'strike')}>{task.title}</div>
        <TaskMeta task={task} hideProject className="mt-1" />
      </button>
      {onMakeNext && (
        <Button variant="ghost" size="sm" className="reveal opacity-0 group-hover:opacity-100" onClick={onMakeNext}>
          {t('project.makeNext')}
        </Button>
      )}
    </li>
  )
}
