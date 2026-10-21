/**
 * Shared, dependency-free pieces of the "Auto" clarify suggestion: prompt, JSON schema and a tolerant parser.
 * Used by the server (server/ai.ts) and by the browser fallback (src/ai/browser.ts).
 */
import type { ISODate, Locale, Priority, Project, Task } from '../domain/types.ts'
import { addDaysISO, isISODate } from '../domain/dates.ts'

export interface ClarifySuggestion {
  kind: 'task' | 'project' | 'meeting' | 'someday' | 'trash'
  title: string
  /** The matched existing project (resolved from the reference the model chose), or null. */
  projectId: string | null
  projectName: string | null
  newProjectName?: string | null
  goal?: string | null
  estimateMinutes?: number | null
  priority?: Priority | null
  dueDate?: ISODate | null
  plannedDate?: ISODate | null
  note?: string | null
  reasoning?: string | null
  /** An existing open task the note concerns: it reports it done or answered ("completes"), or asks for it again ("duplicate"). */
  related?: { taskId: string; title: string; relation: 'completes' | 'duplicate' } | null
}

/** A project as the model sees it: a short reference (P1, P2 …) instead of the id. */
export interface ClarifyProject {
  ref: string
  id: string
  name: string
  status: Project['status']
  dueDate?: ISODate
  goals: string[]
  notes?: string
  nextAction?: string
}

export interface ClarifyTask {
  /** Open tasks only: a short reference (T1, T2 …) the answer can point at. */
  ref?: string
  id: string
  title: string
  /** Reference of its project; null for a chore. */
  projectRef: string | null
  status: Task['status']
  dueDate?: ISODate
  waitingFor?: string
  /** Done tasks only: the day it was completed. */
  doneOn?: ISODate
}

/** What the model gets besides the note: the projects it may choose from and the open (and recently done) work. */
export interface ClarifyContext {
  today: ISODate
  locale: Locale
  projects: ClarifyProject[]
  tasks: ClarifyTask[]
}

const RECENT_DONE_DAYS = 14
const MAX_OPEN_TASKS = 250
const MAX_DONE_TASKS = 40
const MAX_NOTES = 600
const MAX_TITLE = 120
const STATUS_ORDER: Task['status'][] = ['next', 'waiting', 'todo', 'someday']
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/**
 * The overview for one Clarify call: active and planned projects with goals, notes and next action;
 * open tasks of those projects and chores; tasks done in the last two weeks. Private projects and
 * tasks only when they are shown. No task notes or descriptions, no meetings.
 */
export function buildClarifyContext(data: { projects: Project[]; tasks: Task[] }, opts: { today: ISODate; locale: Locale; includePrivate: boolean }): ClarifyContext {
  const shown = data.projects
    .filter((p) => (p.status === 'active' || p.status === 'planned') && (opts.includePrivate || !p.private))
    .sort((a, b) => a.name.localeCompare(b.name))
  const refOf = new Map(shown.map((p, i) => [p.id, `P${i + 1}`]))
  const privateProjects = new Set(data.projects.filter((p) => p.private).map((p) => p.id))
  const visible = data.tasks.filter((t) => {
    if (!opts.includePrivate && (t.private || (t.projectId && privateProjects.has(t.projectId)))) return false
    return t.projectId === null || refOf.has(t.projectId)
  })
  const toTask = (t: Task, i: number): ClarifyTask => ({
    ref: t.status === 'done' ? undefined : `T${i + 1}`,
    id: t.id,
    title: clip(t.title, MAX_TITLE),
    projectRef: t.projectId ? refOf.get(t.projectId)! : null,
    status: t.status,
    dueDate: t.dueDate,
    waitingFor: t.status === 'waiting' ? t.waitingFor : undefined,
    doneOn: t.status === 'done' ? t.completedAt?.slice(0, 10) : undefined,
  })
  const open = visible
    .filter((t) => t.status !== 'done')
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MAX_OPEN_TASKS)
  const since = addDaysISO(opts.today, -RECENT_DONE_DAYS)
  const done = visible
    .filter((t) => t.status === 'done' && (t.completedAt ?? '') >= since)
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
    .slice(0, MAX_DONE_TASKS)
  return {
    today: opts.today,
    locale: opts.locale,
    projects: shown.map((p) => ({
      ref: refOf.get(p.id)!,
      id: p.id,
      name: p.name,
      status: p.status,
      dueDate: p.dueDate,
      goals: (p.goals ?? []).map((g) => g.text.trim()).filter(Boolean),
      notes: p.notes?.trim() ? clip(p.notes.trim(), MAX_NOTES) : undefined,
      nextAction: data.tasks.find((t) => t.projectId === p.id && t.status === 'next')?.title,
    })),
    tasks: [...open, ...done].map(toTask),
  }
}

