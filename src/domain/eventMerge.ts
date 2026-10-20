/**
 * Merge a fresh calendar import (Outlook sync or ICS file) into the events Zendo already has from that source.
 * Pure, shared by the server sync (server/repo.ts) and the ICS import in the store.
 *  - Known events (same externalId) keep their id and the owner's choices: kind, project, private flag.
 *  - A meeting moved to another day has a new externalId (id#date); it is still recognised by its id when
 *    that is unambiguous (CAL-11).
 *  - New occurrences of a series linked to a project (Project.meetingSeries) get that project (CAL-10).
 *  - With a window: linked events older than the window are history and kept until `keepLinkedSince` (CAL-12).
 *  Everything else that is not in the import is removed.
 */
import type { CalendarEvent, ISODate, Project } from './types.ts'

export type ImportedEvent = Omit<CalendarEvent, 'id'> & { id?: string }

export interface MergeOptions {
  projects?: Pick<Project, 'id' | 'meetingSeries'>[]
  /** first day of the import window: linked events before it are history, not removals */
  windowFrom?: ISODate
  /** linked history before this day is dropped */
  keepLinkedSince?: ISODate
  newId?: () => string
}

export interface MergeResult {
  /** the source's events after the import: merged import plus kept history */
  events: CalendarEvent[]
  total: number
  kept: number
  removed: number
}

/** `AAMk…#2026-10-20` → `AAMk…`: the calendar's own id without the day. */
function baseOf(externalId: string): string {
  const i = externalId.lastIndexOf('#')
  return i < 0 ? externalId : externalId.slice(0, i)
}

function groupBy<T>(items: T[], key: (item: T) => string | undefined): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const k = key(item)
    if (k === undefined) continue
    map.set(k, [...(map.get(k) ?? []), item])
  }
  return map
}

export function mergeImportedEvents(previous: CalendarEvent[], incoming: ImportedEvent[], options: MergeOptions = {}): MergeResult {
  const { projects = [], windowFrom, keepLinkedSince, newId = () => crypto.randomUUID() } = options
  const matches = new Map<number, CalendarEvent>()
  const used = new Set<string>()

  const byKey = new Map(previous.filter((e) => e.externalId).map((e) => [e.externalId!, e]))
  incoming.forEach((ev, i) => {
    const prev = ev.externalId ? byKey.get(ev.externalId) : undefined
    if (prev && !used.has(prev.id)) {
      matches.set(i, prev)
      used.add(prev.id)
    }
  })

  // Moved to another day: one unmatched old entry and one unmatched new entry with the same calendar id.
  // Multi-day meetings have several entries per id and are left alone.
  const leftOld = groupBy(previous.filter((e) => !used.has(e.id)), (e) => (e.externalId ? baseOf(e.externalId) : undefined))
  const leftNew = groupBy(
    incoming.map((ev, i) => ({ ev, i })).filter(({ i }) => !matches.has(i)),
    ({ ev }) => (ev.externalId ? baseOf(ev.externalId) : undefined),
  )
  for (const [base, news] of leftNew) {
    const olds = leftOld.get(base)
    if (news.length === 1 && olds?.length === 1) {
      matches.set(news[0].i, olds[0])
      used.add(olds[0].id)
    }
  }

  const seriesProject = new Map<string, string>()
  for (const p of projects) for (const s of p.meetingSeries ?? []) seriesProject.set(s, p.id)

  const merged: CalendarEvent[] = incoming.map((ev, i) => {
    const prev = matches.get(i)
    if (prev) return { ...ev, id: prev.id, kind: prev.kind, projectId: prev.projectId, private: prev.private ?? ev.private }
    const fromSeries = ev.seriesId ? seriesProject.get(ev.seriesId) : undefined
    return { ...ev, id: ev.id ?? newId(), ...(fromSeries ? { projectId: fromSeries } : {}) }
  })

  const history = previous.filter(
    (e) => !used.has(e.id) && !!e.projectId && windowFrom !== undefined && e.date < windowFrom && (keepLinkedSince === undefined || e.date >= keepLinkedSince),
  )
  return {
    events: [...merged, ...history],
    total: incoming.length,
    kept: matches.size,
    removed: previous.length - used.size - history.length,
  }
}
