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

describe('Ops review fixes', () => {
  it('demotes a hidden private next action when the agent sets a new one', () => {
    const { repo, ops } = setup()
    ops.projectCreate({ name: 'Work' })
    const secret = ops.taskCreate({ title: 'Secret step', project: 'Work', status: 'next', private: true })
    const hidden = new Ops(repo, { today: () => TODAY, hidePrivate: true })
    hidden.taskCreate({ title: 'Visible step', project: 'Work', status: 'next' })
    const all = tasks(repo)
    expect(all.find((t) => t.id === secret.id)!.status).toBe('todo')
    expect(all.filter((t) => t.status === 'next').map((t) => t.title)).toEqual(['Visible step'])
  })

  it('reports a hidden private next action as present, without its title', () => {
    const { repo, ops } = setup()
    ops.projectCreate({ name: 'Work' })
    ops.taskCreate({ title: 'Secret step', project: 'Work', status: 'next', private: true })
    const hidden = new Ops(repo, { today: () => TODAY, hidePrivate: true })
    const [work] = hidden.projectList()
    expect(work.nextAction).toEqual({ title: '(private task)', private: true })
    expect(work.missingNextAction).toBeUndefined()
    expect(hidden.week().activeProjectsWithoutNextAction).toEqual([])
    expect(JSON.stringify(hidden.projectList())).not.toContain('Secret step')
  })

  it('masks meetings of a private project even when the meeting itself is not flagged', () => {
    const { repo, ops } = setup()
    const family = ops.projectCreate({ name: 'Family', private: true })
    repo.applyChanges({ upserts: { events: [{ id: 'e1', title: 'Therapy session', location: 'Praxis', date: TODAY, start: '10:00', end: '11:00', kind: 'in_person', source: 'manual', projectId: family.id }] } })
    const hidden = new Ops(repo, { today: () => TODAY, hidePrivate: true })
    const text = JSON.stringify(hidden.day(TODAY))
    expect(text).not.toContain('Therapy')
    expect(text).not.toContain('Praxis')
    expect(JSON.stringify(ops.day(TODAY))).toContain('Therapy session')
  })

  it('keeps project names unique against hidden and current projects, preferring current over archived', () => {
    const { repo, ops } = setup()
    ops.projectCreate({ name: 'Garden', private: true })
    const hidden = new Ops(repo, { today: () => TODAY, hidePrivate: true })
    expect(() => hidden.projectCreate({ name: 'garden' })).toThrow(/exists already/)
    ops.projectCreate({ name: 'Workshop', status: 'archived' })
    const fresh = ops.projectCreate({ name: 'Workshop' })
    expect(ops.taskCreate({ title: 'x', project: 'Workshop' }).projectId).toBe(fresh.id)
    ops.projectCreate({ name: 'Other' })
    expect(() => ops.projectUpdate('Other', { name: 'workshop' })).toThrow(/exists already/)
  })

  it('refuses an empty project reference and a duplicate name on reactivation', () => {
    const { ops } = setup()
    const old = ops.projectCreate({ name: 'Website', status: 'archived' })
    ops.projectCreate({ name: 'Website' })
    const t = ops.taskCreate({ title: 'x' })
    expect(() => ops.taskUpdate(t.id!, { project: ' ' })).toThrow(/must not be empty/)
    expect(() => ops.projectUpdate(old.id!, { status: 'active' })).toThrow(/exists already/)
  })

  it('plans the day and week only with workable tasks, as the app does', () => {
    const { repo, ops } = setup()
    ops.projectCreate({ name: 'Old', status: 'archived' })
    ops.projectCreate({ name: 'Live' })
    ops.taskCreate({ title: 'Live work', project: 'Live', plannedDate: TODAY, estimateMinutes: 60 })
    const old = (repo.loadState().projects as { id: string; name: string }[]).find((p) => p.name === 'Old')!
    repo.applyChanges({ upserts: { tasks: [{ id: 'z', title: 'Archived work', status: 'todo', projectId: old.id, plannedDate: TODAY, dueDate: TODAY, estimateMinutes: 120, notes: [], order: 1, createdAt: '', updatedAt: '' }] } })
    const day = JSON.stringify(ops.day(TODAY))
    expect(day).toContain('Live work')
    expect(day).not.toContain('Archived work')
    expect(JSON.stringify(ops.week(TODAY))).not.toContain('Archived work')
  })

  it('creates tasks logged as done as completed, and refuses moving into archived projects', () => {
    const { ops } = setup()
    expect(ops.taskCreateMany([{ title: 'Sent offer', status: 'done' }])[0]).toMatchObject({ status: 'done' })
    ops.projectCreate({ name: 'Old', status: 'archived' })
    const t = ops.taskCreate({ title: 'Loose end' })
    expect(() => ops.taskUpdate(t.id!, { project: 'Old' })).toThrow(/archived/)
  })
})
