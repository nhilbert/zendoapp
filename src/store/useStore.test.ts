import { beforeEach, describe, expect, it } from 'vitest'
import { migratePersisted, useStore } from './useStore'
import { compareProjects } from '@/domain/selectors'
import type { CalendarEvent } from '@/domain/types'
import { addDaysISO, todayISO } from '@/domain/dates'

const ics = (p: Partial<CalendarEvent>): CalendarEvent => ({ id: crypto.randomUUID(), title: 't', date: '2026-10-20', start: '09:00', end: '10:00', kind: 'online', source: 'ics', ...p })

beforeEach(() => useStore.getState().clearAll())

describe('importEvents', () => {
  it('replaces the previous import, keeps overrides and manual events', () => {
    const s = useStore.getState()
    s.addEvent({ title: 'manual', date: '2026-10-20', start: '08:00', end: '08:30', kind: 'coaching' })
    s.importEvents([ics({ title: 'A', externalId: 'a#2026-10-20' }), ics({ title: 'B', externalId: 'b#2026-10-20' })], 'ics')
    const b = useStore.getState().events.find((e) => e.title === 'B')!
    s.updateEvent(b.id, { kind: 'workshop' })
    const r = s.importEvents([ics({ title: 'B moved', externalId: 'b#2026-10-20', start: '14:00', end: '15:00' }), ics({ title: 'C', externalId: 'c#2026-10-21' })], 'ics')
    const events = useStore.getState().events
    expect(r).toEqual({ total: 2, kept: 1, removed: 1 })
    expect(events.map((e) => e.title).sort()).toEqual(['B moved', 'C', 'manual'])
    const b2 = events.find((e) => e.title === 'B moved')!
    expect(b2.id).toBe(b.id)
    expect(b2.kind).toBe('workshop')
    expect(b2.start).toBe('14:00')
  })
})

describe('next-action invariant', () => {
  it('keeps exactly one next action per project', () => {
    const s = useStore.getState()
    const p = s.addProject({ name: 'P' })
    const t1 = s.addTask({ title: '1', projectId: p.id, status: 'next' })
    const t2 = s.addTask({ title: '2', projectId: p.id })
    s.setTaskStatus(t2.id, 'next')
    const tasks = useStore.getState().tasks
    expect(tasks.find((t) => t.id === t1.id)!.status).toBe('todo')
    expect(tasks.filter((t) => t.projectId === p.id && t.status === 'next')).toHaveLength(1)
  })
})

describe('recurring chores', () => {
  it('spawns the next occurrence in the future when completed', () => {
    const s = useStore.getState()
    const today = todayISO()
    const chore = s.addTask({ title: 'Invoices', projectId: null, status: 'next', recurrence: 'monthly', dueDate: addDaysISO(today, -40), plannedDate: addDaysISO(today, -42) })
    s.completeTask(chore.id)
    const tasks = useStore.getState().tasks
    expect(tasks.find((t) => t.id === chore.id)!.status).toBe('done')
    const next = tasks.find((t) => t.id !== chore.id && t.title === 'Invoices')!
    expect(next.status).toBe('next')
    expect(next.dueDate! > today).toBe(true)
    expect(next.plannedDate! < next.dueDate!).toBe(true)
    expect(next.notes).toEqual([])
    // completing the new one again does not duplicate the old one
    s.completeTask(next.id)
    expect(useStore.getState().tasks.filter((t) => t.title === 'Invoices')).toHaveLength(3)
  })
  it('does not recur through the board when a task has no recurrence', () => {
    const s = useStore.getState()
    const t = s.addTask({ title: 'once', projectId: null })
    s.setTaskStatus(t.id, 'done')
    expect(useStore.getState().tasks.filter((x) => x.title === 'once')).toHaveLength(1)
  })
})

