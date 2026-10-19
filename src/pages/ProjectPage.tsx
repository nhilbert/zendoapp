import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ChevronDown, ChevronUp, Plus, X } from 'lucide-react'
import type { ProjectStatus, Task } from '@/domain/types'
import { PROJECT_COLORS } from '@/domain/types'
import { addDaysISO, fmtDate, fmtWeekday, startOfWeekISO, todayISO } from '@/domain/dates'
import { nextActionOf, sortTasks } from '@/domain/selectors'
import { useStore } from '@/store/useStore'
import { useUi } from '@/store/useUi'
import { Button, Checkbox, IconButton, Input, Select, SectionLabel, Textarea, cx } from '@/components/ui'
import { ProjectDot, TaskMeta, projectVars, useLocale } from '@/components/TaskBits'

export default function ProjectPage() {
  const { t } = useTranslation()
  const locale = useLocale()
  const navigate = useNavigate()
  const { id } = useParams()
  const project = useStore((s) => s.projects.find((p) => p.id === id))
  const tasks = useStore((s) => s.tasks)
  const blocks = useStore((s) => s.blocks)
  const settings = useStore((s) => s.settings)
  const updateProject = useStore((s) => s.updateProject)
  const deleteProject = useStore((s) => s.deleteProject)
  const addTask = useStore((s) => s.addTask)
  const setTaskStatus = useStore((s) => s.setTaskStatus)
  const completeTask = useStore((s) => s.completeTask)
  const openTask = useUi((s) => s.openTask)
  const [newTitle, setNewTitle] = useState('')
  const [newGoal, setNewGoal] = useState('')

  if (!project) {
    return (
      <div className="mx-auto max-w-3xl">
        <Link to="/projects" className="text-ink-2 hover:text-ink">
          ← {t('nav.projects')}
        </Link>
      </div>
    )
  }

  const archived = project.status === 'archived'
  const goals = project.goals ?? []
  const setGoals = (next: typeof goals) => updateProject(project.id, { goals: next })
  const moveGoal = (index: number, delta: number) => {
    const next = [...goals]
    const [g] = next.splice(index, 1)
    next.splice(index + delta, 0, g)
    setGoals(next)
  }
  const mine = tasks.filter((x) => x.projectId === project.id).sort(sortTasks)
  const next = nextActionOf(tasks, project.id)
  const todo = mine.filter((x) => x.status === 'todo')
  const waiting = mine.filter((x) => x.status === 'waiting')
  const someday = mine.filter((x) => x.status === 'someday')
  const done = mine.filter((x) => x.status === 'done')
  const horizonStart = startOfWeekISO(todayISO())
  const horizonEnd = addDaysISO(horizonStart, 14)
  const myBlocks = blocks.filter((b) => b.projectId === project.id && b.date >= horizonStart && b.date < horizonEnd).sort((a, b) => a.date.localeCompare(b.date))

  const row = (task: Task, options?: { showMakeNext?: boolean }) => (
    <li key={task.id} className="group flex items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-surface-2">
      <Checkbox checked={task.status === 'done'} onChange={(v) => completeTask(task.id, v)} className="mt-[3px]" />
      <button type="button" onClick={() => openTask(task.id)} className="min-w-0 flex-1 text-left">
        <div className={cx('text-[14px]', task.status === 'done' && 'strike')}>{task.title}</div>
        <TaskMeta task={task} hideProject className="mt-1" />
      </button>
      {options?.showMakeNext && task.status !== 'done' && !archived && (
        <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100" onClick={() => setTaskStatus(task.id, 'next')}>
          {t('project.makeNext')}
        </Button>
      )}
    </li>
  )

  return (
    <div className="mx-auto max-w-3xl" style={projectVars(project.color)}>
      <Link to="/projects" className="mb-6 inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
        <ArrowLeft size={13} /> {t('nav.projects')}
      </Link>

      <div className="flex items-start gap-3">
        <ProjectDot color={project.color} size={12} className="mt-3.5" />
        <input
          value={project.name}
          onChange={(e) => updateProject(project.id, { name: e.target.value })}
          className="field-bare -ml-2 w-full px-2 py-1 text-[26px] font-medium leading-tight tracking-[-0.02em]"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px]">
        <Select value={project.status} onChange={(e) => updateProject(project.id, { status: e.target.value as ProjectStatus })} className="h-8 w-auto text-[13px]">
          <option value="active">{t('project.statusActive')}</option>
          <option value="planned">{t('project.statusPlanned')}</option>
          <option value="someday">{t('project.statusSomeday')}</option>
          <option value="archived">{t('project.statusArchived')}</option>
        </Select>
        <label className="flex items-center gap-2 text-ink-2">
          <Checkbox checked={!!project.private} onChange={(v) => updateProject(project.id, { private: v })} /> {t('privacy.project')}
        </label>
        <label className="flex items-center gap-2 text-ink-2">
          {t('project.due')}
          <Input type="date" value={project.dueDate ?? ''} onChange={(e) => updateProject(project.id, { dueDate: e.target.value || undefined })} className="h-8 w-40 text-[13px]" />
        </label>
        <div className="ml-auto flex items-center gap-1.5">
          {PROJECT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => updateProject(project.id, { color: c })}
              className={cx('h-4 w-4 rounded-full border-2 transition-transform hover:scale-110', project.color === c ? 'border-ink' : 'border-transparent')}
              style={{ background: `var(--c-${c})` }}
            />
          ))}
        </div>
      </div>

      {archived && (
        <div className="mt-6 flex items-center justify-between rounded-xl bg-surface-2 px-4 py-3 text-[13px] text-ink-2">
          <span>{t('project.archivedHint')}</span>
          <Button size="sm" onClick={() => updateProject(project.id, { status: 'active' })}>
            {t('project.unarchive')}
          </Button>
        </div>
      )}

      <div className="mt-8">
        <SectionLabel>{t('project.goals')}</SectionLabel>
        {goals.length === 0 && archived && <p className="text-[13px] text-ink-3">—</p>}
        <ol className="flex flex-col">
          {goals.map((g, i) => (
            <li key={g.id} className="group flex items-center gap-1 rounded-lg px-2 py-0.5 hover:bg-surface-2">
              <span className="tnum w-5 shrink-0 text-[12px] text-ink-3">{i + 1}.</span>
              <input
                value={g.text}
                disabled={archived}
                onChange={(e) => setGoals(goals.map((x) => (x.id === g.id ? { ...x, text: e.target.value } : x)))}
                className="field-bare w-full px-2 py-1 text-[14px] disabled:opacity-70"
              />
              {!archived && (
                <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <IconButton label="↑" disabled={i === 0} onClick={() => moveGoal(i, -1)}>
                    <ChevronUp size={14} />
                  </IconButton>
                  <IconButton label="↓" disabled={i === goals.length - 1} onClick={() => moveGoal(i, 1)}>
                    <ChevronDown size={14} />
                  </IconButton>
                  <IconButton label={t('common.remove')} onClick={() => setGoals(goals.filter((x) => x.id !== g.id))}>
                    <X size={14} />
                  </IconButton>
                </div>
              )}
            </li>
          ))}
        </ol>
        {!archived && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!newGoal.trim()) return
              setGoals([...goals, { id: crypto.randomUUID(), text: newGoal.trim() }])
              setNewGoal('')
            }}
            className="flex items-center gap-2 px-2"
          >
            <Plus size={15} className="shrink-0 text-ink-3" />
            <input value={newGoal} onChange={(e) => setNewGoal(e.target.value)} placeholder={t('project.addGoal')} className="w-full bg-transparent py-1.5 text-[14px] placeholder:text-ink-3 focus:outline-none" />
          </form>
        )}
      </div>

      <div className="mt-8">
        <SectionLabel>{t('project.notes')}</SectionLabel>
        <Textarea value={project.notes ?? ''} onChange={(e) => updateProject(project.id, { notes: e.target.value })} placeholder={t('project.notesPlaceholder')} className="min-h-[72px]" disabled={archived} />
      </div>

      <div className="mt-10">
        <SectionLabel>{t('project.nextAction')}</SectionLabel>
        {next ? (
          <div className="rounded-xl border border-accent/40 bg-accent-soft/60 px-4 py-3">
            <ul>{row(next)}</ul>
          </div>
        ) : project.status === 'active' ? (
          <div className="rounded-xl border border-dashed border-amber/50 bg-amber-soft/40 px-4 py-3 text-[13px] text-amber">{t('project.noNextAction')}</div>
        ) : (
          <p className="text-[13px] text-ink-3">—</p>
        )}
      </div>

      <div className="mt-8">
        <SectionLabel>{t('project.tasks')}</SectionLabel>
        {!archived && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!newTitle.trim()) return
              addTask({ title: newTitle, projectId: project.id, status: next ? 'todo' : 'next' })
              setNewTitle('')
            }}
            className="mb-2 flex items-center gap-2 px-2"
          >
            <Plus size={15} className="text-ink-3" />
            <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder={t('project.addTask')} className="w-full bg-transparent py-1.5 text-[14px] placeholder:text-ink-3 focus:outline-none" />
          </form>
        )}
        <ul className="flex flex-col">{todo.map((x) => row(x, { showMakeNext: true }))}</ul>
        {waiting.length > 0 && (
          <>
            <SectionLabel className="mt-6">{t('status.waiting')}</SectionLabel>
            <ul>{waiting.map((x) => row(x, { showMakeNext: true }))}</ul>
          </>
        )}
        {someday.length > 0 && (
          <>
            <SectionLabel className="mt-6">{t('status.someday')}</SectionLabel>
            <ul>{someday.map((x) => row(x, { showMakeNext: true }))}</ul>
          </>
        )}
        {done.length > 0 && (
          <details className="mt-6">
            <summary className="cursor-pointer select-none text-[11px] font-medium uppercase tracking-[0.12em] text-ink-3">
              {t('project.doneTasks')} · {done.length}
            </summary>
            <ul className="mt-2">{done.map((x) => row(x))}</ul>
          </details>
        )}
      </div>

      <div className="mt-10">
        <SectionLabel>{t('project.plannedTime')}</SectionLabel>
        {myBlocks.length === 0 ? (
          <p className="text-[13px] text-ink-3">{t('project.noPlannedTime')}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {myBlocks.map((b) => (
              <li key={b.id} className="pc-soft rounded-full px-3 py-1 text-[12px] text-ink-2">
                {fmtWeekday(b.date, locale)} {fmtDate(b.date, locale)} · {b.size * settings.dayCapacityHours} h
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-16 border-t border-line pt-4">
        <Button
          variant="danger"
          size="sm"
          onClick={() => {
            if (window.confirm(t('project.deleteConfirm'))) {
              deleteProject(project.id)
              navigate('/projects')
            }
          }}
        >
          {t('project.delete')}
        </Button>
      </div>
    </div>
  )
}
