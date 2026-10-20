import type { Availability, CalendarEvent, EventKind, ISODate } from './types.ts'
import { addDaysISO, toISODate } from './dates.ts'
import { findMeetingUrl, safeJoinUrl } from './meeting.ts'

/**
 * Minimal iCalendar (.ics) parser – enough for a prototype import of an Outlook
 * calendar export. Handles line unfolding, DTSTART/DTEND with TZID/Z/DATE forms.
 * Recurring series (RRULE) are NOT expanded: only the first occurrence is
 * imported and flagged in the result. A later iteration moves this to the
 * local server (calendarView via Microsoft Graph or a published ICS feed).
 *
 * Free/busy: Outlook writes X-MICROSOFT-CDO-BUSYSTATUS (FREE, TENTATIVE, BUSY,
 * OOF, WORKINGELSEWHERE) and the standard TRANSP (TRANSPARENT = free). Events
 * shown as free (reminders, other people's holidays) are imported but never
 * block time. Cancelled events are skipped.
 */
export interface IcsImportResult {
  events: CalendarEvent[]
  skippedRecurring: number
}

function unfold(text: string): string[] {
  const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const lines: string[] = []
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length) lines[lines.length - 1] += line.slice(1)
    else lines.push(line)
  }
  return lines
}

function parseProp(line: string): { name: string; params: Record<string, string>; value: string } | null {
  const idx = line.indexOf(':')
  if (idx < 0) return null
  const left = line.slice(0, idx)
  const value = line.slice(idx + 1)
  const [name, ...paramParts] = left.split(';')
  const params: Record<string, string> = {}
  for (const p of paramParts) {
    const [k, v] = p.split('=')
    if (k && v) params[k.toUpperCase()] = v
  }
  return { name: name.toUpperCase(), params, value }
}

function parseDateTime(value: string, params: Record<string, string>): { date: ISODate; time?: string } {
  if (params.VALUE === 'DATE' || /^\d{8}$/.test(value)) {
    return { date: `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` }
  }
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/)
  if (!m) return { date: value.slice(0, 10) }
  const [, y, mo, d, h, mi, s, z] = m
  if (z) {
    const utc = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0)))
    return { date: toISODate(utc), time: `${String(utc.getHours()).padStart(2, '0')}:${String(utc.getMinutes()).padStart(2, '0')}` }
  }
  // TZID or floating time: treat as local wall-clock time (good enough for a local single-timezone user)
  return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}` }
}

function unescapeText(v: string): string {
  return v.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\')
}

export function guessKind(title: string, location?: string): EventKind {
  const hay = `${title} ${location ?? ''}`.toLowerCase()
  if (/teams|zoom|webex|meet\.google|http|online|video/.test(hay)) return 'online'
  if (/workshop|training|seminar|klausur|retreat/.test(hay)) return 'workshop'
  if (/coaching|supervision/.test(hay)) return 'coaching'
  if (location && location.trim()) return 'in_person'
  return 'other'
}

function parseAvailability(busyStatus?: string, transp?: string): Availability {
  switch ((busyStatus ?? '').toUpperCase()) {
    case 'FREE':
      return 'free'
    case 'TENTATIVE':
      return 'tentative'
    case 'OOF':
      return 'oof'
    case 'BUSY':
    case 'WORKINGELSEWHERE':
      return 'busy'
  }
  return (transp ?? '').toUpperCase() === 'TRANSPARENT' ? 'free' : 'busy'
}

/** Split a (possibly multi-day) event into per-day {date,start,end} entries. */
export function expandDays(start: { date: ISODate; time?: string }, end: { date: ISODate; time?: string }): { date: ISODate; start: string; end: string }[] {
  const allDay = !start.time
  if (allDay) {
    const lastExclusive = end.date > start.date ? end.date : addDaysISO(start.date, 1)
    const days: { date: ISODate; start: string; end: string }[] = []
    for (let d = start.date; d < lastExclusive && days.length < 366; d = addDaysISO(d, 1)) days.push({ date: d, start: '00:00', end: '23:59' })
    return days
  }
  const startTime = start.time ?? '00:00'
  const endTime = end.time ?? startTime
  if (end.date <= start.date) return [{ date: start.date, start: startTime, end: endTime }]
  const days = [{ date: start.date, start: startTime, end: '23:59' }]
  for (let d = addDaysISO(start.date, 1); d < end.date && days.length < 366; d = addDaysISO(d, 1)) days.push({ date: d, start: '00:00', end: '23:59' })
  if (endTime !== '00:00') days.push({ date: end.date, start: '00:00', end: endTime })
  return days
}

export function parseIcs(text: string): IcsImportResult {
  const lines = unfold(text)
  const events: CalendarEvent[] = []
  let skippedRecurring = 0
  let cur: Record<string, { params: Record<string, string>; value: string }> | null = null
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      cur = {}
      continue
    }
    if (line === 'END:VEVENT' && cur) {
      const summary = cur.SUMMARY ? unescapeText(cur.SUMMARY.value) : '(untitled)'
      const location = cur.LOCATION ? unescapeText(cur.LOCATION.value) : undefined
      // Outlook exports the Teams link in its own property; Zoom and others sit in location or description.
      const joinUrl =
        safeJoinUrl(cur['X-MICROSOFT-SKYPETEAMSMEETINGURL']?.value) ?? findMeetingUrl(location, cur.URL?.value, cur.DESCRIPTION ? unescapeText(cur.DESCRIPTION.value) : undefined)
      if (cur.RRULE) skippedRecurring += 1
      const cancelled = (cur.STATUS?.value ?? '').toUpperCase() === 'CANCELLED'
      if (cur.DTSTART && !cancelled) {
        const start = parseDateTime(cur.DTSTART.value, cur.DTSTART.params)
        const end = cur.DTEND ? parseDateTime(cur.DTEND.value, cur.DTEND.params) : start
        const allDay = !start.time
        const uid = cur.UID?.value ?? `${summary}@${start.date}`
        const base = {
          title: summary,
          allDay,
          kind: guessKind(summary, location),
          availability: parseAvailability(cur['X-MICROSOFT-CDO-BUSYSTATUS']?.value, cur.TRANSP?.value),
          private: /^(PRIVATE|CONFIDENTIAL)$/i.test(cur.CLASS?.value ?? '') || undefined,
          location,
          joinUrl,
          source: 'ics' as const,
        }
        // Multi-day events become one entry per day (DTEND is exclusive for all-day events).
        // UID plus date keeps recurrence exceptions and moved meetings distinct and stable.
        for (const day of expandDays(start, end)) {
          events.push({ id: crypto.randomUUID(), ...base, ...day, externalId: `${uid}#${day.date}` })
        }
      }
      cur = null
      continue
    }
    if (cur) {
      const p = parseProp(line)
      if (p) cur[p.name] = { params: p.params, value: p.value }
    }
  }
  return { events, skippedRecurring }
}