export const CLARIFY_SYSTEM_PROMPT = `You help a consultant and facilitator clarify raw inbox notes following Getting Things Done.
You get an overview of the user's projects (with goals, notes and current next action) and of their open and recently done tasks, then one inbox note. Decide what the note is and formulate it.
Rules:
- kind: "task" if it is a single concrete action; "project" if it needs several actions; "meeting" if it is a dated appointment; "someday" if it is an idea without commitment; "trash" if it is noise.
- title: for a task, the concrete NEXT PHYSICAL ACTION, verb first (e.g. "Call Jana about …", "Draft agenda for …"). Keep the language of the note (German stays German). Max 80 characters.
- project: the ref (e.g. "P3") of the project the note belongs to, judged by name, goals and notes; null if none fits clearly or it is a chore.
- newProjectName / goal (one sentence, the project's main goal): only when kind is "project".
- estimateMinutes: one of 15, 30, 60, 120, 240, 480.
- priority: "high" only for clearly urgent/important, otherwise "normal" or "low".
- dueDate: only if the note states a hard external deadline. plannedDate: only if the note says when the user wants to do it; for a meeting, the meeting's date. ISO format YYYY-MM-DD, relative to today.
- note: optional short context to keep, max 200 characters.
- related: only if the note clearly concerns one open task (by its ref, e.g. "T4"): relation "completes" if the note reports that task done or answers what the user is waiting for; "duplicate" if the note asks for that task again. Otherwise null. Still fill in kind and title for anything new the note asks for; if it asks for nothing new, kind is "trash".
- reasoning: one short sentence. If the note matches work already done recently, say so here.
Respond with a JSON object with keys: kind, title, project, newProjectName, goal, estimateMinutes, priority, dueDate, plannedDate, note, reasoning, related.`

const nullable = (type: string, extra: Record<string, unknown> = {}) => ({ anyOf: [{ type, ...extra }, { type: 'null' }] })

