import { describe, expect, it } from 'vitest'
import type { CalendarEvent, PlanBlock, Project, Settings, Task } from './types'
import { DEFAULT_SETTINGS } from './types'
import { candidatesForDay, dayCapacity, isOverplanned, leftoverTasks, visibleBlocks } from './selectors'
import { isHHMM, isISODate, nextOccurrence } from './dates'

const settings: Settings = { ...DEFAULT_SETTINGS, workdayStart: '08:00', workdayEnd: '18:00', dayCapacityHours: 8 }
const ev = (p: Partial<CalendarEvent>): CalendarEvent => ({ id: 'x', title: 't', date: '2026-10-20', start: '09:00', end: '10:00', kind: 'online', source: 'manual', ...p })
const DATE = '2026-10-20' // a Tuesday

describe('dayCapacity', () => {
  it('counts ordinary meetings by duration', () => {
    const c = dayCapacity(DATE, settings, [ev({ start: '09:00', end: '10:30' })], [], [])
    expect(c.meetingMinutes).toBe(90)
    expect(c.freeMinutes).toBe(600 - 90)
    expect(c.fullDay).toBe(false)
  })
  it('ignores events shown as free', () => {
    const c = dayCapacity(DATE, settings, [ev({ availability: 'free', allDay: true }), ev({ availability: 'free', start: '09:00', end: '12:00' })], [], [])
    expect(c.meetingMinutes).toBe(0)
    expect(c.fullDay).toBe(false)
  })
  it('a short workshop costs at least half a day', () => {
    const c = dayCapacity(DATE, settings, [ev({ kind: 'workshop', start: '09:00', end: '12:00' })], [], [])
    expect(c.meetingMinutes).toBe(300)
    expect(c.fullDay).toBe(false)
  })
  it('a long workshop or an all-day busy event blocks the whole day', () => {
    const a = dayCapacity(DATE, settings, [ev({ kind: 'workshop', start: '09:00', end: '15:00' })], [], [])
    expect(a.fullDay).toBe(true)
    expect(a.freeMinutes).toBe(0)
    const b = dayCapacity(DATE, settings, [ev({ allDay: true, availability: 'oof' })], [], [])
    expect(b.fullDay).toBe(true)
    expect(b.freeMinutes).toBe(0)
  })
  it('plan blocks reduce free time', () => {
    const c = dayCapacity(DATE, settings, [], [{ id: 'b', date: DATE, projectId: null, size: 0.5 }], [])
    expect(c.blockMinutes).toBe(240)
    expect(c.freeMinutes).toBe(360)
  })
})

describe('nextOccurrence', () => {
  it('handles month ends and quarters', () => {
    expect(nextOccurrence('2026-01-31', 'monthly')).toBe('2026-02-28')
    expect(nextOccurrence('2026-10-31', 'quarterly')).toBe('2027-01-31')
    expect(nextOccurrence('2026-10-19', 'biweekly')).toBe('2026-11-02')
    expect(nextOccurrence('2028-02-29', 'yearly')).toBe('2029-02-28')
  })
})

describe('budget window', () => {
  it('ignores evening events and clips events that cross the window edge', () => {
    const evening = dayCapacity(DATE, settings, [ev({ start: '19:30', end: '22:00' })], [], [])
    expect(evening.meetingMinutes).toBe(0)
    const crossing = dayCapacity(DATE, settings, [ev({ start: '17:00', end: '20:00' })], [], [])
    expect(crossing.meetingMinutes).toBe(120)
    const early = dayCapacity(DATE, { ...settings, budgetStart: '09:00' }, [ev({ start: '08:00', end: '10:00' })], [], [])
    expect(early.meetingMinutes).toBe(60)
  })
  it('private events still count', () => {
    const c = dayCapacity(DATE, settings, [ev({ start: '08:00', end: '08:45', private: true })], [], [])
    expect(c.meetingMinutes).toBe(45)
  })
})