describe('persisted-state migrations', () => {
  it('maps old statuses and turns a desired outcome into the first goal', () => {
    const v1 = {
      projects: [
        { id: 'a', name: 'A', status: 'on_hold', outcome: 'Done means X', color: 'sage', createdAt: '', updatedAt: '' },
        { id: 'b', name: 'B', status: 'done', color: 'clay', createdAt: '', updatedAt: '', goals: [{ id: 'g', text: 'Keep me' }], outcome: 'ignored' },
      ],
    }
    const out = migratePersisted(v1, 1) as { projects: { status: string; goals?: { text: string }[]; outcome?: string }[] }
    expect(out.projects[0].status).toBe('planned')
    expect(out.projects[0].goals?.map((g) => g.text)).toEqual(['Done means X'])
    expect(out.projects[0].outcome).toBeUndefined()
    expect(out.projects[1].status).toBe('archived')
    expect(out.projects[1].goals?.map((g) => g.text)).toEqual(['Keep me'])
  })
})

describe('private override on re-import', () => {
  it('keeps a manual private flag when the same event is imported again', () => {
    const s = useStore.getState()
    s.importEvents([ics({ title: 'Lunch', externalId: 'l#2026-10-20' })], 'm365')
    const lunch = useStore.getState().events.find((e) => e.title === 'Lunch')!
    s.updateEvent(lunch.id, { private: true })
    s.importEvents([ics({ title: 'Lunch', externalId: 'l#2026-10-20' })], 'm365')
    expect(useStore.getState().events.find((e) => e.title === 'Lunch')!.private).toBe(true)
  })
})

describe('manual ordering', () => {
  it('reorders within a column, moves across columns at a position, and re-sorts by urgency', () => {
    const s = useStore.getState()
    const today = todayISO()
    const a = s.addTask({ title: 'a', projectId: null, status: 'todo', priority: 'low' })
    const b = s.addTask({ title: 'b', projectId: null, status: 'todo', priority: 'high', dueDate: addDaysISO(today, 13) })
    const c = s.addTask({ title: 'c', projectId: null, status: 'todo', priority: 'low', dueDate: addDaysISO(today, 6) })
    const titles = (status: string) =>
      useStore
        .getState()
        .tasks.filter((t) => t.status === status)
        .sort((x, y) => x.order - y.order)
        .map((t) => t.title)
    expect(titles('todo')).toEqual(['a', 'b', 'c'])
    s.reorderTask(c.id, 'todo', a.id) // c before a
    expect(titles('todo')).toEqual(['c', 'a', 'b'])
    s.reorderTask(a.id, 'todo', null) // a to the end
    expect(titles('todo')).toEqual(['c', 'b', 'a'])
    const w = s.addTask({ title: 'w', projectId: null, status: 'waiting' })
    s.reorderTask(b.id, 'waiting', w.id) // b into waiting, before w
    expect(titles('waiting')).toEqual(['b', 'w'])
    expect(titles('todo')).toEqual(['c', 'a'])
    s.reorderTask(b.id, 'todo', null)
    s.addTask({ title: 'far', projectId: null, status: 'todo', priority: 'high', dueDate: addDaysISO(today, 40) })
    s.addTask({ title: 'hi', projectId: null, status: 'todo', priority: 'high' })
    s.sortColumnByUrgency('todo')
    // due within 14 days by date (c before b, despite priority), then undated by priority (hi before a), then far-off due dates
    expect(titles('todo')).toEqual(['c', 'b', 'hi', 'a', 'far'])
  })
  it('keeps the next-action invariant when dropping into the next column', () => {
    const s = useStore.getState()
    const p = s.addProject({ name: 'P' })
    const n1 = s.addTask({ title: 'n1', projectId: p.id, status: 'next' })
    const n2 = s.addTask({ title: 'n2', projectId: p.id, status: 'todo' })
    s.reorderTask(n2.id, 'next', n1.id)
    const tasks = useStore.getState().tasks
    expect(tasks.find((t) => t.id === n1.id)!.status).toBe('todo')
    expect(tasks.find((t) => t.id === n2.id)!.status).toBe('next')
  })
})

