/**
 * Pure mapping from Microsoft Graph calendarView items to Zendo CalendarEvent objects.
 * No I/O here so it can be unit-tested. Keep guessKind in sync with src/domain/ics.ts.
 */
import type { Availability, CalendarEvent, EventKind } from '../src/domain/types.ts'

export interface GraphEvent {
  id: string
  subject?: string | null
  start: { dateTime: string }
  end: { dateTime: string }
  showAs?: string | null
  sensitivity?: string | null
  isAllDay?: boolean
  isCancelled?: boolean
  isOnlineMeeting?: boolean
  onlineMeetingUrl?: string | null
  location?: { displayName?: string | null } | null
}

export type MappedEvent = Omit<CalendarEvent, 'id'>

export function guessKind(title: string | null | undefined, location: string | undefined, isOnline: boolean): EventKind {
  const hay = `${title ?? ''} ${location ?? ''}`.toLowerCase()
  if (isOnline || /teams|zoom|webex|meet\.google|http|online|video/.test(hay)) return 'online'
  if (/workshop|training|seminar|klausur|retreat/.test(hay)) return 'workshop'
  if (/coaching|supervision/.test(hay)) return 'coaching'
  if (location && location.trim()) return 'in_person'
  return 'other'
}

/** Graph `showAs`: free | tentative | busy | oof | workingElsewhere | unknown */
export function mapAvailability(showAs: string | null | undefined): Availability {
  switch ((showAs ?? '').toLowerCase()) {
    case 'free':
      return 'free'
    case 'tentative':
      return 'tentative'
    case 'oof':
      return 'oof'
    default:
      return 'busy'
  }
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + n))
  return date.toISOString().slice(0, 10)
}

/**
 * @param items Graph event objects (with Prefer: outlook.timezone applied, so dateTime is local wall-clock time)
 * @param range { from, to } inclusive ISO dates; events outside are dropped
 */
export function mapGraphEvents(items: GraphEvent[], { from, to }: { from: string; to: string }): MappedEvent[] {
  const events: MappedEvent[] = []
  for (const item of items) {
    if (item.isCancelled) continue
    const title = item.subject?.trim() || '(untitled)'
    const location = item.location?.displayName?.trim() || undefined
    const kind = guessKind(title, location, !!item.isOnlineMeeting || !!item.onlineMeetingUrl)
    const availability = mapAvailability(item.showAs)
    const isPrivate: true | undefined = ['private', 'personal', 'confidential'].includes((item.sensitivity ?? '').toLowerCase()) || undefined
    const startDate = item.start.dateTime.slice(0, 10)
    const endDate = item.end.dateTime.slice(0, 10)
    if (item.isAllDay) {
      // Graph all-day events end at 00:00 of the day AFTER the last day. Expand to one entry per day.
      for (let d = startDate; d < endDate; d = addDays(d, 1)) {
        if (d < from || d > to) continue
        events.push({ title, date: d, start: '00:00', end: '23:59', allDay: true, kind, availability, private: isPrivate, location, source: 'm365', externalId: `${item.id}#${d}` })
      }
      continue
    }
    const startTime = item.start.dateTime.slice(11, 16)
    const endTime = item.end.dateTime.slice(11, 16)
    // Timed events that cross midnight (overnight, multi-day workshops) become one entry per day.
    const days: { date: string; start: string; end: string }[] = []
    if (endDate <= startDate) days.push({ date: startDate, start: startTime, end: endTime })
    else {
      days.push({ date: startDate, start: startTime, end: '23:59' })
      for (let d = addDays(startDate, 1); d < endDate && days.length < 366; d = addDays(d, 1)) days.push({ date: d, start: '00:00', end: '23:59' })
      if (endTime !== '00:00') days.push({ date: endDate, start: '00:00', end: endTime })
    }
    for (const day of days) {
      if (day.date < from || day.date > to) continue
      events.push({ title, ...day, allDay: false, kind, availability, private: isPrivate, location, source: 'm365', externalId: `${item.id}#${day.date}` })
    }
  }
  return events
}