/** JSON schema for structured output (all keys required, unused ones null); `project` can only be one of the refs. */
export function clarifySchema(ctx: Pick<ClarifyContext, 'projects' | 'tasks'>): Record<string, unknown> {
  const taskRefs = ctx.tasks.flatMap((t) => (t.ref ? [t.ref] : []))
  return {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'title', 'project', 'newProjectName', 'goal', 'estimateMinutes', 'priority', 'dueDate', 'plannedDate', 'note', 'reasoning', 'related'],
    properties: {
      kind: { type: 'string', enum: ['task', 'project', 'meeting', 'someday', 'trash'] },
      title: { type: 'string' },
      project: ctx.projects.length ? nullable('string', { enum: ctx.projects.map((p) => p.ref) }) : { type: 'null' },
      newProjectName: nullable('string'),
      goal: nullable('string'),
      estimateMinutes: nullable('integer', { enum: [15, 30, 60, 120, 240, 480] }),
      priority: nullable('string', { enum: ['high', 'normal', 'low'] }),
      dueDate: nullable('string'),
      plannedDate: nullable('string'),
      note: nullable('string'),
      reasoning: nullable('string'),
      related: taskRefs.length
        ? {
            anyOf: [
              {
                type: 'object',
                additionalProperties: false,
                required: ['task', 'relation'],
                properties: { task: { type: 'string', enum: taskRefs }, relation: { type: 'string', enum: ['completes', 'duplicate'] } },
              },
              { type: 'null' },
            ],
          }
        : { type: 'null' },
    },
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function taskLine(t: ClarifyTask): string {
  const extra = [t.dueDate && `due ${t.dueDate}`, t.waitingFor && `waiting for ${esc(t.waitingFor)}`, t.doneOn && `done ${t.doneOn}`].filter(Boolean)
  return `- ${t.ref ? `${t.ref} ` : ''}[${t.projectRef ?? 'chore'}] ${t.status}: ${esc(t.title)}${extra.length ? ` (${extra.join(', ')})` : ''}`
}

/** The overview first, the note last (long-context practice): projects, open tasks, recently done, then the note. */
export function buildClarifyPrompt(text: string, ctx: ClarifyContext): string {
  const projects = ctx.projects.map((p) =>
    [
      `<project ref="${p.ref}" status="${p.status}"${p.dueDate ? ` due="${p.dueDate}"` : ''}>`,
      `<name>${esc(p.name)}</name>`,
      ...(p.goals.length ? [`<goals>\n${p.goals.map((g) => `- ${esc(g)}`).join('\n')}\n</goals>`] : []),
      ...(p.notes ? [`<notes>${esc(p.notes)}</notes>`] : []),
      ...(p.nextAction ? [`<next_action>${esc(p.nextAction)}</next_action>`] : [`<next_action>none</next_action>`]),
      `</project>`,
    ].join('\n'),
  )
  const open = ctx.tasks.filter((t) => t.status !== 'done')
  const done = ctx.tasks.filter((t) => t.status === 'done')
  return [
    `<projects>\n${projects.join('\n') || '(none)'}\n</projects>`,
    `<open_tasks>\n${open.map(taskLine).join('\n') || '(none)'}\n</open_tasks>`,
    `<done_recently>\n${done.map(taskLine).join('\n') || '(none)'}\n</done_recently>`,
    `Today: ${ctx.today} (ISO). User interface language: ${ctx.locale}.`,
    `<inbox_note>\n${esc(text)}\n</inbox_note>`,
  ].join('\n\n')
}

/** The JSON object in a model answer; tolerates code fences and text around it. */
export function extractJsonObject(raw: string): Record<string, unknown> {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('ai_bad_response')
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    throw new Error('ai_bad_response')
  }
}

/** Tolerant parser: accepts fenced or embedded JSON and drops anything that does not fit; resolves the project ref. */
export function parseClarifySuggestion(raw: string, ctx: Pick<ClarifyContext, 'projects' | 'tasks'>): ClarifySuggestion {
  const json = extractJsonObject(raw) as Partial<Record<keyof ClarifySuggestion, unknown>>
  const kinds = ['task', 'project', 'meeting', 'someday', 'trash'] as const
  const kind = kinds.includes(json.kind as (typeof kinds)[number]) ? (json.kind as ClarifySuggestion['kind']) : 'task'
  const priorities: Priority[] = ['high', 'normal', 'low']
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const ref = str((json as Record<string, unknown>).project)
  const project = ref ? ctx.projects.find((p) => p.ref === ref) : undefined
  const rel = (json as Record<string, unknown>).related as { task?: unknown; relation?: unknown } | null | undefined
  const relatedTask = rel && typeof rel.task === 'string' ? ctx.tasks.find((t) => t.ref === rel.task) : undefined
  const relation = rel?.relation === 'completes' || rel?.relation === 'duplicate' ? rel.relation : undefined
  const date = (v: unknown) => (isISODate(v) ? v : null)
  return {
    kind,
    title: str(json.title) ?? '',
    projectId: project?.id ?? null,
    projectName: project?.name ?? null,
    newProjectName: str(json.newProjectName),
    goal: str(json.goal),
    estimateMinutes: typeof json.estimateMinutes === 'number' && json.estimateMinutes > 0 ? json.estimateMinutes : null,
    priority: priorities.includes(json.priority as Priority) ? (json.priority as Priority) : null,
    dueDate: date(json.dueDate),
    plannedDate: date(json.plannedDate),
    note: str(json.note),
    reasoning: str(json.reasoning),
    related: relatedTask && relation ? { taskId: relatedTask.id, title: relatedTask.title, relation } : null,
  }
}