describe('undoing a completion', () => {
  it('removes the spawned occurrence and restores the previous status', () => {
    const s = useStore.getState()
    const chore = s.addTask({ title: 'Invoices', projectId: null, status: 'next', recurrence: 'monthly', dueDate: addDaysISO(todayISO(), 3) })
    s.completeTask(chore.id)
    expect(useStore.getState().tasks.filter((t) => t.title === 'Invoices')).toHaveLength(2)
    s.completeTask(chore.id, false)
    const left = useStore.getState().tasks.filter((t) => t.title === 'Invoices')
    expect(left).toHaveLength(1)
    expect(left[0].status).toBe('next')
    expect(left[0].completedAt).toBeUndefined()
  })
  it('also cleans up when the status is changed away from done on the board', () => {
    const s = useStore.getState()
    const chore = s.addTask({ title: 'Weekly', projectId: null, status: 'todo', recurrence: 'weekly', dueDate: addDaysISO(todayISO(), 1) })
    s.setTaskStatus(chore.id, 'done')
    s.setTaskStatus(chore.id, 'waiting')
    const left = useStore.getState().tasks.filter((t) => t.title === 'Weekly')
    expect(left).toHaveLength(1)
    expect(left[0].status).toBe('waiting')
  })
})

describe('undoing a completion, more', () => {
  it('drags out of Done on the board without leaving a second copy', () => {
    const s = useStore.getState()
    const chore = s.addTask({ title: 'Weekly', projectId: null, status: 'todo', recurrence: 'weekly', dueDate: addDaysISO(todayISO(), 1) })
    s.reorderTask(chore.id, 'done', null)
    expect(useStore.getState().tasks.filter((t) => t.title === 'Weekly')).toHaveLength(2)
    s.reorderTask(chore.id, 'todo', null)
    const left = useStore.getState().tasks.filter((t) => t.title === 'Weekly')
    expect(left).toHaveLength(1)
    expect(left[0].completedAt).toBeUndefined()
    expect(left[0].statusBeforeDone).toBeUndefined()
  })
  it('keeps a spawned occurrence the user has already worked on', () => {
    const s = useStore.getState()
    const chore = s.addTask({ title: 'Report', projectId: null, status: 'todo', recurrence: 'weekly', dueDate: addDaysISO(todayISO(), 1) })
    s.completeTask(chore.id)
    const spawned = useStore.getState().tasks.find((t) => t.spawnedFrom === chore.id)!
    s.addTaskNote(spawned.id, 'already started')
    s.completeTask(chore.id, false)
    const left = useStore.getState().tasks.filter((t) => t.title === 'Report')
    expect(left).toHaveLength(2)
    expect(left.find((t) => t.id === spawned.id)!.notes[0].text).toBe('already started')
  })
  it('a drag sends only the cards whose place changed', () => {
    const s = useStore.getState()
    const [a, b, c] = ['a', 'b', 'c'].map((title) => s.addTask({ title, projectId: null, status: 'todo' }))
    s.reorderTask(a.id, 'todo', null) // a to the end: every place changes once
    const before = useStore.getState().tasks
    s.reorderTask(c.id, 'todo', a.id) // c already sits before a
    const after = useStore.getState().tasks
    expect(after.find((t) => t.id === b.id)).toBe(before.find((t) => t.id === b.id))
  })
})

describe('project order', () => {
  const names = () => [...useStore.getState().projects].sort(compareProjects).map((p) => p.name)
  it('keeps the due-date order until a project is dragged, then the dragged order, per section', () => {
    const s = useStore.getState()
    s.addProject({ name: 'B late', dueDate: '2026-12-01' })
    s.addProject({ name: 'A soon', dueDate: '2026-11-01' })
    s.addProject({ name: 'C none' })
    const planned = s.addProject({ name: 'P planned', status: 'planned' })
    expect(names()).toEqual(['A soon', 'B late', 'C none', 'P planned'])
    const c = useStore.getState().projects.find((p) => p.name === 'C none')!
    const a = useStore.getState().projects.find((p) => p.name === 'A soon')!
    s.reorderProject(c.id, a.id)
    expect(names()).toEqual(['C none', 'A soon', 'B late', 'P planned'])
    s.reorderProject(c.id, null) // to the end of its section, still before the planned one
    expect(names()).toEqual(['A soon', 'B late', 'C none', 'P planned'])
    expect(useStore.getState().projects.find((p) => p.id === planned.id)!.order).toBeUndefined()
    s.addProject({ name: 'D new' })
    expect(names()).toEqual(['A soon', 'B late', 'C none', 'D new', 'P planned'])
  })
})

