import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { compareProjects } from '@/domain/selectors'
import type { Availability, CalendarEvent, EventKind } from '@/domain/types'
import { AVAILABILITIES, EVENT_KINDS } from '@/domain/types'
import { isHHMM, isISODate, todayISO } from '@/domain/dates'
import { useStore } from '@/store/useStore'
import { useUi } from '@/store/useUi'
import { safeJoinUrl } from '@/domain/meeting'
import { Button, Checkbox, Field, Input, Modal, Segmented, Select } from './ui'
import { JoinLink } from './JoinLink'

type Draft = Omit<CalendarEvent, 'id' | 'source'>
type SeriesScope = 'one' | 'series'

const EMPTY: Draft = { title: '', date: todayISO(), start: '09:00', end: '10:00', kind: 'online', availability: 'busy', location: '', joinUrl: '', projectId: null, allDay: false }

/** Date must be a real date; unless all-day, start and end must be times and end after start. */
export function isValidEventTimes(d: { date: string; start: string; end: string; allDay?: boolean }): boolean {
  if (!isISODate(d.date)) return false
  if (d.allDay) return true
  return isHHMM(d.start) && isHHMM(d.end) && d.end > d.start
}

export default function EventDialog() {
  const { t } = useTranslation()
  const ui = useUi((s) => s.event)
  const close = useUi((s) => s.closeEvent)
  const existing = useStore((s) => (ui?.id ? s.events.find((e) => e.id === ui.id) : undefined))
  const projects = useStore((s) => s.projects)
  const addEvent = useStore((s) => s.addEvent)
  const updateEvent = useStore((s) => s.updateEvent)
  const deleteEvent = useStore((s) => s.deleteEvent)
  const linkSeries = useStore((s) => s.linkSeries)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [scope, setScope] = useState<SeriesScope>('series')
  const seriesProject = existing?.seriesId ? projects.find((p) => p.meetingSeries?.includes(existing.seriesId!)) : undefined

  // A fresh draft when the dialog opens (or opens another event) – not when a sync replaces the stored
  // record meanwhile, which would throw away what is being typed.
  useEffect(() => {
    if (!ui) return
    setError(null)
    if (existing) {
      setDraft({ ...existing })
      // A meeting that follows its series changes the series by default; an exception changes only itself.
      setScope((existing.projectId ?? null) === (seriesProject?.id ?? null) ? 'series' : 'one')
    } else {
      setDraft({ ...EMPTY, date: todayISO(), ...ui.draft })
    }
  }, [ui, existing?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!ui) return null
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))
  const askScope = !!existing?.seriesId && (draft.projectId ?? null) !== (existing.projectId ?? null)

  const save = () => {
    if (!draft.title.trim()) return
    if (!isValidEventTimes(draft)) {
      setError(t('event.invalidTimes'))
      return
    }
    const joinUrl = safeJoinUrl(draft.joinUrl)
    if (draft.joinUrl?.trim() && !joinUrl) {
      setError(t('event.invalidLink'))
      return
    }
    const clean = { ...(draft.allDay ? { ...draft, start: '00:00', end: '23:59' } : draft), joinUrl }
    if (existing) {
      updateEvent(existing.id, clean)
      if (askScope && scope === 'series') linkSeries(existing.seriesId!, clean.projectId ?? null)
    } else addEvent(clean)
    close()
  }

  return (
    <Modal open onClose={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
        className="flex flex-col gap-4"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="min-w-0 truncate text-[16px] font-medium">{existing ? existing.title : t('event.new')}</h2>
          {existing && <JoinLink event={existing} />}
        </div>
        <Field label={t('event.title')}>
          <Input autoFocus value={draft.title} onChange={(e) => set({ title: e.target.value })} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t('event.date')}>
            <Input type="date" value={draft.date} onChange={(e) => set({ date: e.target.value })} />
          </Field>
          <Field label={t('event.start')}>
            <Input type="time" step={900} value={draft.start} disabled={draft.allDay} onChange={(e) => set({ start: e.target.value })} />
          </Field>
          <Field label={t('event.end')}>
            <Input type="time" step={900} value={draft.end} disabled={draft.allDay} onChange={(e) => set({ end: e.target.value })} />
          </Field>
        </div>
        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            <Checkbox checked={!!draft.allDay} onChange={(v) => set({ allDay: v })} /> {t('event.allDay')}
          </label>
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            <Checkbox checked={!!draft.private} onChange={(v) => set({ private: v })} /> {t('privacy.private')}
          </label>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('event.kind')}>
            <Select value={draft.kind} onChange={(e) => set({ kind: e.target.value as EventKind })}>
              {EVENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`event.kinds.${k}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('event.project')} hint={existing?.seriesId ? (seriesProject ? t('event.seriesOf', { name: seriesProject.name }) : t('event.recurring')) : undefined}>
            <Select value={draft.projectId ?? ''} onChange={(e) => set({ projectId: e.target.value || null })}>
              <option value="">{t('common.none')}</option>
              {projects
                .filter((p) => p.status === 'active' || p.status === 'planned' || p.id === draft.projectId)
                .sort(compareProjects)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </Select>
          </Field>
        </div>
        {askScope && (
          <div className="-mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink-2">
            {t('event.applyTo')}
            <Segmented<SeriesScope>
              size="sm"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'one', label: t('event.applyOne') },
                { value: 'series', label: t('event.applySeries') },
              ]}
            />
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('event.location')} hint={t('common.optional')}>
            <Input value={draft.location ?? ''} onChange={(e) => set({ location: e.target.value })} />
          </Field>
          <Field label={t('event.availability')}>
            <Select value={draft.availability ?? 'busy'} onChange={(e) => set({ availability: e.target.value as Availability })}>
              {AVAILABILITIES.map((a) => (
                <option key={a} value={a}>
                  {t(`availability.${a}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t('event.meetingLink')} hint={t('event.meetingLinkHint')}>
          <Input type="url" inputMode="url" placeholder="https://" value={draft.joinUrl ?? ''} onChange={(e) => set({ joinUrl: e.target.value })} />
        </Field>
        {error && <p className="text-[12px] text-rose">{error}</p>}
        <div className="mt-2 flex items-center justify-between">
          {existing ? (
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                deleteEvent(existing.id)
                close()
              }}
            >
              {t('common.delete')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" type="submit">
              {t('common.save')}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
