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