describe('blocks absorb their project meetings', () => {
  const block = (projectId: string | null, size: 0.25 | 0.5 | 0.75 | 1) => ({ id: `b-${projectId}-${size}`, date: DATE, projectId, size })
  it('½ day + 1 h project meeting costs 4 h', () => {
    const c = dayCapacity(DATE, settings, [ev({ projectId: 'p1', start: '10:00', end: '11:00' })], [block('p1', 0.5)], [])
    expect(c.blockMinutes).toBe(240)
    expect(c.uncoveredMeetingMinutes).toBe(0)
    expect(c.absorbedMinutes).toBe(60)
    expect(c.freeMinutes).toBe(600 - 240)
    expect(c.meetingMinutes).toBe(60) // Today still sees the meeting
  })
  it('¼ day + 3 × 1 h project meetings costs 3 h', () => {
    const evs = [ev({ projectId: 'p1', start: '09:00', end: '10:00' }), ev({ projectId: 'p1', start: '11:00', end: '12:00' }), ev({ projectId: 'p1', start: '14:00', end: '15:00' })]
    const c = dayCapacity(DATE, settings, evs, [block('p1', 0.25)], [])
    expect(c.blockMinutes).toBe(180)
    expect(c.blocks[0]).toMatchObject({ minutes: 180, meetingMinutes: 120 })
    expect(c.freeMinutes).toBe(600 - 180)
  })
  it('meetings of other projects, unlinked meetings and chore blocks stay separate', () => {
    const evs = [ev({ projectId: 'p2', start: '09:00', end: '10:00' }), ev({ start: '13:00', end: '13:30' })]
    const c = dayCapacity(DATE, settings, evs, [block('p1', 0.5), block(null, 0.25)], [])
    expect(c.uncoveredMeetingMinutes).toBe(90)
    expect(c.blockMinutes).toBe(240 + 120)
    expect(c.absorbedMinutes).toBe(0)
    expect(c.freeMinutes).toBe(600 - 90 - 360)
  })
})

describe('anchored recurrence (no drift)', () => {
  it('returns to the 31st after February and handles quarters', async () => {
    const { nextOccurrenceFrom } = await import('./dates')
    expect(nextOccurrenceFrom('2026-01-31', 'monthly', '2026-01-31')).toBe('2026-02-28')
    expect(nextOccurrenceFrom('2026-01-31', 'monthly', '2026-02-28')).toBe('2026-03-31')
    expect(nextOccurrenceFrom('2026-10-31', 'quarterly', '2027-01-31')).toBe('2027-04-30')
    expect(nextOccurrenceFrom('2026-10-31', 'quarterly', '2027-04-30')).toBe('2027-07-31')
    expect(nextOccurrenceFrom('2026-10-19', 'weekly', '2026-11-30')).toBe('2026-12-07')
  })
  it('tolerates malformed settings times', () => {
    const c = dayCapacity(DATE, { ...settings, workdayStart: '', budgetEnd: 'x' as never }, [ev({ start: '09:00', end: '10:00' })], [], [])
    expect(Number.isNaN(c.freeMinutes)).toBe(false)
    expect(c.workMinutes).toBe(600)
  })
})

describe('leftoverTasks (rollover)', () => {
  const task = (p: Partial<Task>): Task => ({ id: p.id ?? 'x', title: 't', projectId: null, status: 'todo', priority: 'normal', notes: [], order: 0, createdAt: '', updatedAt: '', ...p })
  it('offers open tasks planned for earlier days, oldest plan first', () => {
    const tasks = [
      task({ id: 'yesterday', plannedDate: '2026-10-19' }),
      task({ id: 'older', plannedDate: '2026-10-16' }),
      task({ id: 'today', plannedDate: '2026-10-20' }),
      task({ id: 'done', plannedDate: '2026-10-19', status: 'done' }),
      task({ id: 'someday', plannedDate: '2026-10-19', status: 'someday' }),
      task({ id: 'unplanned' }),
    ]
    expect(leftoverTasks(tasks, '2026-10-20').map((t) => t.id)).toEqual(['older', 'yesterday'])
  })
})

