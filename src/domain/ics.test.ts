import { describe, expect, it } from 'vitest'
import { parseIcs } from './ics'

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:a1
SUMMARY:Team sync
DTSTART;TZID=W. Europe Standard Time:20261020T100000
DTEND;TZID=W. Europe Standard Time:20261020T103000
LOCATION:Microsoft Teams Meeting
X-MICROSOFT-CDO-BUSYSTATUS:BUSY
END:VEVENT
BEGIN:VEVENT
UID:a2
SUMMARY:Alex holiday
DTSTART;VALUE=DATE:20261021
DTEND;VALUE=DATE:20261022
X-MICROSOFT-CDO-BUSYSTATUS:FREE
END:VEVENT
BEGIN:VEVENT
UID:a3
SUMMARY:Reminder
DTSTART:20261022T080000Z
DTEND:20261022T081500Z
TRANSP:TRANSPARENT
END:VEVENT
BEGIN:VEVENT
UID:a4
SUMMARY:Cancelled thing
STATUS:CANCELLED
DTSTART:20261023T080000Z
DTEND:20261023T090000Z
END:VEVENT
BEGIN:VEVENT
UID:a5
SUMMARY:Weekly workshop
DTSTART;TZID=W. Europe Standard Time:20261024T090000
DTEND;TZID=W. Europe Standard Time:20261024T130000
RRULE:FREQ=WEEKLY;COUNT=4
END:VEVENT
END:VCALENDAR
`

describe('parseIcs', () => {
  const result = parseIcs(ICS)
  it('imports events, skips cancelled ones, counts recurring series', () => {
    expect(result.events).toHaveLength(4)
    expect(result.skippedRecurring).toBe(1)
    expect(result.events.map((e) => e.title)).not.toContain('Cancelled thing')
  })
  it('derives availability from busy status and TRANSP', () => {
    const byTitle = Object.fromEntries(result.events.map((e) => [e.title, e]))
    expect(byTitle['Team sync'].availability).toBe('busy')
    expect(byTitle['Alex holiday'].availability).toBe('free')
    expect(byTitle['Alex holiday'].allDay).toBe(true)
    expect(byTitle['Reminder'].availability).toBe('free')
  })
  it('guesses kinds and builds stable external ids', () => {
    const sync = result.events.find((e) => e.title === 'Team sync')!
    expect(sync.kind).toBe('online')
    expect(sync.externalId).toBe('a1#2026-10-20')
    expect(result.events.find((e) => e.title === 'Weekly workshop')!.kind).toBe('workshop')
  })
})

describe('private appointments', () => {
  it('marks CLASS:PRIVATE events as private', () => {
    const r = parseIcs(`BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:p1\nSUMMARY:Dentist\nCLASS:PRIVATE\nDTSTART:20261022T080000Z\nDTEND:20261022T084500Z\nEND:VEVENT\nBEGIN:VEVENT\nUID:p2\nSUMMARY:Public\nCLASS:PUBLIC\nDTSTART:20261022T090000Z\nDTEND:20261022T094500Z\nEND:VEVENT\nEND:VCALENDAR\n`)
    expect(r.events.find((e) => e.title === 'Dentist')!.private).toBe(true)
    expect(r.events.find((e) => e.title === 'Public')!.private).toBeUndefined()
  })
})

describe('multi-day events and escapes', () => {
  it('splits overnight and multi-day events per day and unescapes semicolons', () => {
    const r = parseIcs(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:o1
SUMMARY:Dinner\; late
DTSTART:20261020T200000
DTEND:20261021T010000
END:VEVENT
BEGIN:VEVENT
UID:w2
SUMMARY:Two-day workshop
DTSTART:20261022T090000
DTEND:20261023T170000
END:VEVENT
BEGIN:VEVENT
UID:h3
SUMMARY:Trip
DTSTART;VALUE=DATE:20261026
DTEND;VALUE=DATE:20261029
END:VEVENT
END:VCALENDAR
`)
    const dinner = r.events.filter((e) => e.externalId?.startsWith('o1#'))
    expect(dinner.map((e) => [e.date, e.start, e.end])).toEqual([
      ['2026-10-20', '20:00', '23:59'],
      ['2026-10-21', '00:00', '01:00'],
    ])
    expect(dinner[0].title).toBe('Dinner; late')
    const ws = r.events.filter((e) => e.externalId?.startsWith('w2#'))
    expect(ws.map((e) => [e.date, e.start, e.end])).toEqual([
      ['2026-10-22', '09:00', '23:59'],
      ['2026-10-23', '00:00', '17:00'],
    ])
    const trip = r.events.filter((e) => e.externalId?.startsWith('h3#'))
    expect(trip.map((e) => e.date)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28'])
    expect(trip.every((e) => e.allDay)).toBe(true)
  })
})
