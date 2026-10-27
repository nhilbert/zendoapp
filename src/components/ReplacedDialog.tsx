import { useTranslation } from 'react-i18next'
import { useUi } from '@/store/useUi'
import { useStore } from '@/store/useStore'
import { useSync, type Replaced } from '@/store/useSync'
import { dismissReplaced, restoreReplaced } from '@/sync/server'
import { BLOCK_SIZE_LABEL, type BlockSize } from '@/domain/types'
import { fmtDate, fmtTime, fmtWeekday } from '@/domain/dates'
import { useLocale } from './TaskBits'
import { Button, Modal } from './ui'

/** Label keys per field; per collection where the same field means something else. */
const LABELS: Record<string, string> = {
  title: 'task.title',
  description: 'task.description',
  projectId: 'task.project',
  status: 'task.status',
  priority: 'task.priority',
  estimateMinutes: 'task.estimate',
  dueDate: 'task.due',
  plannedDate: 'task.planned',
  recurrence: 'task.recurrence',
  waitingFor: 'task.waitingFor',
  private: 'privacy.private',
  notes: 'task.notes',
  name: 'project.name',
  goals: 'project.goals',
  color: 'project.color',
  date: 'event.date',
  kind: 'event.kind',
  location: 'event.location',
  availability: 'event.availability',
  joinUrl: 'event.meetingLink',
  text: 'sync.fieldText',
  size: 'sync.fieldSize',
  note: 'sync.fieldNote',
}
const LABELS_BY_COLLECTION: Record<string, Record<string, string>> = {
  projects: { notes: 'project.notes', status: 'project.status', dueDate: 'project.due' },
  events: { title: 'event.title', projectId: 'event.project' },
  reviews: { notes: 'review.journal' },
}
/** Shown with their group's main field only. */
const HIDDEN = new Set(['completedAt', 'statusBeforeDone', 'recurrenceAnchor'])
const PROJECT_STATUS: Record<string, string> = { active: 'statusActive', planned: 'statusPlanned', someday: 'statusSomeday', archived: 'statusArchived' }
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/** What a sync merge replaced, with a way back: shown from the quiet line under the sync status. */
export default function ReplacedDialog() {
  const { t } = useTranslation()
  const tk = t as unknown as (key: string, options?: Record<string, unknown>) => string
  const locale = useLocale()
  const open = useUi((s) => s.replacedOpen)
  const close = useUi((s) => s.closeReplaced)
  const replaced = useSync((s) => s.replaced)
  const projects = useStore((s) => s.projects)
  if (!open || !replaced.length) return null

  const day = (iso: string) => `${fmtWeekday(iso, locale)} ${fmtDate(iso, locale, { day: 'numeric', month: 'numeric' })}`
  const one = (r: Replaced, field: string, v: unknown): string => {
    if (v === undefined || v === null || v === '') return ''
    if (field === 'status') return r.collection === 'projects' ? tk(`project.${PROJECT_STATUS[String(v)] ?? 'status'}`) : tk(`status.${String(v)}`)
    if (field === 'priority') return tk(`priority.${String(v)}`)
    if (field === 'recurrence') return tk(`recurrence.${String(v)}`)
    if (field === 'kind') return tk(`event.kinds.${String(v)}`)
    if (field === 'availability') return tk(`availability.${String(v)}`)
    if (field === 'projectId') return projects.find((p) => p.id === v)?.name ?? ''
    if (field === 'size') return BLOCK_SIZE_LABEL[v as BlockSize] ?? String(v)
    if (field === 'estimateMinutes') return tk('common.minutes', { count: Number(v) })
    if (field === 'start' || field === 'end' || field === 'plannedStart') return fmtTime(String(v), locale)
    if (typeof v === 'boolean') return v ? tk('common.yes') : tk('common.no')
    if (isDay(v)) return day(v)
    if (Array.isArray(v)) return v.map((x) => (x && typeof x === 'object' ? String((x as { text?: unknown }).text ?? '') : String(x))).filter(Boolean).join('; ')
    return String(v)
  }
  const value = (r: Replaced, values: Record<string, unknown> | undefined): string => {
    const fields = r.fields ?? []
    if (fields[0] === 'projectId' && !values?.projectId) return r.collection === 'tasks' ? t('task.chore') : '–'
    if (r.collection === 'events' && fields[0] === 'date' && values?.allDay && isDay(values.date)) return `${day(values.date)} · ${t('event.allDay')}`
    if (r.collection === 'events' && fields[0] === 'date') return [values?.date && one(r, 'date', values.date), [values?.start, values?.end].filter(Boolean).map((x) => one(r, 'start', x)).join('–')].filter(Boolean).join(' ')
    const parts = fields.filter((f) => !HIDDEN.has(f)).map((f) => one(r, f, values?.[f]))
    return parts.filter(Boolean).join(fields[0] === 'status' ? ' – ' : ' ') || '–'
  }
  const label = (r: Replaced) => {
    const f = r.fields?.[0] ?? ''
    return tk(LABELS_BY_COLLECTION[r.collection]?.[f] ?? LABELS[f] ?? f) || f
  }
  const when = (iso: string) => {
    const d = new Date(iso)
    const today = new Date().toDateString() === d.toDateString()
    return new Intl.DateTimeFormat(locale, today ? { timeStyle: 'short' } : { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d)
  }

  return (
    <Modal open onClose={close} width="max-w-lg">
      <h2 className="text-[17px] font-medium">{t('sync.replacedTitle')}</h2>
      <ul className="mt-4 flex flex-col divide-y divide-line">
        {replaced.map((r) => {
          const old = r.kind === 'field' ? value(r, r.replaced) : ''
          return (
            <li key={`${r.collection}:${r.id}:${r.kind}:${(r.fields ?? []).join(',')}`} className="py-3 first:pt-0 last:pb-0">
              <p className="text-[14px] text-ink">{r.label || t('common.noTitle')}</p>
              {r.kind === 'field' ? (
                <>
                  <p className="mt-1 text-[13px] text-ink-2">
                    {label(r)}: {value(r, r.kept)}
                  </p>
                  <p className="text-[13px] text-ink-3">
                    {t('sync.replacedBy', { value: old, side: r.from === 'browser' ? t('sync.sideBrowser') : t('sync.sideServer'), time: when(r.replacedAt) })}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-[13px] text-ink-2">{r.from === 'browser' ? t('sync.keptDeletedHere') : t('sync.keptDeletedThere')}</p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => restoreReplaced(r)}>
                  {r.kind === 'kept' ? t('sync.deleteAnyway') : old !== '–' && old.length <= 28 ? t('sync.restoreValue', { value: old }) : t('sync.restore')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => dismissReplaced(r)}>
                  {t('sync.fine')}
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
    </Modal>
  )
}
