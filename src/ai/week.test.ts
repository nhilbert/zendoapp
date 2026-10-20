import { describe, expect, it } from 'vitest'
import type { CalendarEvent, PlanBlock, Project, Task } from '../domain/types'
import { DEFAULT_SETTINGS } from '../domain/types'
import { type WeekContext, buildWeekPrompt, fitProposal, parseWeekProposal } from './week'

// Default settings: Mon–Fri, 08:00–18:00 (600 min), a full-day block = 8 h (480 min).
const project = (p: Partial<Project>): Project => ({ id: 'p', name: 'P', status: 'active', color: 'sage', createdAt: '', updatedAt: '', ...p })
const task = (p: Partial<Task>): Task => ({ id: Math.random().toString(36), title: 't', projectId: null, status: 'todo', priority: 'normal', notes: [], order: 0, createdAt: '', updatedAt: '', ...p })
const event = (p: Partial<CalendarEvent>): CalendarEvent => ({ id: Math.random().toString(36), title: 'e', date: '2026-10-20', start: '09:00', end: '10:00', kind: 'online', source: 'manual', ...p })

const ctx = (over: Partial<WeekContext> = {}): WeekContext => ({
  today: '2026-10-20',
  locale: 'en',
  dates: ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-24'], // Tue, Wed (all-day busy), Thu, Sat (off)
  settings: DEFAULT_SETTINGS,
  projects: [project({ id: 'p1', name: 'Strategy', dueDate: '2026-10-28', goals: [{ id: 'g', text: 'Agree the strategy with the board' }] })],
  tasks: [task({ projectId: 'p1', title: 'SECRET TASK TITLE', dueDate: '2026-10-23', estimateMinutes: 120 }), task({ title: 'Invoices', estimateMinutes: 45 })],
  events: [
    event({ title: 'SECRET MEETING', start: '09:00', end: '13:00', projectId: 'p1' }),
    event({ title: 'Private dinner', start: '13:00', end: '14:00', projectId: 'p2', private: true }),
    event({ date: '2026-10-21', allDay: true, title: 'Workshop elsewhere' }),
  ],
  blocks: [{ id: 'b1', date: '2026-10-20', projectId: null, size: 0.25 } as PlanBlock],
  hiddenProjectIds: new Set(['p2']),
  ...over,
})

describe('week proposal prompt', () => {
  it('describes days, projects and open work without task or meeting titles', () => {
    const prompt = buildWeekPrompt(ctx({ locale: 'de' }))
    expect(prompt).toContain('German')
    expect(prompt).toContain('p1 · "Strategy" · due 2026-10-28 · goal "Agree the strategy with the board"')
    expect(prompt).toContain('earliest task deadline 2026-10-23')
    expect(prompt).toMatch(/2026-10-21 Wed: fully booked/)
    expect(prompt).toMatch(/2026-10-24 Sat: off/)
    expect(prompt).toContain('a private project')
    expect(prompt).not.toContain('SECRET TASK TITLE')
    expect(prompt).not.toContain('SECRET MEETING')
    expect(prompt).not.toContain('Private dinner')
    expect(prompt).not.toContain('Invoices')
  })
})

describe('parseWeekProposal', () => {
  it('keeps well-formed blocks and counts the rest as dropped', () => {
    const p = parseWeekProposal(
      '```json\n{"summary":" Focus on strategy. ","blocks":[{"date":"2026-10-22","projectId":"p1","size":0.5,"note":"Board deck","reason":"Deadline"},{"date":"tomorrow","projectId":"p1","size":0.5},{"date":"2026-10-22","projectId":"","size":0.3},{"date":"2026-10-22","projectId":"","size":0.25}]}\n```',
    )
    expect(p.summary).toBe('Focus on strategy.')
    expect(p.blocks).toEqual([
      { date: '2026-10-22', projectId: 'p1', size: 0.5, note: 'Board deck', reason: 'Deadline' },
      { date: '2026-10-22', projectId: null, size: 0.25, note: null, reason: null },
    ])
    expect(p.dropped).toBe(2)
    expect(() => parseWeekProposal('no json')).toThrow()
  })
})

describe('fitProposal', () => {
  const b = (date: string, projectId: string | null, size: 0.25 | 0.5 | 0.75 | 1) => ({ date, projectId, size, note: null, reason: null })
  it('keeps only allowed blocks that fit the free time of their day', () => {
    const fitted = fitProposal(
      {
        summary: 's',
        dropped: 0,
        blocks: [
          b('2026-10-20', 'p1', 0.75), // Tue: p1's 4 h of meetings sit inside its 6 h block; + 2 h chores + 1 h other appointment = 9 h of 10: fits
          b('2026-10-20', 'p1', 0.25), // second p1 block the same day
          b('2026-10-20', null, 0.25), // chores already blocked that day
          b('2026-10-21', 'p1', 0.5), // fully booked day
          b('2026-10-24', 'p1', 0.5), // Saturday: off
          b('2026-10-22', 'p2', 0.5), // private project, not plannable
          b('2026-10-22', 'zzz', 0.5), // unknown project
          b('2026-10-30', 'p1', 0.5), // outside the range
          b('2026-10-22', 'p1', 1), // Thu: 8 h of 10 h
          b('2026-10-22', null, 0.5), // + 4 h → overfilled
          b('2026-10-22', null, 0.25), // + 2 h → exactly full: fits
        ],
      },
      ctx(),
    )
    expect(fitted.blocks.map((x) => `${x.date} ${x.projectId} ${x.size}`)).toEqual(['2026-10-20 p1 0.75', '2026-10-22 p1 1', '2026-10-22 null 0.25'])
    expect(fitted.dropped).toBe(8)
  })
})
