import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Sparkles, Trash2 } from 'lucide-react'
import type { EventKind, InboxItem, Priority, Recurrence } from '@/domain/types'
import { EVENT_KINDS, RECURRENCES } from '@/domain/types'
import { todayISO } from '@/domain/dates'
import { isValidEventTimes } from '@/components/EventDialog'
import { nextActionOf } from '@/domain/selectors'
import { useStore } from '@/store/useStore'
import { useHidePrivate, useVisibleProjects } from '@/store/visible'
import { Button, Checkbox, Empty, Field, Input, Segmented, Select, Textarea, cx } from '@/components/ui'
import { fmtEstimate } from '@/components/TaskBits'
import { aiErrorText } from '@/ai/errors'
import { NoAiKey, suggestClarification, type ClarifySuggestion } from '@/ai'

/**
 * Clarify – two steps, one item at a time.
 *  1. "What is it?"  – six decisions plus Auto (AI). Trash and "did it" act immediately.
 *  2. Details        – only the fields that matter for the chosen kind; the rest behind "More".
 * With "automatic proposal" on (Settings), the AI is asked in the background for the current and the next
 * item; its kind is marked on step 1 and Enter opens it. A proposal only prefills a form when one is opened,
 * so an answer that arrives late never overrides a choice already made.
 */
type Kind = 'task' | 'project' | 'meeting' | 'someday' | 'didIt' | 'trash'
const TILES: Kind[] = ['task', 'project', 'meeting', 'someday', 'didIt']
type Proposal = { status: 'loading' } | { status: 'done'; s: ClarifySuggestion } | { status: 'error'; message: string }
const AI_KINDS: Record<ClarifySuggestion['kind'], Kind> = { task: 'task', project: 'project', meeting: 'meeting', someday: 'someday', trash: 'trash' }
/**
 * A proposal belongs to an item's text (editing the note asks again) and to what the AI was shown:
 * one made while private items were shown is never offered after hiding them.
 */
const proposalKey = (i: InboxItem, hidePrivate: boolean) => `${hidePrivate ? 'h' : 'a'}\n${i.id}\n${i.text}`
const ESTIMATES = [15, 30, 60, 120, 240, 480] as const
const NEW = '__new__'

