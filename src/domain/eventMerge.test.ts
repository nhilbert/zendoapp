import { describe, expect, it } from 'vitest'
import { mergeImportedEvents, type ImportedEvent } from './eventMerge'
import type { CalendarEvent } from './types'

const ev = (p: Partial<CalendarEvent> & { externalId: string }): ImportedEvent => ({ title: 'M', date: p.externalId.split('#')[1], start: '10:00', end: '11:00', kind: 'online', source: 'm365', ...p })
let n = 0
const known = (p: Partial<CalendarEvent> & { externalId: string }): CalendarEvent => ({ id: `old${++n}`, ...ev(p) })

describe('mergeImportedEvents', () => {
  it('keeps id and overrides of known events and removes the rest', () => {
    const a = known({ externalId: 'a#2026-10-21', kind: 'workshop', projectId: 'p', private: true })
    const gone = known({ externalId: 'b#2026-10-22' })
    const r = mergeImportedEvents([a, gone], [ev({ externalId: 'a#2026-10-21', start: '14:00' }), ev({ externalId: 'c#2026-10-23' })])
    expect(r).toMatchObject({ total: 2, kept: 1, removed: 1 })
    expect(r.events[0]).toMatchObject({ id: a.id, kind: 'workshop', projectId: 'p', private: true, start: '14:00' })
    expect(r.events[1].id).not.toBe(gone.id)
  })

  it('recognises a meeting moved to another day by its calendar id (CAL-11)', () => {
    const a = known({ externalId: 'a#2026-10-21', projectId: 'p' })
    const r = mergeImportedEvents([a], [ev({ externalId: 'a#2026-10-23' })])
    expect(r).toMatchObject({ kept: 1, removed: 0 })
    expect(r.events[0]).toMatchObject({ id: a.id, date: '2026-10-23', projectId: 'p' })
  })

  it('does not guess when a multi-day meeting moves as a whole', () => {
    const old = [known({ externalId: 'w#2026-10-21', projectId: 'p' }), known({ externalId: 'w#2026-10-22', projectId: 'p' })]
    const r = mergeImportedEvents(old, [ev({ externalId: 'w#2026-10-28' }), ev({ externalId: 'w#2026-10-29' })])
    expect(r).toMatchObject({ kept: 0, removed: 2 })
    expect(r.events.every((e) => e.projectId === undefined)).toBe(true)
  })

  it('links new occurrences of a linked series, but keeps a known occurrence set differently (CAL-10)', () => {
    const projects = [{ id: 'p', meetingSeries: ['S'] }]
    const exception = known({ externalId: 'o1#2026-10-21', seriesId: 'S', projectId: null })
    const r = mergeImportedEvents([exception], [ev({ externalId: 'o1#2026-10-21', seriesId: 'S' }), ev({ externalId: 'o2#2026-10-28', seriesId: 'S' }), ev({ externalId: 'x#2026-10-28' })], { projects })
    expect(r.events.map((e) => e.projectId)).toEqual([null, 'p', undefined])
  })

  it('keeps linked meetings older than the window until the cutoff (CAL-12)', () => {
    const window = { windowFrom: '2026-10-12', keepLinkedSince: '2025-10-20' }
    const linkedPast = known({ externalId: 'l#2026-09-01', projectId: 'p' })
    const unlinkedPast = known({ externalId: 'u#2026-09-01' })
    const tooOld = known({ externalId: 't#2025-10-01', projectId: 'p' })
    const cancelledInWindow = known({ externalId: 'c#2026-10-14', projectId: 'p' })
    const r = mergeImportedEvents([linkedPast, unlinkedPast, tooOld, cancelledInWindow], [], window)
    expect(r.events.map((e) => e.id)).toEqual([linkedPast.id])
    expect(r).toMatchObject({ total: 0, kept: 0, removed: 3 })
  })

  it('without a window, nothing outside the import is kept', () => {
    const r = mergeImportedEvents([known({ externalId: 'l#2026-09-01', projectId: 'p' })], [])
    expect(r.events).toEqual([])
  })
})
