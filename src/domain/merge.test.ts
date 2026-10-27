import { describe, expect, it } from 'vitest'
import { mergeList, mergeRecord, recordLabel } from './merge'

const base = { id: 't', title: 'Send offer', status: 'next', plannedDate: '2026-10-29', notes: [] as unknown[], updatedAt: '2026-10-27T08:00:00.000Z' }

describe('mergeRecord', () => {
  it('keeps changes to different fields from both sides without a conflict', () => {
    const mine = { ...base, title: 'Send offer to Jana', updatedAt: '2026-10-27T09:12:00.000Z' }
    const theirs = { ...base, status: 'done', completedAt: '2026-10-27T10:40:00.000Z', statusBeforeDone: 'next', updatedAt: '2026-10-27T10:40:00.000Z' }
    const { record, conflicts } = mergeRecord('tasks', base, mine, theirs, false)
    expect(record).toMatchObject({ title: 'Send offer to Jana', status: 'done', completedAt: '2026-10-27T10:40:00.000Z', updatedAt: '2026-10-27T10:40:00.000Z' })
    expect(conflicts).toEqual([])
  })

  it('gives a field changed on both sides to the later edit and reports the other value', () => {
    const mine = { ...base, plannedDate: '2026-10-30' }
    const theirs = { ...base, plannedDate: '2026-11-02' }
    const later = mergeRecord('tasks', base, mine, theirs, false)
    expect(later.record.plannedDate).toBe('2026-11-02')
    expect(later.conflicts).toEqual([
      { fields: ['plannedDate', 'plannedStart'], kept: { plannedDate: '2026-11-02', plannedStart: undefined }, replaced: { plannedDate: '2026-10-30', plannedStart: undefined }, from: 'browser' },
    ])
    const mineLater = mergeRecord('tasks', base, mine, theirs, true)
    expect(mineLater.record.plannedDate).toBe('2026-10-30')
    expect(mineLater.conflicts[0].from).toBe('server')
  })

  it('merges fields that belong together as one: no status from one side with the completion stamp of the other', () => {
    const mine = { ...base, status: 'waiting', waitingFor: 'Jana' }
    const theirs = { ...base, status: 'done', completedAt: '2026-10-27T10:40:00.000Z', statusBeforeDone: 'next' }
    const { record, conflicts } = mergeRecord('tasks', base, mine, theirs, true)
    expect(record.status).toBe('waiting')
    expect(record.waitingFor).toBe('Jana')
    expect('completedAt' in record).toBe(false)
    expect('statusBeforeDone' in record).toBe(false)
    expect(conflicts[0].fields).toEqual(['status', 'completedAt', 'statusBeforeDone', 'waitingFor'])
  })

  it('removes a field the newer side cleared', () => {
    const b = { ...base, dueDate: '2026-11-01' }
    const { record, conflicts } = mergeRecord('tasks', b, { ...b, dueDate: undefined }, { ...b, title: 'x' }, false)
    expect('dueDate' in record).toBe(false)
    expect(record.title).toBe('x')
    expect(conflicts).toEqual([])
  })

  it('keeps notes added on both sides and never reports bookkeeping', () => {
    const mine = { ...base, notes: [{ id: 'n1', text: 'from the train' }], order: 3, updatedAt: '2026-10-27T09:00:00.000Z' }
    const theirs = { ...base, notes: [{ id: 'n2', text: 'from Claude' }], order: 7, updatedAt: '2026-10-27T10:00:00.000Z' }
    const { record, conflicts } = mergeRecord('tasks', base, mine, theirs, false)
    expect(record.notes).toEqual([{ id: 'n2', text: 'from Claude' }, { id: 'n1', text: 'from the train' }])
    expect(record.order).toBe(7)
    expect(record.updatedAt).toBe('2026-10-27T10:00:00.000Z')
    expect(conflicts).toEqual([])
  })
})

describe('mergeList', () => {
  it('merges lists of strings: additions from both sides, removals from either', () => {
    expect(mergeList(['a', 'b'], ['a', 'b', 'c'], ['b', 'd'], false)).toEqual(['b', 'd', 'c'])
  })
  it('keeps an entry removed on one side when the other side changed it', () => {
    const b = [{ id: 'g1', text: 'Goal' }]
    expect(mergeList(b, [], [{ id: 'g1', text: 'Goal, sharper' }], false)).toEqual([{ id: 'g1', text: 'Goal, sharper' }])
    expect(mergeList(b, [], b, false)).toEqual([])
  })
  it('gives an entry edited on both sides to the later edit', () => {
    const b = [{ id: 'g1', text: 'Goal' }]
    expect(mergeList(b, [{ id: 'g1', text: 'mine' }], [{ id: 'g1', text: 'theirs' }], true)).toEqual([{ id: 'g1', text: 'mine' }])
    expect(mergeList(b, [{ id: 'g1', text: 'mine' }], [{ id: 'g1', text: 'theirs' }], false)).toEqual([{ id: 'g1', text: 'theirs' }])
  })
  it('declines values that are not such lists', () => {
    expect(mergeList('a', 'b', 'c', true)).toBeUndefined()
  })
})

it('labels records by title, name, text or date', () => {
  expect(recordLabel({ id: 'x', name: 'Project' })).toBe('Project')
  expect(recordLabel({ id: 'x', date: '2026-10-27', size: 0.5 })).toBe('2026-10-27')
})