export default function ClarifyPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const inbox = useStore((s) => s.inbox)
  const projects = useVisibleProjects()
  const hidePrivate = useHidePrivate()
  const autoClarify = useStore((s) => !!s.settings.autoClarify)
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
  // The form follows the AI's proposal (its kind was taken): header and reasoning say so.
  const [ai, setAi] = useState<{ status: 'idle' | 'done'; message?: string }>({ status: 'idle' })
  const [formError, setFormError] = useState<string | null>(null)
  // An existing task the AI linked the note to. Nothing happens to it unless the named main button is used.
  const [related, setRelated] = useState<ClarifySuggestion['related']>(null)
  const asNote = related?.relation === 'duplicate'
  const proposals = useRef(new Map<string, Proposal>())
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  // "a" pressed before the answer arrived: open the proposal as soon as it is there.
  const [awaiting, setAwaiting] = useState<string | null>(null)
  // The proposal fills the fields once per item, and after a form was already open only when its kind is taken,
  // so going back and choosing again keeps what was typed.
  const prefilled = useRef<string | null>(null)
  const opened = useRef<string | null>(null)
  const key = item ? proposalKey(item, hidePrivate) : ''
  const proposal = item ? proposals.current.get(key) : undefined
  const proposed = proposal?.status === 'done' ? (AI_KINDS[proposal.s.kind] ?? 'task') : null
  const nextItem = index >= 0 ? inbox[index + 1] : undefined

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
    setRelated(null)
    setAwaiting(null)
    prefilled.current = null
    opened.current = null
  }, [item?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Editing the note on step 1 carries over into the form (title from its first line, the rest as note).
  // Going back from the form keeps what was typed there: the text has not changed then.
  useEffect(() => {
    if (!item || step !== 'kind') return
    const [first, ...rest] = item.text.split('\n')
    setTitle(first.slice(0, 140))
    setNote(rest.join('\n').trim())
  }, [item?.text]) // eslint-disable-line react-hooks/exhaustive-deps

  // "Make next action" defaults to on when the project has none yet – set when the project is chosen, so a
  // background sync cannot undo the user's choice. All tasks count: a hidden private next action is one too.
  useEffect(() => {
    if (projectId && projectId !== NEW) setMakeNext(!nextActionOf(useStore.getState().tasks, projectId))
    else if (!projectId) setMakeNext(false)
  }, [projectId])

  const finish = () => {
    if (item) store.removeInboxItem(item.id)
    if (requested) setParams({})
  }

  const request = (it: InboxItem, retry = false) => {
    const k = proposalKey(it, hidePrivate)
    const known = proposals.current.get(k)
    if (known && !(retry && known.status === 'error')) return
    proposals.current.set(k, { status: 'loading' })
    rerender()
    suggestClarification({ text: it.text, today: todayISO(), locale: i18n.language.startsWith('de') ? 'de' : 'en', includePrivate: !hidePrivate })
      .then((s) => proposals.current.set(k, { status: 'done', s }))
      .catch((err) => proposals.current.set(k, { status: 'error', message: err instanceof NoAiKey ? t('clarify.ai.noKey') : t('clarify.ai.error', { message: aiErrorText(err, t) }) }))
      .finally(rerender)
  }

  // Automatic proposal: ask for this item and the next one (a moment after the note was last edited).
  useEffect(() => {
    if (!autoClarify || !item) return
    const timer = window.setTimeout(
      () => {
        request(item)
        if (nextItem) request(nextItem)
      },
      proposals.current.has(key) ? 0 : 600,
    )
    return () => window.clearTimeout(timer)
  }, [autoClarify, key, nextItem?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Opens the form for k, prefilled from the proposal where it fits; the link to another task only with the proposed kind. */
  const open = (k: Kind) => {
    const s = proposal?.status === 'done' ? proposal.s : null
    const fill = !!s && prefilled.current !== key && (opened.current !== key || k === proposed)
    opened.current = key
    if (s && fill) {
      prefilled.current = key
      if (s.title) setTitle(s.title)
      if (k === 'project') {
        setNewProjectName(s.newProjectName || s.title)
        setGoal(s.goal ?? '')
      } else setProjectId(s.projectId && activeProjects.some((p) => p.id === s.projectId) ? s.projectId : '')
      if (s.estimateMinutes) setEstimate(s.estimateMinutes)
      if (s.priority) setPriority(s.priority)
      if (s.dueDate) setDue(s.dueDate)
      if (s.plannedDate) setPlanned(s.plannedDate)
      if (k === 'meeting' && (s.plannedDate || s.dueDate)) setEvDate((s.plannedDate || s.dueDate)!)
      if (s.note) setNote(s.note)
      setMore(!!(s.dueDate || s.plannedDate || s.note))
    }
    const asProposed = !!s && k === proposed
    setRelated(asProposed ? (s.related ?? null) : null)
    setAi(asProposed ? { status: 'done', message: s.reasoning ?? undefined } : { status: 'idle' })
    setAwaiting(null)
    setKind(k)
    setStep('form')
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
    open(k)
  }

  const skip = () => {
    if (!item) return
    store.deferInboxItem(item.id)
    if (requested) setParams({})
  }

  /** Auto (a): open the proposal, ask again after an error, or wait for the answer and then open it. */
  const runAuto = () => {
    if (!item) return
    if (proposed) return open(proposed)
    request(item, true)
    setAwaiting(key)
  }
  useEffect(() => {
    if (awaiting && awaiting === key && step === 'kind' && proposed) open(proposed)
  }, [awaiting, key, step, proposed]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard: 1–5 choose, 6 trash, a auto, Enter takes the proposal (step 1); Escape goes back (step 2).
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
      else if (e.key === 'a') runAuto()
      // a focused button handles Enter itself
      else if (e.key === 'Enter' && proposed && el.tagName !== 'BUTTON' && el.tagName !== 'A') open(proposed)
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

  /** withRelated: also do what the AI linked (tick the task off, or only add the note to it). */
  const save = (withRelated = true) => {
    if (!item) return
    if (asNote && withRelated) {
      // The linked task may be gone by now (deleted elsewhere): then the note stays in the inbox.
      if (!useStore.getState().tasks.some((x) => x.id === related.taskId)) {
        setRelated(null)
        setFormError(t('clarify.related.gone'))
        return
      }
      store.addTaskNote(related.taskId, item.text)
      finish()
      return
    }
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
        const p = store.addProject({ name: newProjectName.trim() || item.text.split('\n')[0], goals: firstGoal, dueDate: due || undefined, notes: note || undefined, private: isPrivate || undefined })
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
    if (withRelated && related?.relation === 'completes') store.completeTask(related.taskId, true)
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

  const newProjectFields = projectId === NEW && (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label={t('clarify.form.projectName')}>
        <Input value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} placeholder={title} />
      </Field>
      <Field label={t('clarify.form.goal')} hint={t('common.optional')}>
        <Input value={goal} onChange={(e) => setGoal(e.target.value)} />
      </Field>
    </div>
  )

  const estimateRow = (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto]">
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
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-medium leading-tight tracking-[-0.02em] md:text-[26px]">{t('clarify.title')}</h1>
          <p className="mt-1 text-[14px] text-ink-2">{t('clarify.subtitle')}</p>
        </div>
        <span className="tnum shrink-0 whitespace-nowrap text-[13px] text-ink-3">{t('clarify.progress', { current: index + 1, total: inbox.length })}</span>
      </div>

      {step === 'kind' ? (
        <div key={`${item.id}-kind`} className="card fade-in p-4 md:p-7">
          <textarea
            value={item.text}
            onChange={(e) => store.updateInboxItem(item.id, e.target.value)}
            rows={Math.min(8, Math.max(2, item.text.split('\n').length))}
            className="field-bare -mx-2 w-full resize-none px-2 py-1 text-[18px] leading-relaxed md:text-[21px]"
          />
          {autoClarify && (
            // one reserved line, so nothing jumps when the answer arrives
            <p className="mt-3 flex min-h-[20px] items-start gap-1.5 text-[13px] leading-snug text-ink-3">
              <Sparkles size={13} className="mt-[3px] shrink-0 text-accent" />
              <span className={cx(proposal?.status === 'done' && 'text-ink-2')}>
                {proposal?.status === 'done'
                  ? t('clarify.ai.proposal', {
                      summary: [
                        t(`clarify.kinds.${AI_KINDS[proposal.s.kind]}`),
                        proposed !== 'trash' && proposal.s.title && `„${proposal.s.title}“`,
                        proposed === 'project' ? proposal.s.newProjectName && proposal.s.newProjectName !== proposal.s.title && proposal.s.newProjectName : proposal.s.projectName,
                      ]
                        .filter(Boolean)
                        .join(' · '),
                    })
                  : proposal?.status === 'error'
                    ? proposal.message
                    : t('clarify.ai.thinking')}
              </span>
            </p>
          )}

          <div className="mt-8 mb-3 flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-3">{t('clarify.question')}</span>
            <span className="hidden text-[11px] text-ink-3 md:inline">{proposed ? t('clarify.keysProposal') : t('clarify.keys')}</span>
          </div>
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
            {TILES.map((k, i) => (
              <Tile key={k} label={t(`clarify.kinds.${k}`)} hint={t(`clarify.kinds.${k}Hint`)} shortcut={String(i + 1)} proposed={k === proposed} onClick={() => choose(k)} />
            ))}
            <Tile
              label={t('clarify.kinds.auto')}
              hint={
                proposal?.status === 'loading'
                  ? t('clarify.ai.thinking')
                  : proposed
                    ? t('clarify.ai.accept')
                    : proposal?.status === 'error' && autoClarify
                      ? t('clarify.ai.retry')
                      : t('clarify.kinds.autoHint')
              }
              shortcut="a"
              icon={<Sparkles size={14} className="text-accent" />}
              accent
              disabled={proposal?.status === 'loading' && awaiting === key}
              onClick={runAuto}
            />
          </div>
          {!autoClarify && awaiting === key && proposal?.status === 'error' && <p className="fade-in mt-3 text-[12px] text-rose">{proposal.message}</p>}

          <div className="mt-6 flex items-center justify-between border-t border-line pt-4">
            <Button variant="ghost" onClick={() => choose('trash')} className={cx('hover:text-rose', proposed === 'trash' ? 'text-rose' : 'text-ink-3')}>
              <Trash2 size={14} /> {t('clarify.kinds.trash')} <span className="ml-1 hidden text-[11px] text-ink-3 md:inline">6</span>
            </Button>
            <Button variant="ghost" onClick={skip}>
              {t('clarify.form.skip')}
            </Button>
          </div>
        </div>
      ) : (
        <div key={`${item.id}-form`} className="card fade-in p-4 md:p-7">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setStep('kind')} className="flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
              <ArrowLeft size={13} /> {t('clarify.back')}
            </button>
            <span className="text-ink-3">·</span>
            <span className="text-[13px] font-medium">{ai.status === 'done' ? t('clarify.aiSuggests', { kind: t(`clarify.kinds.${kind}`) }) : t(`clarify.kinds.${kind}`)}</span>
          </div>
          {ai.status === 'done' && ai.message && <p className="mt-2 text-[12px] leading-relaxed text-ink-3">{ai.message}</p>}
          <p className="mt-3 line-clamp-3 whitespace-pre-wrap text-[14px] leading-relaxed text-ink-2">{item.text}</p>
          {related && <p className="fade-in mt-4 text-[13px] text-ink">{t(`clarify.related.${related.relation}`, { title: related.title })}</p>}

          <form
            onSubmit={(e) => {
              e.preventDefault()
              save()
            }}
            className="mt-6 flex flex-col gap-4"
          >
            {!asNote && (
              <>
                {kind === 'task' && (
                  <>
                    <Field label={t('clarify.form.title')} hint={t('clarify.form.titleHint')}>
                      <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
                    </Field>
                    {projectSelect}
                    {newProjectFields}
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
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                    {newProjectFields}
                  </>
                )}

                {kind === 'someday' && (
                  <>
                    <Field label={t('clarify.form.title')}>
                      <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
                    </Field>
                    {projectSelect}
                    {newProjectFields}
                    {!projectId && privateToggle}
                  </>
                )}

                {kind === 'trash' && <p className="text-[13px] text-ink-2">{t('clarify.kinds.trashHint')}.</p>}
              </>
            )}
            {formError && <p className="text-[12px] text-rose">{formError}</p>}

            <div className="mt-2 flex flex-wrap items-center justify-between gap-y-2 border-t border-line pt-4">
              {/* on phones the header's "← Back" is enough; the row keeps room for the two actions */}
              <Button variant="ghost" onClick={() => setStep('kind')} className="max-sm:hidden">
                {t('clarify.back')}
              </Button>
              <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
                {related && (
                  // declines the link: saves without touching the other task, or (duplicate) shows the form for a new item
                  <Button variant="ghost" onClick={() => (asNote ? setRelated(null) : save(false))}>
                    {asNote ? t('clarify.related.createAnyway') : kind === 'trash' ? t('clarify.related.justTrash') : t('clarify.related.justSave')}
                  </Button>
                )}
                <Button variant="primary" type="submit">
                  {asNote
                    ? t('clarify.related.addNote')
                    : related
                      ? kind === 'trash'
                        ? t('clarify.related.tickAndNext')
                        : t('clarify.related.tickAndSave')
                      : kind === 'trash'
                        ? t('clarify.confirmTrash')
                        : t('clarify.form.save')}
                </Button>
              </div>
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
  proposed,
  disabled,
}: {
  label: string
  hint: string
  shortcut: string
  onClick: () => void
  icon?: React.ReactNode
  accent?: boolean
  /** The AI's proposal: marked, Enter takes it. */
  proposed?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'flex min-h-[84px] flex-col items-start rounded-xl border px-4 py-3 text-left transition-colors disabled:opacity-50',
        accent
          ? 'border-accent/40 bg-accent-soft/40 hover:bg-accent-soft'
          : proposed
            ? 'border-accent bg-surface ring-1 ring-accent hover:bg-surface-2'
            : 'border-line bg-surface hover:border-line-2 hover:bg-surface-2',
      )}
    >
      <span className="flex w-full items-center justify-between text-[15px] font-medium">
        <span className="flex items-center gap-1.5">
          {icon}
          {label}
        </span>
        <span className="hidden text-[11px] text-ink-3 md:inline">{shortcut}</span>
      </span>
      <span className="mt-1 text-[12.5px] leading-snug text-ink-2">{hint}</span>
    </button>
  )
}
