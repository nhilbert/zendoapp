import { describe, expect, it } from 'vitest'
import { openDb } from './db.ts'
import { Repo } from './repo.ts'
import { Ops } from './ops.ts'
import type { Task } from '../src/domain/types.ts'

const TODAY = '2026-10-20' // a Tuesday
const setup = (hidePrivate = false) => {
  const repo = new Repo(openDb(':memory:'))
  return { repo, ops: new Ops(repo, { today: () => TODAY, now: () => '09:00', hidePrivate }) }
}
const tasks = (repo: Repo) => repo.loadState().tasks as unknown as Task[]

describe('Ops', () => {
  it('captures several inbox items and clarifies one into a task', () => {
    const { repo, ops } = setup()
    const [a, b] = ops.inboxAdd(['Send offer to Jana', '  ', 'Book room'])
    expect(ops.inboxList().map((i) => i.text)).toEqual(['Send offer to Jana', 'Book room'])
    const { task } = ops.inboxClarify(a.id, 'task', { task: { dueDate: '2026-10-23' } }) as { task: { title: string; dueDate: string } }
    expect(task).toMatchObject({ title: 'Send offer to Jana', dueDate: '2026-10-23' })
    ops.inboxClarify(b.id, 'delete')
    expect(repo.loadState().inbox).toEqual([])
    expect(repo.changedAt()).not.toBeNull()
  })

  it('keeps one next action per project and finds projects by name', () => {
    const { repo, ops } = setup()
    const p = ops.projectCreate({ name: 'Workshop Metro', goals: ['Team agrees on roles'], nextAction: 'Draft agenda', tasks: ['Book room'] })
    expect(p).toMatchObject({ name: 'Workshop Metro', status: 'active', goal: 'Team agrees on roles', openTasks: 2, nextAction: { title: 'Draft agenda' } })
    const t = ops.taskCreate({ title: 'Call client', project: 'workshop', status: 'next' })
    const all = tasks(repo)
    expect(all.filter((x) => x.status === 'next').map((x) => x.title)).toEqual(['Call client'])
    expect(all.find((x) => x.title === 'Draft agenda')!.status).toBe('todo')
    expect(t.project).toBe('Workshop Metro')
    expect(() => ops.taskCreate({ title: 'x', project: 'nope' })).toThrow(/no project/)
  })

  it('completes recurring tasks with a next occurrence and hints at a missing next action', () => {
    const { repo, ops } = setup()
    ops.projectCreate({ name: 'P', nextAction: 'Only step' })
    const only = tasks(repo).find((t) => t.title === 'Only step')!
    expect(ops.taskComplete(only.id)).toMatchObject({ hint: 'Project "P" has no next action now.' })
    const weekly = ops.taskCreate({ title: 'Invoices', recurrence: 'weekly', dueDate: TODAY })
    const r = ops.taskComplete(weekly.id!) as { nextOccurrence: { dueDate: string } }
    expect(r.nextOccurrence.dueDate).toBe('2026-10-27')
    ops.taskComplete(weekly.id!, false)
    expect(tasks(repo).filter((t) => t.title === 'Invoices')).toHaveLength(1)
  })

  it('updates tasks: null clears, status done goes through completion', () => {
    const { repo, ops } = setup()
    const t = ops.taskCreate({ title: 'Prepare', plannedDate: TODAY, plannedStart: '10:00', dueDate: '2026-10-30' })
    ops.taskUpdate(t.id!, { dueDate: null, plannedDate: null, priority: 'high' })
    const stored = tasks(repo)[0]
    expect(stored.dueDate).toBeUndefined()
    expect(stored.plannedStart).toBeUndefined()
    expect(stored.priority).toBe('high')
    ops.taskUpdate(t.id!, { status: 'done' })
    expect(tasks(repo)[0]).toMatchObject({ status: 'done', statusBeforeDone: 'todo' })
    expect(() => ops.taskUpdate(t.id!, { dueDate: '20.10.2026' })).toThrow(/YYYY-MM-DD/)
  })

  it('updates project information and appends notes', () => {
    const { ops } = setup()
    ops.projectCreate({ name: 'Coaching A', notes: 'Contract: 5 sessions' })
    ops.projectUpdate('Coaching A', { appendNotes: 'Session 1: goals clarified', status: 'planned', dueDate: '2026-12-31' })
    const p = ops.projectGet('Coaching A') as { notes: string; status: string; dueDate: string }
    expect(p.notes).toBe('Contract: 5 sessions\n\nSession 1: goals clarified')
    expect(p).toMatchObject({ status: 'planned', dueDate: '2026-12-31' })
    expect(() => ops.projectCreate({ name: 'coaching a' })).toThrow(/exists already/)
  })

  it('plans blocks only for active projects and shows them in day and week', () => {
    const { ops } = setup()
    ops.projectCreate({ name: 'Active', nextAction: 'Write concept' })
    ops.projectCreate({ name: 'Later', status: 'planned' })
    const b = ops.blockAdd(TODAY, 'Active', 0.5)
    expect(() => ops.blockAdd(TODAY, 'Later')).toThrow(/only for active/)
    expect(() => ops.blockAdd(TODAY, null, 0.3 as never)).toThrow(/size/)
    const t = ops.taskCreate({ title: 'Mail', plannedDate: TODAY })
    const day = ops.day() as { blocks: { project: string }[]; planned: { title: string }[]; suggestedFromBlocks: { title: string }[]; capacity: { blockMinutes: number } }
    expect(day.blocks[0].project).toBe('Active')
    expect(day.planned.map((x) => x.title)).toEqual(['Mail'])
    expect(day.suggestedFromBlocks.map((x) => x.title)).toEqual(['Write concept'])
    expect(day.capacity.blockMinutes).toBe(240)
    ops.blockUpdate(b.id!, { date: '2026-10-21', size: 1 })
    const week = ops.week(TODAY, 3)
    expect(week.days[1].blocks).toMatchObject([{ project: 'Active', size: 1 }])
    ops.taskSchedule([t.id!], '2026-10-22', '14:00')
    expect(ops.week(TODAY, 3).days[2].plannedTasks).toEqual(['Mail'])
  })

  it('saves daily and weekly review notes (weekly on the Monday)', () => {
    const { ops } = setup()
    ops.reviewSave('daily', 'Good focus')
    ops.reviewSave('daily', 'Moved the offer', { append: true })
    expect(ops.reviewGet('daily').notes).toBe('Good focus\n\nMoved the offer')
    expect(ops.reviewSave('weekly', 'Week notes', { date: '2026-10-22' }).date).toBe('2026-10-19')
  })

  it('with hidePrivate neither shows nor touches private records', () => {
    const { repo, ops } = setup()
    ops.projectCreate({ name: 'Family', private: true, nextAction: 'Plan trip' })
    const hidden = new Ops(repo, { today: () => TODAY, hidePrivate: true })
    expect(hidden.projectList()).toEqual([])
    expect(hidden.taskList().total).toBe(0)
    hidden.taskCreate({ title: 'Work' })
    expect(tasks(repo).map((t) => t.title).sort()).toEqual(['Plan trip', 'Work'])
  })
})
