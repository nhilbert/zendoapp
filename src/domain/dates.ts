import type { HHMM, ISODate, Recurrence } from './types.ts'

/** Local calendar date → 'YYYY-MM-DD' (never uses UTC, so no off-by-one around midnight). */
export function toISODate(d: Date): ISODate {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function fromISODate(iso: ISODate): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function todayISO(): ISODate {
  return toISODate(new Date())
}

export function addDaysISO(iso: ISODate, days: number): ISODate {
  const d = fromISODate(iso)
  d.setDate(d.getDate() + days)
  return toISODate(d)
}

/** ISO weekday: 1 = Monday … 7 = Sunday */
export function isoWeekday(iso: ISODate): number {
  const js = fromISODate(iso).getDay()
  return js === 0 ? 7 : js
}

export function startOfWeekISO(iso: ISODate): ISODate {
  return addDaysISO(iso, 1 - isoWeekday(iso))
}

export function rangeISO(start: ISODate, days: number): ISODate[] {
  return Array.from({ length: days }, (_, i) => addDaysISO(start, i))
}

export function addMonthsISO(iso: ISODate, months: number): ISODate {
  const d = fromISODate(iso)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + months)
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, last))
  return toISODate(d)
}

export function nextOccurrence(iso: ISODate, recurrence: Recurrence): ISODate {
  switch (recurrence) {
    case 'daily':
      return addDaysISO(iso, 1)
    case 'weekly':
      return addDaysISO(iso, 7)
    case 'biweekly':
      return addDaysISO(iso, 14)
    case 'monthly':
      return addMonthsISO(iso, 1)
    case 'quarterly':
      return addMonthsISO(iso, 3)
    case 'yearly':
      return addMonthsISO(iso, 12)
  }
}

/**
 * The first occurrence of a series (anchored at `anchor`) that lies after `after`.
 * Month-based rules are computed from the anchor each time, so a chore on the 31st
 * returns to the 31st after a short month instead of drifting to the 28th.
 */
export function nextOccurrenceFrom(anchor: ISODate, recurrence: Recurrence, after: ISODate): ISODate {
  const step = (k: number): ISODate => {
    switch (recurrence) {
      case 'daily':
        return addDaysISO(anchor, k)
      case 'weekly':
        return addDaysISO(anchor, 7 * k)
      case 'biweekly':
        return addDaysISO(anchor, 14 * k)
      case 'monthly':
        return addMonthsISO(anchor, k)
      case 'quarterly':
        return addMonthsISO(anchor, 3 * k)
      case 'yearly':
        return addMonthsISO(anchor, 12 * k)
    }
  }
  for (let k = 1; k < 100_000; k++) {
    const d = step(k)
    if (d > after) return d
  }
  return addDaysISO(after, 1)
}

export function compareISO(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function daysBetween(a: ISODate, b: ISODate): number {
  const ms = fromISODate(b).getTime() - fromISODate(a).getTime()
  return Math.round(ms / 86_400_000)
}

export const isHHMM = (s: unknown): s is HHMM => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s)
export const isISODate = (s: unknown): s is ISODate => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(fromISODate(s).getTime())

export function hhmmToMinutes(t: HHMM): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + (m || 0)
}

export function minutesToHHMM(min: number): HHMM {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(min)))
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export function addMinutes(t: HHMM, minutes: number): HHMM {
  return minutesToHHMM(hhmmToMinutes(t) + minutes)
}

export function durationMinutes(start: HHMM, end: HHMM): number {
  return Math.max(0, hhmmToMinutes(end) - hhmmToMinutes(start))
}

export function nowHHMM(): HHMM {
  const d = new Date()
  return minutesToHHMM(d.getHours() * 60 + d.getMinutes())
}

export function isoWeekNumber(iso: ISODate): number {
  // ISO-8601 week number
  const d = fromISODate(iso)
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNr = (target.getUTCDay() + 6) % 7
  target.setUTCDate(target.getUTCDate() - dayNr + 3)
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4))
  const diff = (target.getTime() - firstThursday.getTime()) / 86_400_000
  return 1 + Math.round((diff - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)
}

/** Formatting helpers – all go through Intl so they follow the active locale. */
export function fmtDate(iso: ISODate, locale: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }): string {
  return new Intl.DateTimeFormat(locale, opts).format(fromISODate(iso))
}

export function fmtWeekday(iso: ISODate, locale: string, width: 'short' | 'long' = 'short'): string {
  return new Intl.DateTimeFormat(locale, { weekday: width }).format(fromISODate(iso))
}

export function fmtTime(t: HHMM, locale: string): string {
  if (!isHHMM(t)) return t || '–'
  const [h, m] = t.split(':').map(Number)
  const d = new Date(2000, 0, 1, h, m)
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(d)
}

export function fmtHours(minutes: number, locale: string): string {
  const h = minutes / 60
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(h)} h`
}
