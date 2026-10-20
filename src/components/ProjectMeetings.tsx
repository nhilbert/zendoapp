import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MapPin, Repeat, Video } from 'lucide-react'
import type { Project } from '@/domain/types'
import { fmtDate, fmtTime, fmtWeekday, nowHHMM, todayISO } from '@/domain/dates'
import { upcomingMeetings } from '@/domain/selectors'
import { useStore } from '@/store/useStore'
import { useUi } from '@/store/useUi'
import { useVisibleEvents, type VisibleEvent } from '@/store/visible'
import { Button, SectionLabel, Select } from './ui'
import { JoinLink } from './JoinLink'
import { useLocale } from './TaskBits'

/**
 * A project's upcoming meetings and a picker to link more (PRJ-10). Masked private meetings show
 * no project anywhere, so they are left out here too.
 */
export function ProjectMeetings({ project, readOnly }: { project: Project; readOnly?: boolean }) {
  const { t } = useTranslation()
  const locale = useLocale()
  const events = useVisibleEvents()
  const updateEvent = useStore((s) => s.updateEvent)
  const linkSeries = useStore((s) => s.linkSeries)
  const openEvent = useUi((s) => s.openEvent)
  const [pending, setPending] = useState<VisibleEvent | null>(null)

  const today = todayISO()
  const now = nowHHMM()
  const shown = events.filter((e) => !e.masked)
  const mine = upcomingMeetings(shown, project.id, today, now)
  const unlinked = upcomingMeetings(shown, null, today, now)
  const when = (e: VisibleEvent) => `${fmtWeekday(e.date, locale)} ${fmtDate(e.date, locale)}`

  const link = (e: VisibleEvent, scope: 'one' | 'series') => {
    if (scope === 'series' && e.seriesId) linkSeries(e.seriesId, project.id)
    else updateEvent(e.id, { projectId: project.id })
    setPending(null)
  }

  return (
    <div className="mt-10">
      <SectionLabel>{t('project.meetings')}</SectionLabel>
      {mine.length === 0 ? (
        <p className="text-[13px] text-ink-3">{t('project.noMeetings')}</p>
      ) : (
        <ul className="flex flex-col">
          {mine.map((e) => (
            <li key={e.id} className="flex items-center gap-2 rounded-lg px-2 hover:bg-surface-2">
              {/* phones: title first, date and time below; wider screens: one line */}
              <button type="button" onClick={() => openEvent(e.id)} className="flex min-w-0 flex-1 flex-col py-1.5 text-left text-[14px] md:flex-row md:items-center md:gap-2">
                <span className="tnum order-2 shrink-0 text-[12px] text-ink-3 md:order-1 md:w-52">
                  {when(e)} · {e.allDay ? t('event.allDay') : `${fmtTime(e.start, locale)}–${fmtTime(e.end, locale)}`}
                </span>
                <span className="order-1 flex min-w-0 items-center gap-2 md:order-2">
                  {e.kind === 'online' ? <Video size={12} className="shrink-0 text-ink-3" /> : <MapPin size={12} className="shrink-0 text-ink-3" />}
                  <span className="truncate">{e.title}</span>
                  {e.seriesId && <Repeat size={11} className="shrink-0 text-ink-3" aria-label={t('event.recurring')} />}
                </span>
              </button>
              <JoinLink event={e} />
            </li>
          ))}
        </ul>
      )}
      {!readOnly &&
        (pending ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 px-2 text-[13px] text-ink-2">
            <span className="min-w-0 truncate">{t('project.linkRecurring', { title: pending.title })}</span>
            <Button size="sm" onClick={() => link(pending, 'one')}>
              {t('event.applyOne')}
            </Button>
            <Button size="sm" variant="primary" onClick={() => link(pending, 'series')}>
              {t('event.applySeries')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        ) : (
          unlinked.length > 0 && (
            <Select
              value=""
              aria-label={t('project.addMeeting')}
              onChange={(ev) => {
                const e = unlinked.find((x) => x.id === ev.target.value)
                if (!e) return
                if (e.seriesId) setPending(e)
                else link(e, 'one')
              }}
              className="mt-2 h-8 w-auto max-w-full text-[13px] text-ink-2"
            >
              <option value="">{t('project.addMeeting')}</option>
              {unlinked.map((e) => (
                <option key={e.id} value={e.id}>
                  {when(e)}
                  {e.allDay ? '' : ` ${fmtTime(e.start, locale)}`} · {e.title}
                </option>
              ))}
            </Select>
          )
        ))}
    </div>
  )
}