// Regressions from the code review (numbers refer to its findings).
describe('selector review regressions', () => {
  const task = (p: Partial<Task>): Task => ({ id: p.id ?? 'x', title: 't', projectId: null, status: 'todo', priority: 'normal', notes: [], order: 0, createdAt: '', updatedAt: '', ...p })
  const project = (p: Partial<Project>): Project => ({ id: 'p', name: 'P', status: 'active', color: 'sage', createdAt: '', updatedAt: '', ...p })

  it('#15 candidatesForDay leaves excluded tasks (the leftovers) out of every group', () => {
    const tasks = [
      task({ id: 'late', dueDate: '2026-10-19', plannedDate: '2026-10-19' }),
      task({ id: 'due', dueDate: '2026-10-20', plannedDate: '2026-10-19' }),
      task({ id: 'next', projectId: 'p', status: 'next', plannedDate: '2026-10-19' }),
      task({ id: 'chore', status: 'next', plannedDate: '2026-10-19' }),
      task({ id: 'other', dueDate: '2026-10-18' }),
    ]
    const blocks: PlanBlock[] = [{ id: 'b', date: '2026-10-20', projectId: 'p', size: 0.5 }]
    const all = candidatesForDay(DATE, tasks, blocks, [project({})])
    expect(all.overdue.map((t) => t.id)).toEqual(['late', 'other'])
    expect(all.fromBlocks.map((b) => b.task?.id)).toEqual(['next'])
    const c = candidatesForDay(DATE, tasks, blocks, [project({})], new Set(['late', 'due', 'next', 'chore']))
    expect(c.overdue.map((t) => t.id)).toEqual(['other'])
    expect(c.due).toEqual([])
    expect(c.fromBlocks).toEqual([])
    expect(c.chores).toEqual([])
  })

  it('#15 dayCapacity reports meeting cost per project, workshop minimum included', () => {
    const c = dayCapacity(DATE, settings, [ev({ id: 'w', kind: 'workshop', start: '09:00', end: '11:00', projectId: 'a' }), ev({ id: 'm', start: '14:00', end: '15:00' })], [], [])
    expect(c.meetingsByProject).toEqual([
      { projectId: 'a', minutes: 300 },
      { projectId: null, minutes: 60 },
    ])
    expect(c.meetingsByProject.reduce((sum, m) => sum + m.minutes, 0)).toBe(c.meetingMinutes)
  })

  it('#8 visibleBlocks leaves out archived projects always and private ones only while hiding', () => {
    const projects = [project({ id: 'old', status: 'archived' }), project({ id: 'priv', private: true }), project({ id: 'p' })]
    const blocks: PlanBlock[] = ['old', 'priv', 'p', null, 'deleted'].map((projectId, i) => ({ id: String(i), date: DATE, projectId, size: 0.25 }))
    expect(visibleBlocks(blocks, projects, false).map((b) => b.projectId)).toEqual(['priv', 'p', null, 'deleted'])
    expect(visibleBlocks(blocks, projects, true).map((b) => b.projectId)).toEqual(['p', null, 'deleted'])
  })

  it('#7 isOverplanned is the one rule for "more planned than working time"', () => {
    const at = (end: string, size: 0.25 | 0.5 | 0.75 | 1) => dayCapacity(DATE, settings, [ev({ start: '09:00', end })], [{ id: 'b', date: DATE, projectId: null, size }], [])
    expect(isOverplanned(at('11:00', 1))).toBe(false) // 120 + 480 = 600
    expect(isOverplanned(at('11:10', 1))).toBe(true) // 130 + 480 = 610
    expect(isOverplanned(dayCapacity('2026-10-24', settings, [ev({ date: '2026-10-24', start: '09:00', end: '18:00' })], [], []))).toBe(false) // Saturday
  })

  it('#13 the shared validators reject impossible dates and times', () => {
    expect(isISODate('2026-02-28')).toBe(true)
    expect(isISODate('2028-02-29')).toBe(true)
    expect(isISODate('2026-02-31')).toBe(false)
    expect(isISODate('2026-13-01')).toBe(false)
    expect(isISODate('2026-1-01')).toBe(false)
    expect(isHHMM('23:59')).toBe(true)
    expect(isHHMM('99:99')).toBe(false)
  })
})
