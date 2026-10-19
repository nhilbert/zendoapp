import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Sparkles, Trash2 } from 'lucide-react'
import type { EventKind, Priority, Recurrence } from '@/domain/types'
import { EVENT_KINDS, RECURRENCES } from '@/domain/types'
import { todayISO } from '@/domain/dates'
import { isValidEventTimes } from '@/components/EventDialog'
import { nextActionOf } from '@/domain/selectors'
import { useStore } from '@/store/useStore'
import { useVisibleProjects, useVisibleTasks } from '@/store/visible'
import { aiEnabled, loadAiSettings } from '@/ai/settings'
import { Button, Checkbox, Empty, Field, Input, Segmented, Select, Textarea, cx } from '@/components/ui'
import { fmtEstimate } from '@/components/TaskBits'

/**
 * Clarify – two steps, one item at a time.
 *  1. "What is it?"  – six decisions plus Auto (AI). Trash and "did it" act immediately.
 *  2. Details        – only the fields that matter for the chosen kind; the rest behind "More".
 */
type Kind = 'task' | 'project' | 'meeting' | 'someday' | 'didIt' | 'trash'
const TILES: Kind[] = ['task', 'project', 'meeting', 'someday', 'didIt']
const ESTIMATES = [15, 30, 60, 120, 240, 480] as const
const NEW = '__new__'

