/**
 * Shared pieces of the AI week proposal: prompt, JSON schema, a tolerant parser and the capacity
 * check that keeps every proposed block inside the free time of its day. The server (server/ai.ts)
 * builds the prompt from the database; the browser only shows and applies the result.
 *
 * Sent to the provider: dates, free and meeting hours, project names, headline goals, due dates and
 * open-work figures (counts and estimated hours). Not sent: task titles, meeting titles, notes.
 */
import type { BlockSize, CalendarEvent, HHMM, ISODate, Locale, PlanBlock, Project, Settings, Task } from '../domain/types.ts'
import { BLOCK_SIZES } from '../domain/types.ts'
import { blocksOn, dayCapacity, eventsOn, isBlocking, isOpen, safeTimes } from '../domain/selectors.ts'
import { compareISO, hhmmToMinutes, isoWeekday } from '../domain/dates.ts'
import { extractJsonObject } from './clarify.ts'

export interface ProposedBlock {
  date: ISODate
  /** null = chores / admin */
  projectId: string | null
  size: BlockSize
  /** optional focus for the block */
  note: string | null
  /** one sentence why */
  reason: string | null
}

export interface WeekProposal {
  summary: string
  blocks: ProposedBlock[]
  /** proposed blocks left out because they did not fit (capacity, unknown project, duplicate) */
  dropped: number
}

export interface WeekContext {
  today: ISODate
  /** current time when today is part of the range */
  now?: HHMM
  locale: Locale
  /** the days to plan, ascending */
  dates: ISODate[]
  settings: Settings
  /** the projects that may receive blocks */
  projects: Project[]
  tasks: Task[]
  events: CalendarEvent[]
  /** all existing blocks (they take time whoever they belong to) */
  blocks: PlanBlock[]
  /** private projects that must not be named to the provider */
  hiddenProjectIds: Set<string>
}

export const WEEK_SYSTEM_PROMPT = `You plan the coming days of a self-employed consultant, facilitator and coach who works in Getting Things Done style.
The plan consists of blocks. A block reserves a share of one day (0.25, 0.5, 0.75 or 1 full day) for one project, or for chores and admin (projectId null). Blocks have no time of day.
You get the days with their free hours (after meetings and blocks already planned), the projects that may be planned with their deadlines and open work, and the open chores.
Propose additional blocks for the given days:
- Use only the given project ids, or null for chores/admin. Use only the given dates.
- Never plan on days marked off or fully booked. The proposed blocks of a day must fit into its free hours (block hours = size × full-day hours); leave slack and plan at most about 80% of a day's free hours.
- Keep the blocks already planned and do not add a second block for a project on a day where it already has one.
- Prioritise by deadlines (project due dates and the earliest task deadlines), then by the amount of open work. A project with a deadline in or shortly after the range needs enough time before the deadline.
- Prefer few, larger blocks (½ or a full day) for project work over many small ones, at most two project blocks per day. A ¼ chores/admin block on two or three days is enough when chores are open.
- A project's meetings on a day count inside that project's block, so its block on that day may be larger than the free hours by up to those meeting hours.
- With little free time, propose fewer blocks rather than overfilling. Proposing nothing for a day is fine.
- If today is in the range, only the rest of today is available.
- note: optional focus for the block in at most 60 characters (what to work on), else null. reason: one short sentence why this block. summary: two or three sentences on the overall plan, naming any conflict (for example a deadline that does not fit).
Respond with a JSON object with keys summary and blocks; each block has date, projectId, size, note, reason.`

const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] }

/** JSON schema for structured output (all keys required, unused ones null). */
export const WEEK_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'blocks'],
  properties: {
    summary: { type: 'string' },
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['date', 'projectId', 'size', 'note', 'reason'],
        properties: {
          date: { type: 'string', format: 'date' },
          projectId: nullableString,
          size: { type: 'number', enum: [...BLOCK_SIZES] },
          note: nullableString,
          reason: nullableString,
        },
      },
    },
  },
}

const WEEKDAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const hours = (minutes: number) => `${Math.round(minutes / 6) / 10} h`

