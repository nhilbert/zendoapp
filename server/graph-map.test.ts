import { describe, expect, it } from 'vitest'
import { mapAvailability, mapGraphEvents, type GraphEvent } from './graph-map.ts'

const item = (p: Partial<GraphEvent>): GraphEvent => ({ id: 'AAMk1', subject: 'Sync', start: { dateTime: '2026-10-20T10:00:00.0000000' }, end: { dateTime: '2026-10-20T10:30:00.0000000' }, showAs: 'busy', isAllDay: false, isCancelled: false, ...p })
const range = { from: '2026-10-19', to: '2026-10-25' }

describe('mapGraphEvents', () => {
  it('maps a timed event', () => {
    const [e] = mapGraphEvents([item({ isOnlineMeeting: true })], range)
    expect(e).toMatchObject({ title: 'Sync', date: '2026-10-20', start: '10:00', end: '10:30', allDay: false, kind: 'online', availability: 'busy', source: 'm365', externalId: 'AAMk1#2026-10-20' })
  })
  it('expands multi-day all-day events into one per day and keeps free status', () => {
    const events = mapGraphEvents([item({ id: 'H', subject: 'Alex holiday', isAllDay: true, showAs: 'free', start: { dateTime: '2026-10-21T00:00:00.0000000' }, end: { dateTime: '2026-10-24T00:00:00.0000000' } })], range)
    expect(events.map((e) => e.date)).toEqual(['2026-10-21', '2026-10-22', '2026-10-23'])
    expect(events.every((e) => e.allDay && e.availability === 'free')).toBe(true)
    expect(events[1].externalId).toBe('H#2026-10-22')
  })
  it('skips cancelled events and events outside the range', () => {
    const events = mapGraphEvents([item({ isCancelled: true }), item({ id: 'X', start: { dateTime: '2026-11-02T09:00:00' }, end: { dateTime: '2026-11-02T10:00:00' } })], range)
    expect(events).toHaveLength(0)
  })
  it('guesses workshop / in-person kinds from subject and location', () => {
    const [w, p] = mapGraphEvents(
      [item({ id: 'W', subject: 'Strategie-Workshop Tag 1', start: { dateTime: '2026-10-22T09:00:00' }, end: { dateTime: '2026-10-22T17:00:00' } }), item({ id: 'P', subject: 'Jour fixe', location: { displayName: 'Büro Köln' } })],
      range,
    )
    expect(w.kind).toBe('workshop')
    expect(p.kind).toBe('in_person')
  })
  it('maps showAs values', () => {
    expect(['free', 'tentative', 'busy', 'oof', 'workingElsewhere', undefined].map((v) => mapAvailability(v))).toEqual(['free', 'tentative', 'busy', 'oof', 'busy', 'busy'])
  })
})

describe('series', () => {
  it('carries the series id of recurring occurrences', () => {
    const [occ, single] = mapGraphEvents([item({ id: 'O1', seriesMasterId: 'SER' }), item({ id: 'S1', seriesMasterId: null })], range)
    expect(occ.seriesId).toBe('SER')
    expect(single.seriesId).toBeUndefined()
  })
})

describe('sensitivity', () => {
  it('maps private and personal sensitivity to private events', () => {
    const [a, b, c] = mapGraphEvents([item({ id: 'S1', sensitivity: 'private' }), item({ id: 'S2', sensitivity: 'personal' }), item({ id: 'S3', sensitivity: 'normal' })], range)
    expect([a.private, b.private, c.private]).toEqual([true, true, undefined])
  })
})

describe('timed multi-day events', () => {
  it('splits a two-day timed workshop into two entries', () => {
    const events = mapGraphEvents([item({ id: 'W2', subject: 'Workshop', start: { dateTime: '2026-10-22T09:00:00' }, end: { dateTime: '2026-10-23T17:00:00' } })], range)
    expect(events.map((e) => [e.date, e.start, e.end, e.externalId])).toEqual([
      ['2026-10-22', '09:00', '23:59', 'W2#2026-10-22'],
      ['2026-10-23', '00:00', '17:00', 'W2#2026-10-23'],
    ])
  })
})

describe('join links from Outlook', () => {
  const teams = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0?context=%7b%7d'
  it('takes the Teams link Outlook supplies, then the old field, then a Zoom link in location or body preview', () => {
    const [t, old, loc, body, none, bad] = mapGraphEvents(
      [
        item({ id: 'T', isOnlineMeeting: true, onlineMeeting: { joinUrl: teams }, bodyPreview: 'see https://zoom.us/j/1' }),
        item({ id: 'O', onlineMeetingUrl: 'https://teams.microsoft.com/l/meetup-join/old' }),
        item({ id: 'L', location: { displayName: 'https://us02web.zoom.us/j/81234567890?pwd=abc.1' } }),
        item({ id: 'B', subject: 'Strategy workshop', location: { displayName: 'Büro Köln' }, bodyPreview: 'Remote: Join Zoom Meeting https://zoom.us/j/555 Meeting ID: 555' }),
        item({ id: 'N', location: { displayName: 'Büro Köln' }, bodyPreview: 'Directions: https://maps.google.com/?q=koeln' }),
        item({ id: 'X', onlineMeeting: { joinUrl: 'javascript:alert(1)' } }),
      ],
      range,
    )
    expect(t.joinUrl).toBe(teams)
    expect(old.joinUrl).toBe('https://teams.microsoft.com/l/meetup-join/old')
    expect(loc.joinUrl).toBe('https://us02web.zoom.us/j/81234567890?pwd=abc.1')
    expect(body.joinUrl).toBe('https://zoom.us/j/555')
    // a link in the body does not turn a hybrid workshop into an online meeting (capacity rules differ)
    expect(body.kind).toBe('workshop')
    expect(none.joinUrl).toBeUndefined()
    expect(bad.joinUrl).toBeUndefined()
  })
})
