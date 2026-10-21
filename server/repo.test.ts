import { describe, expect, it } from 'vitest'
import { openDb } from './db.ts'
import { BadRequest, Repo, validateChanges, validateSnapshot } from './repo.ts'

const fresh = () => new Repo(openDb(':memory:'))

describe('Repo', () => {
  it('starts empty and uninitialized', () => {
    const repo = fresh()
    expect(repo.isInitialized()).toBe(false)
    expect(repo.loadState().tasks).toEqual([])
    expect(repo.loadState().settings).toBeNull()
  })
  it('applies upserts, updates and deletes in one transaction', () => {
    const repo = fresh()
    repo.applyChanges({ upserts: { tasks: [{ id: 't1', title: 'a', status: 'todo' }, { id: 't2', title: 'b', status: 'next' }] } })
    expect(repo.isInitialized()).toBe(true)
    repo.applyChanges({ upserts: { tasks: [{ id: 't1', title: 'a2', status: 'waiting' }] }, deletes: { tasks: ['t2'] }, settings: { locale: 'de' } as never })
    const s = repo.loadState()
    expect(s.tasks).toEqual([{ id: 't1', title: 'a2', status: 'waiting' }])
    expect(s.settings).toEqual({ locale: 'de' })
    expect(repo.changedAt()).toBeTruthy()
  })
  it('reports the stamp each write replaced, always moving forward', () => {
    const repo = fresh()
    const first = repo.applyChanges({ upserts: { inbox: [{ id: 'a', text: 'a' }] } })
    expect(first.previousChangedAt).toBeNull()
    const stamp1 = repo.changedAt()!
    const second = repo.applyChanges({ upserts: { inbox: [{ id: 'b', text: 'b' }] } })
    expect(second.previousChangedAt).toBe(stamp1)
    expect(repo.changedAt()! > stamp1).toBe(true) // also within the same millisecond
  })
  it('replaceAll migrates old snapshots', () => {
    const repo = fresh()
    repo.applyChanges({ upserts: { inbox: [{ id: 'old', text: 'gone' }] } })
    repo.replaceAll({
      version: 1,
      inbox: [],
      projects: [{ id: 'p', name: 'P', status: 'on_hold', outcome: 'Goal' }],
      tasks: [],
      events: [],
      blocks: [],
      reviews: [],
      settings: { locale: 'en', workdayStart: '08:00', workdayEnd: '18:00', workDays: [1], dayCapacityHours: 8 } as never,
    })
    const s = repo.loadState()
    expect(s.inbox).toEqual([])
    expect(s.projects[0]).toMatchObject({ status: 'planned', goals: [{ text: 'Goal' }] })
    expect((s.settings as { budgetStart?: string })?.budgetStart).toBe('07:00')
  })
  it('validates change and snapshot payloads', () => {
    expect(() => validateChanges({ upserts: { nope: [] } })).toThrow(BadRequest)
    expect(() => validateChanges({ upserts: { tasks: [{ title: 'no id' }] } })).toThrow(BadRequest)
    expect(() => validateChanges({ deletes: { tasks: [1] } })).toThrow(BadRequest)
    expect(validateChanges({ upserts: { tasks: [{ id: 'x' }] } }).upserts?.tasks).toHaveLength(1)
    expect(() => validateSnapshot({ tasks: 'nope' })).toThrow(BadRequest)
    expect(validateSnapshot({}).version).toBe(1)
  })
  it('captures inbox items from outside', () => {
    const repo = fresh()
    const item = repo.addInboxItem('  Idea  ')
    expect(item.text).toBe('Idea')
    expect(repo.loadState().inbox).toHaveLength(1)
  })
})

describe('replaceEvents', () => {
  it('replaces a source, keeps overrides by external id, leaves manual events alone', () => {
    const repo = fresh()
    repo.applyChanges({ upserts: { events: [{ id: 'manual', title: 'Coaching', date: '2026-10-20', start: '09:00', end: '10:00', kind: 'coaching', source: 'manual' }] } })
    const base = { date: '2026-10-21', start: '10:00', end: '11:00', kind: 'online' as const, source: 'm365' as const }
    repo.replaceEvents('m365', [{ ...base, title: 'A', externalId: 'a#2026-10-21' }, { ...base, title: 'B', externalId: 'b#2026-10-21' }])
    const b = repo.loadState().events.find((e) => e.title === 'B') as unknown as { id: string }
    repo.applyChanges({ upserts: { events: [{ ...b, title: 'B', kind: 'workshop', private: true, date: '2026-10-21', start: '10:00', end: '11:00', source: 'm365', externalId: 'b#2026-10-21' }] } })
    const r = repo.replaceEvents('m365', [{ ...base, title: 'B moved', start: '14:00', end: '15:00', externalId: 'b#2026-10-21' }, { ...base, title: 'C', externalId: 'c#2026-10-22' }])
    expect(r).toEqual({ total: 2, kept: 1, removed: 1 })
    const events = repo.loadState().events as unknown as { id: string; title: string; kind: string; private?: boolean; start: string; source: string }[]
    expect(events.map((e) => e.title).sort()).toEqual(['B moved', 'C', 'Coaching'])
    const b2 = events.find((e) => e.title === 'B moved')!
    expect(b2.id).toBe(b.id)
    expect(b2.kind).toBe('workshop')
    expect(b2.private).toBe(true)
    expect(b2.start).toBe('14:00')
  })
  it('applies series links from projects and keeps linked history before the window', () => {
    const repo = fresh()
    repo.applyChanges({ upserts: { projects: [{ id: 'p', name: 'P', status: 'active', meetingSeries: ['S'] }] } })
    const base = { start: '10:00', end: '11:00', kind: 'online' as const, source: 'm365' as const }
    repo.replaceEvents('m365', [{ ...base, title: 'Old', date: '2026-09-01', externalId: 'old#2026-09-01', seriesId: 'S' }])
    expect(repo.loadState().events[0]).toMatchObject({ title: 'Old', projectId: 'p' })
    const r = repo.replaceEvents('m365', [{ ...base, title: 'New', date: '2026-10-21', externalId: 'new#2026-10-21' }], { windowFrom: '2026-10-12', keepLinkedSince: '2025-10-20' })
    expect(r).toEqual({ total: 1, kept: 0, removed: 0 })
    expect(repo.loadState().events.map((e) => e.title).sort()).toEqual(['New', 'Old'])
  })
})