export function buildWeekPrompt(ctx: WeekContext): string {
  const settings = safeTimes(ctx.settings)
  const byId = new Map(ctx.projects.map((p) => [p.id, p]))
  const label = (projectId: string | null | undefined) =>
    !projectId ? 'chores/admin' : ctx.hiddenProjectIds.has(projectId) ? 'a private project' : byId.has(projectId) ? JSON.stringify(byId.get(projectId)!.name) : 'another project'
  const windowStart = hhmmToMinutes(settings.budgetStart)
  const windowEnd = hhmmToMinutes(settings.budgetEnd)

  const days = ctx.dates.map((date) => {
    const head = `- ${date} ${WEEKDAYS[isoWeekday(date)]}${date === ctx.today ? ' (today)' : ''}`
    const cap = dayCapacity(date, settings, ctx.events, ctx.blocks, ctx.tasks)
    if (!cap.isWorkDay) return `${head}: off`
    if (cap.fullDay) return `${head}: fully booked`
    const meetings = new Map<string, number>()
    for (const e of eventsOn(ctx.events, date).filter((e) => isBlocking(e) && !e.allDay)) {
      const minutes = Math.max(0, Math.min(hhmmToMinutes(e.end), windowEnd) - Math.max(hhmmToMinutes(e.start), windowStart))
      if (minutes === 0) continue
      const who = e.projectId ? label(e.projectId) : 'no project'
      meetings.set(who, (meetings.get(who) ?? 0) + minutes)
    }
    const meetingText = meetings.size ? `meetings ${hours(cap.meetingMinutes)} (${[...meetings].map(([who, m]) => `${who} ${hours(m)}`).join(', ')})` : 'no meetings'
    const planned = blocksOn(ctx.blocks, date)
    const blockText = planned.length ? `planned blocks: ${planned.map((b) => `${label(b.projectId)} ${b.size}`).join(', ')}` : 'no blocks yet'
    return `${head}: ${hours(cap.freeMinutes)} free; ${meetingText}; ${blockText}`
  })

  const rangeEnd = ctx.dates[ctx.dates.length - 1]
  const openWork = (projectId: string | null) => {
    const open = ctx.tasks.filter((t) => t.projectId === projectId && isOpen(t) && t.status !== 'someday')
    const minutes = open.reduce((sum, t) => sum + (t.estimateMinutes ?? 30), 0)
    const deadlines = open.map((t) => t.dueDate).filter((d): d is ISODate => !!d).sort(compareISO)
    return `${open.length} open tasks (~${hours(minutes)})${deadlines[0] ? `, earliest task deadline ${deadlines[0]}` : ''}`
  }
  const projects = ctx.projects.map((p) => {
    const goal = p.goals?.[0]?.text?.trim()
    const blocked = ctx.blocks.filter((b) => b.projectId === p.id && ctx.dates.includes(b.date)).length
    return [
      `- ${p.id} · ${JSON.stringify(p.name)}`,
      p.dueDate ? `due ${p.dueDate}` : null,
      goal ? `goal ${JSON.stringify(goal.slice(0, 160))}` : null,
      openWork(p.id),
      blocked ? `already blocked on ${blocked} day(s) in the range` : null,
    ]
      .filter(Boolean)
      .join(' · ')
  })

  return [
    `Today: ${ctx.today}${ctx.now ? `, now ${ctx.now}` : ''}. Range: ${ctx.dates[0]} to ${rangeEnd}.`,
    `Write summary, notes and reasons in ${ctx.locale === 'de' ? 'German' : 'English'}.`,
    `A full-day block is ${settings.dayCapacityHours} h of focused work. Working hours ${settings.workdayStart}–${settings.workdayEnd}.`,
    '',
    'Days:',
    ...days,
    '',
    'Projects that may be planned (id · name · due · goal · open work):',
    ...(projects.length ? projects : ['(none)']),
    '',
    `Chores/admin (projectId null): ${openWork(null)}.`,
  ].join('\n')
}

/** Shape-only parse of the model answer; the capacity check happens in fitProposal. */
export function parseWeekProposal(raw: string): WeekProposal {
  const json = extractJsonObject(raw)
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const rawBlocks = Array.isArray(json.blocks) ? json.blocks : []
  const blocks: ProposedBlock[] = []
  for (const x of rawBlocks) {
    if (!x || typeof x !== 'object') continue
    const b = x as Record<string, unknown>
    const size = Number(b.size)
    if (typeof b.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.date) || !BLOCK_SIZES.includes(size as BlockSize)) continue
    blocks.push({ date: b.date, projectId: str(b.projectId), size: size as BlockSize, note: str(b.note)?.slice(0, 80) ?? null, reason: str(b.reason)?.slice(0, 240) ?? null })
  }
  return { summary: str(json.summary) ?? '', blocks, dropped: rawBlocks.length - blocks.length }
}

/** Fit tolerance: a proposal may exceed a day's work time by this much (rounding of block sizes). */
const TOLERANCE_MINUTES = 15

/**
 * Keeps only blocks that are allowed and fit: a planned date that is a work day and not fully booked,
 * a known project (or chores), no second block for the same project and day, and the day's capacity
 * (computed exactly as in Week and Today, including blocks accepted before) not exceeded.
 */
export function fitProposal(proposal: WeekProposal, ctx: WeekContext): WeekProposal {
  const dates = new Set(ctx.dates)
  const projects = new Set(ctx.projects.map((p) => p.id))
  const accepted: PlanBlock[] = []
  const out: ProposedBlock[] = []
  for (const b of proposal.blocks) {
    if (!dates.has(b.date) || (b.projectId !== null && !projects.has(b.projectId))) continue
    const sameDay = [...ctx.blocks, ...accepted].filter((x) => x.date === b.date)
    if (sameDay.some((x) => x.projectId === b.projectId)) continue
    const candidate: PlanBlock = { id: `proposal-${accepted.length}`, date: b.date, projectId: b.projectId, size: b.size }
    const cap = dayCapacity(b.date, ctx.settings, ctx.events, [...ctx.blocks, ...accepted, candidate], ctx.tasks)
    if (!cap.isWorkDay || cap.fullDay || cap.uncoveredMeetingMinutes + cap.blockMinutes > cap.workMinutes + TOLERANCE_MINUTES) continue
    accepted.push(candidate)
    out.push(b)
  }
  return { summary: proposal.summary, blocks: out, dropped: proposal.dropped + proposal.blocks.length - out.length }
}