export default function ClarifyPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const inbox = useStore((s) => s.inbox)
  const projects = useVisibleProjects()
  const tasks = useVisibleTasks()
  const store = useStore()

  const requested = params.get('id')
  const item = useMemo(() => inbox.find((i) => i.id === requested) ?? inbox[0], [inbox, requested])
  const index = item ? inbox.findIndex((i) => i.id === item.id) : -1
  const activeProjects = projects.filter((p) => p.status === 'active' || p.status === 'planned')

  const [step, setStep] = useState<'kind' | 'form'>('kind')
  const [kind, setKind] = useState<Kind>('task')
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState<string>('')
  const [newProjectName, setNewProjectName] = useState('')
  const [goal, setGoal] = useState('')
  const [estimate, setEstimate] = useState<number | undefined>(undefined)
  const [priority, setPriority] = useState<Priority>('normal')
  const [due, setDue] = useState('')
  const [planned, setPlanned] = useState('')
  const [recurrence, setRecurrence] = useState<Recurrence | ''>('')
  const [makeNext, setMakeNext] = useState(false)
  const [note, setNote] = useState('')
  const [more, setMore] = useState(false)
  const [isPrivate, setIsPrivate] = useState(false)
  const [evDate, setEvDate] = useState(todayISO())
  const [evStart, setEvStart] = useState('09:00')
  const [evEnd, setEvEnd] = useState('10:00')
  const [evKind, setEvKind] = useState<EventKind>('online')
  const [evLocation, setEvLocation] = useState('')
  const [ai, setAi] = useState<{ status: 'idle' | 'loading' | 'done' | 'error'; message?: string }>({ status: 'idle' })
  const [formError, setFormError] = useState<string | null>(null)

  // Fresh form for every item.
  useEffect(() => {
    if (!item) return
    const [first, ...rest] = item.text.split('\n')
    setStep('kind')
    setKind('task')
    setTitle(first.slice(0, 140))
    setProjectId('')
    setNewProjectName('')
    setGoal('')
    setEstimate(undefined)
    setPriority('normal')
    setDue('')
    setPlanned('')
    setRecurrence('')
    setMakeNext(false)
    setNote(rest.join('\n').trim())
    setMore(false)
    setIsPrivate(false)
    setEvDate(todayISO())
    setEvStart('09:00')
    setEvEnd('10:00')
    setEvKind('online')
    setEvLocation('')
    setAi({ status: 'idle' })
    setFormError(null)
  }, [item?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // "Make next action" defaults to on when the project has none yet.
  useEffect(() => {
    if (projectId && projectId !== NEW) setMakeNext(!nextActionOf(tasks, projectId))
    else if (!projectId) setMakeNext(false)
  }, [projectId, tasks])

  const finish = () => {
    if (item) store.removeInboxItem(item.id)
    if (requested) setParams({})
  }

  const choose = (k: Kind) => {
    if (!item) return
    if (k === 'trash') {
      finish()
      return
    }
    if (k === 'didIt') {
      store.addTask({ title: title || item.text, projectId: null, status: 'done', completedAt: new Date().toISOString(), estimateMinutes: 5 })
      finish()
      return
    }
    setKind(k)
    setStep('form')
  }

  const skip = () => {
    if (!item) return
    store.deferInboxItem(item.id)
    if (requested) setParams({})
  }

  const runAuto = async () => {
    if (!item) return
    const settings = loadAiSettings()
    if (!aiEnabled(settings)) {
      setAi({ status: 'error', message: t('clarify.ai.noKey') })
      return
    }
    setAi({ status: 'loading' })
    try {
      const { suggestClarification } = await import('@/ai')
      const s = await suggestClarification(
        { text: item.text, projects: activeProjects.map((p) => p.name), today: todayISO(), locale: i18n.language.startsWith('de') ? 'de' : 'en' },
        settings,
      )
      const map: Record<string, Kind> = { task: 'task', project: 'project', meeting: 'meeting', someday: 'someday', trash: 'trash' }
      const k = map[s.kind] ?? 'task'
      setKind(k)
      if (s.title) setTitle(s.title)
      if (k === 'project') {
        setNewProjectName(s.newProjectName || s.title)
        setGoal(s.goal ?? '')
      } else {
        const match = s.projectName ? activeProjects.find((p) => p.name.toLowerCase() === s.projectName!.toLowerCase()) : undefined
        setProjectId(match?.id ?? '')
      }
      if (s.estimateMinutes) setEstimate(s.estimateMinutes)
      if (s.priority) setPriority(s.priority)
      if (s.dueDate) setDue(s.dueDate)
      if (s.plannedDate) setPlanned(s.plannedDate)
      if (s.note) setNote(s.note)
      setMore(!!(s.dueDate || s.plannedDate || s.note))
      setAi({ status: 'done', message: s.reasoning ?? undefined })
      setStep('form')
    } catch (err) {
      setAi({ status: 'error', message: t('clarify.ai.error', { message: err instanceof Error ? err.message : String(err) }) })
    }
  }

  // Keyboard: 1–5 choose, 6 trash, a auto (step 1); Escape goes back (step 2).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (step === 'form') {
        // Escape goes back even while typing in a field.
        if (e.key === 'Escape') setStep('kind')
        return
      }
      const el = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return
      const n = Number(e.key)
      if (n >= 1 && n <= 5) choose(TILES[n - 1])
      else if (e.key === '6') choose('trash')
      else if (e.key === 'a') void runAuto()
      else return
      // The chosen form autofocuses an input; stop the key from being typed into it.
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  if (!item) {
    return (
      <div className="mx-auto max-w-2xl">
        <Empty title={t('clarify.emptyTitle')} body={t('clarify.emptyBody')}>
          <Button onClick={() => navigate('/today')}>{t('nav.today')}</Button>
        </Empty>
      </div>
    )
  }

  const save = () => {
    const firstGoal = goal.trim() ? [{ id: crypto.randomUUID(), text: goal.trim() }] : undefined
    // Resolved only after the form has been validated, so a rejected save never leaves an empty project behind.
    const resolveProject = () =>
      projectId === NEW
        ? store.addProject({ name: newProjectName.trim() || title.trim() || item.text.split('\n')[0], goals: firstGoal, private: isPrivate || undefined })
        : projectId
          ? projects.find((p) => p.id === projectId)
          : undefined
    switch (kind) {
      case 'task': {
        if (!title.trim()) return
        const chosenProject = resolveProject()
        store.addTask({
          title,
          projectId: chosenProject?.id ?? null,
          status: makeNext || projectId === NEW ? 'next' : chosenProject ? 'todo' : 'next',
          priority,
          estimateMinutes: estimate,
          dueDate: due || undefined,
          plannedDate: planned || undefined,
          recurrence: recurrence || undefined,
          private: isPrivate || undefined,
          description: note || undefined,
        })
        break
      }
      case 'project': {
        if (!newProjectName.trim() && !title.trim()) return
        const p = store.addProject({ name: newProjectName || item.text.split('\n')[0], goals: firstGoal, dueDate: due || undefined, notes: note || undefined, private: isPrivate || undefined })
        if (title.trim()) store.addTask({ title, projectId: p.id, status: 'next', priority, estimateMinutes: estimate })
        break
      }
      case 'meeting': {
        if (!title.trim()) return
        if (!isValidEventTimes({ date: evDate, start: evStart, end: evEnd })) {
          setFormError(t('event.invalidTimes'))
          return
        }
        const chosenProject = resolveProject()
        store.addEvent({ title, date: evDate, start: evStart, end: evEnd, kind: evKind, location: evLocation || undefined, projectId: chosenProject?.id ?? null })
        break
      }
      case 'someday': {
        const chosenProject = resolveProject()
        store.addTask({ title: title || item.text, projectId: chosenProject?.id ?? null, status: 'someday', priority: 'low', private: isPrivate || undefined, description: note || undefined })
        break
      }
      case 'didIt':
      case 'trash':
        break
    }
    finish()
  }

  const projectSelect = (
    <Field label={t('clarify.form.project')}>
      <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
        <option value="">{t('clarify.form.noProject')}</option>
        {activeProjects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
        <option value={NEW}>{t('clarify.form.newProject')}</option>
      </Select>
    </Field>
  )

  const estimateRow = (
    <div className="grid grid-cols-[1fr_auto] gap-4">
      <Field label={t('clarify.form.estimate')}>
        <div className="flex flex-wrap gap-1.5">
          {ESTIMATES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setEstimate(estimate === m ? undefined : m)}
              className={cx(
                'h-7 rounded-full border px-2.5 text-[12px] transition-colors',
                estimate === m ? 'border-accent bg-accent-soft text-ink' : 'border-line text-ink-2 hover:bg-surface-2',
              )}
            >
              {fmtEstimate(m, t)}
            </button>
          ))}
        </div>
      </Field>
      <Field label={t('clarify.form.priority')}>
        <div>
          <Segmented<Priority>
            value={priority}
            onChange={setPriority}
            options={[
              { value: 'high', label: t('priority.high') },
              { value: 'normal', label: t('priority.normal') },
              { value: 'low', label: t('priority.low') },
            ]}
          />
        </div>
      </Field>
    </div>
  )

  const privateToggle = (
    <label className="flex items-center gap-2 text-[13px] text-ink-2">
      <Checkbox checked={isPrivate} onChange={setIsPrivate} /> {kind === 'project' ? t('privacy.project') : t('privacy.task')}
    </label>
  )

  const moreToggle = (
    <button type="button" onClick={() => setMore((m) => !m)} className="self-start text-[12px] text-ink-3 hover:text-ink">
      {more ? '▾ ' + t('clarify.less') : '▸ ' + t('clarify.more')}
    </button>
  )

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-[26px] font-medium leading-tight tracking-[-0.02em]">{t('clarify.title')}</h1>
          <p className="mt-1 text-[14px] text-ink-2">{t('clarify.subtitle')}</p>
        </div>
        <span className="tnum text-[13px] text-ink-3">{t('clarify.progress', { current: index + 1, total: inbox.length })}</span>
      </div>

      {step === 'kind' ? (
        <div key={`${item.id}-kind`} className="card fade-in p-7">
          <textarea
            value={item.text}
            onChange={(e) => store.updateInboxItem(item.id, e.target.value)}
            rows={Math.min(8, Math.max(2, item.text.split('\n').length))}
            className="field-bare -mx-2 w-full resize-none px-2 py-1 text-[21px] leading-relaxed"
          />

          <div className="mt-8 mb-3 flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-3">{t('clarify.question')}</span>
            <span className="text-[11px] text-ink-3">{t('clarify.keys')}</span>
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            {TILES.map((k, i) => (
              <Tile key={k} label={t(`clarify.kinds.${k}`)} hint={t(`clarify.kinds.${k}Hint`)} shortcut={String(i + 1)} onClick={() => choose(k)} />
            ))}
            <Tile
              label={t('clarify.kinds.auto')}
              hint={ai.status === 'loading' ? t('clarify.ai.thinking') : t('clarify.kinds.autoHint')}
              shortcut="a"
              icon={<Sparkles size={14} className="text-accent" />}
              accent
              disabled={ai.status === 'loading'}
              onClick={() => void runAuto()}
            />
          </div>
          {ai.status === 'error' && <p className="fade-in mt-3 text-[12px] text-rose">{ai.message}</p>}

          <div className="mt-6 flex items-center justify-between border-t border-line pt-4">
            <Button variant="ghost" onClick={() => choose('trash')} className="text-ink-3 hover:text-rose">
              <Trash2 size={14} /> {t('clarify.kinds.trash')} <span className="ml-1 text-[11px] text-ink-3">6</span>
            </Button>
            <Button variant="ghost" onClick={skip}>
              {t('clarify.form.skip')}
            </Button>
          </div>
        </div>
      ) : (
        <div key={`${item.id}-form`} className="card fade-in p-7">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setStep('kind')} className="flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
              <ArrowLeft size={13} /> {t('clarify.back')}
            </button>
            <span className="text-ink-3">·</span>
            <span className="text-[13px] font-medium">{ai.status === 'done' ? t('clarify.aiSuggests', { kind: t(`clarify.kinds.${kind}`) }) : t(`clarify.kinds.${kind}`)}</span>
            {ai.status === 'done' && ai.message && <span className="truncate text-[12px] text-ink-3">— {ai.message}</span>}
          </div>
          <p className="mt-3 line-clamp-3 whitespace-pre-wrap text-[14px] leading-relaxed text-ink-2">{item.text}</p>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              save()
            }}
            className="mt-6 flex flex-col gap-4"
          >
            {kind === 'task' && (
              <>
                <Field label={t('clarify.form.title')} hint={t('clarify.form.titleHint')}>
                  <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
                </Field>
                {projectSelect}
                {projectId === NEW && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={t('clarify.form.projectName')}>
                      <Input value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} />
                    </Field>
                    <Field label={t('clarify.form.goal')} hint={t('common.optional')}>
                      <Input value={goal} onChange={(e) => setGoal(e.target.value)} />
                    </Field>
                  </div>
                )}
                {estimateRow}
                {projectId && projectId !== NEW && (
                  <label className="flex items-center gap-2 text-[13px] text-ink-2">
                    <Checkbox checked={makeNext} onChange={setMakeNext} /> {t('clarify.form.makeNext')}
                  </label>
                )}
                {!projectId && privateToggle}
                {moreToggle}
                {more && (
                  <div className="fade-in flex flex-col gap-4">
                    <div className="grid grid-cols-2 gap-3">
                      <Field label={t('clarify.form.due')} hint={t('clarify.form.dueHint')}>
                        <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
                      </Field>
                      <Field label={t('clarify.form.planned')} hint={t('clarify.form.plannedHint')}>
                        <Input type="date" value={planned} onChange={(e) => setPlanned(e.target.value)} />
                      </Field>
                    </div>
                    <Field label={t('clarify.form.recurrence')} className="w-64">
                      <Select value={recurrence} onChange={(e) => setRecurrence(e.target.value as Recurrence | '')}>
                        <option value="">{t('recurrence.none')}</option>
                        {RECURRENCES.map((r) => (
                          <option key={r} value={r}>
                            {t(`recurrence.${r}`)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={t('clarify.form.note')} hint={t('common.optional')}>
                      <Textarea value={note} onChange={(e) => setNote(e.target.value)} className="min-h-[60px]" />
                    </Field>
                  </div>
                )}
              </>
            )}

            {kind === 'project' && (
              <>
                <Field label={t('clarify.form.projectName')}>
                  <Input autoFocus value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} placeholder={item.text.split('\n')[0]} />
                </Field>
                <Field label={t('clarify.form.goal')} hint={t('common.optional')}>
                  <Input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={t('clarify.form.goalPlaceholder')} />
                </Field>
                <Field label={t('clarify.form.firstAction')} hint={t('clarify.form.titleHint')}>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} />
                </Field>
                {privateToggle}
                {moreToggle}
                {more && (
                  <div className="fade-in flex flex-col gap-4">
                    {estimateRow}
                    <Field label={t('clarify.form.due')} hint={t('clarify.form.dueHint')} className="w-48">
                      <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
                    </Field>
                  </div>
                )}
              </>
            )}

            {kind === 'meeting' && (
              <>
                <Field label={t('event.title')}>
                  <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
                </Field>
                <div className="grid grid-cols-3 gap-3">
                  <Field label={t('event.date')}>
                    <Input type="date" value={evDate} onChange={(e) => setEvDate(e.target.value)} />
                  </Field>
                  <Field label={t('event.start')}>
                    <Input type="time" step={900} value={evStart} onChange={(e) => setEvStart(e.target.value)} />
                  </Field>
                  <Field label={t('event.end')}>
                    <Input type="time" step={900} value={evEnd} onChange={(e) => setEvEnd(e.target.value)} />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t('event.kind')}>
                    <Select value={evKind} onChange={(e) => setEvKind(e.target.value as EventKind)}>
                      {EVENT_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {t(`event.kinds.${k}`)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t('event.location')} hint={t('common.optional')}>
                    <Input value={evLocation} onChange={(e) => setEvLocation(e.target.value)} />
                  </Field>
                </div>
                {projectSelect}
              </>
            )}

            {kind === 'someday' && (
              <>
                <Field label={t('clarify.form.title')}>
                  <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
                </Field>
                {projectSelect}
                {!projectId && privateToggle}
              </>
            )}

            {kind === 'trash' && <p className="text-[13px] text-ink-2">{t('clarify.kinds.trashHint')}.</p>}
            {formError && <p className="text-[12px] text-rose">{formError}</p>}

            <div className="mt-2 flex items-center justify-between border-t border-line pt-4">
              <Button variant="ghost" onClick={() => setStep('kind')}>
                {t('clarify.back')}
              </Button>
              <Button variant="primary" type="submit">
                {kind === 'trash' ? t('clarify.confirmTrash') : t('clarify.form.save')}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

function Tile({
  label,
  hint,
  shortcut,
  onClick,
  icon,
  accent,
  disabled,
}: {
  label: string
  hint: string
  shortcut: string
  onClick: () => void
  icon?: React.ReactNode
  accent?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'flex min-h-[84px] flex-col items-start rounded-xl border px-4 py-3 text-left transition-colors disabled:opacity-50',
        accent ? 'border-accent/40 bg-accent-soft/40 hover:bg-accent-soft' : 'border-line bg-surface hover:border-line-2 hover:bg-surface-2',
      )}
    >
      <span className="flex w-full items-center justify-between text-[15px] font-medium">
        <span className="flex items-center gap-1.5">
          {icon}
          {label}
        </span>
        <span className="text-[11px] text-ink-3">{shortcut}</span>
      </span>
      <span className="mt-1 text-[12.5px] leading-snug text-ink-2">{hint}</span>
    </button>
  )
}