describe('JSON import', () => {
  it('migrates old exports and rejects foreign files', () => {
    const s = useStore.getState()
    s.importData({
      version: 1,
      exportedAt: '',
      inbox: [],
      projects: [{ id: 'p', name: 'Old', status: 'on_hold' as never, outcome: 'Goal text', color: 'sage', createdAt: '', updatedAt: '' } as never],
      tasks: [],
      events: [],
      blocks: [],
      reviews: [],
      settings: { locale: 'de', workdayStart: '09:00', workdayEnd: '17:00', workDays: [1, 2, 3], dayCapacityHours: 6 } as never,
    })
    const st = useStore.getState()
    expect(st.projects[0].status).toBe('planned')
    expect(st.projects[0].goals?.[0].text).toBe('Goal text')
    expect(st.settings.budgetStart).toBe('07:00')
    expect(st.settings.workdayStart).toBe('09:00')
    expect(() => s.importData({ name: 'zendo', version: '1.0.0' } as never)).toThrow()
    expect(useStore.getState().projects).toHaveLength(1)
  })
})

describe('rollover and blocks', () => {
  it('plans several tasks for a day without their time, or takes them off the plan', () => {
    const s = useStore.getState()
    const a = s.addTask({ title: 'a', plannedDate: '2026-10-19', plannedStart: '09:00' })
    const b = s.addTask({ title: 'b', plannedDate: '2026-10-16' })
    s.rescheduleTasks([a.id, b.id], '2026-10-20')
    const byId = () => new Map(useStore.getState().tasks.map((t) => [t.id, t]))
    expect(byId().get(a.id)).toMatchObject({ plannedDate: '2026-10-20', plannedStart: undefined })
    expect(byId().get(b.id)?.plannedDate).toBe('2026-10-20')
    s.rescheduleTasks([a.id], undefined)
    expect(byId().get(a.id)?.plannedDate).toBeUndefined()
    expect(byId().get(b.id)?.plannedDate).toBe('2026-10-20')
  })
  it('keeps a note on a new block (applied week proposal)', () => {
    const s = useStore.getState()
    expect(s.addBlock('2026-10-21', null, 0.25, '  invoices  ').note).toBe('invoices')
    expect('note' in s.addBlock('2026-10-21', null, 0.25, ' ')).toBe(false)
  })
})

describe('linkSeries', () => {
  it('links every meeting of a series to one project and moves the link on relinking', () => {
    const s = useStore.getState()
    const a = s.addProject({ name: 'A' })
    const b = s.addProject({ name: 'B' })
    s.importEvents([ics({ title: 'JF', externalId: 'o1#2026-10-20', seriesId: 'S' }), ics({ title: 'JF', externalId: 'o2#2026-10-27', seriesId: 'S' }), ics({ title: 'Other', externalId: 'x#2026-10-20' })], 'm365')
    s.linkSeries('S', a.id)
    let st = useStore.getState()
    expect(st.events.map((e) => e.projectId ?? null)).toEqual([a.id, a.id, null])
    expect(st.projects.find((p) => p.id === a.id)!.meetingSeries).toEqual(['S'])
    s.linkSeries('S', b.id)
    st = useStore.getState()
    expect(st.projects.find((p) => p.id === a.id)!.meetingSeries).toEqual([])
    expect(st.projects.find((p) => p.id === b.id)!.meetingSeries).toEqual(['S'])
    s.linkSeries('S', null)
    st = useStore.getState()
    expect(st.projects.every((p) => !p.meetingSeries?.length)).toBe(true)
    expect(st.events.every((e) => !e.projectId)).toBe(true)
  })
  it('gives new occurrences of a linked series the project on the next import', () => {
    const s = useStore.getState()
    const a = s.addProject({ name: 'A' })
    s.importEvents([ics({ externalId: 'o1#2026-10-20', seriesId: 'S' })], 'm365')
    s.linkSeries('S', a.id)
    s.importEvents([ics({ externalId: 'o1#2026-10-20', seriesId: 'S' }), ics({ externalId: 'o2#2026-10-27', seriesId: 'S' })], 'm365')
    expect(useStore.getState().events.map((e) => e.projectId)).toEqual([a.id, a.id])
  })
})
