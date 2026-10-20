/**
 * Shared, dependency-free pieces of the "Auto" clarify suggestion: prompt, JSON schema and a tolerant parser.
 * Used by the server (server/ai.ts) and by the browser fallback (src/ai/browser.ts).
 */
import type { ISODate, Locale, Priority } from '../domain/types.ts'

export interface ClarifySuggestion {
  kind: 'task' | 'project' | 'meeting' | 'someday' | 'trash'
  title: string
  projectName: string | null
  newProjectName?: string | null
  goal?: string | null
  estimateMinutes?: number | null
  priority?: Priority | null
  dueDate?: ISODate | null
  plannedDate?: ISODate | null
  note?: string | null
  reasoning?: string | null
}

export interface ClarifyInput {
  text: string
  projects: string[]
  today: ISODate
  locale: Locale
}

export const CLARIFY_SYSTEM_PROMPT = `You help a consultant and facilitator clarify raw inbox notes following Getting Things Done.
Given one inbox note and the list of the user's projects, decide what it is and formulate it.
Rules:
- kind: "task" if it is a single concrete action; "project" if it needs several actions; "meeting" if it is a dated appointment; "someday" if it is an idea without commitment; "trash" if it is noise.
- title: for a task, the concrete NEXT PHYSICAL ACTION, verb first (e.g. "Call Jana about …", "Draft agenda for …"). Keep the language of the note (German stays German). Max 80 characters.
- projectName: one of the given project names if the note clearly belongs to it, else null. Never invent a project name here.
- newProjectName / goal (one sentence, the project's main goal): only when kind is "project".
- estimateMinutes: one of 15, 30, 60, 120, 240, 480.
- priority: "high" only for clearly urgent/important, otherwise "normal" or "low".
- dueDate: only if the note states a hard external deadline. plannedDate: only if the note says when the user wants to do it. ISO format YYYY-MM-DD, relative to today.
- note: optional short context to keep, max 200 characters. reasoning: one short sentence.
Respond with a JSON object with keys: kind, title, projectName, newProjectName, goal, estimateMinutes, priority, dueDate, plannedDate, note, reasoning.`

const nullable = (type: string, extra: Record<string, unknown> = {}) => ({ anyOf: [{ type, ...extra }, { type: 'null' }] })

/** JSON schema for structured output (all keys required, unused ones null). */
export const CLARIFY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'title', 'projectName', 'newProjectName', 'goal', 'estimateMinutes', 'priority', 'dueDate', 'plannedDate', 'note', 'reasoning'],
  properties: {
    kind: { type: 'string', enum: ['task', 'project', 'meeting', 'someday', 'trash'] },
    title: { type: 'string' },
    projectName: nullable('string'),
    newProjectName: nullable('string'),
    goal: nullable('string'),
    estimateMinutes: nullable('integer', { enum: [15, 30, 60, 120, 240, 480] }),
    priority: nullable('string', { enum: ['high', 'normal', 'low'] }),
    dueDate: nullable('string'),
    plannedDate: nullable('string'),
    note: nullable('string'),
    reasoning: nullable('string'),
  },
}

export function buildClarifyPrompt(input: ClarifyInput): string {
  return [
    `Today: ${input.today} (ISO). User interface language: ${input.locale}.`,
    `Projects: ${input.projects.length ? input.projects.map((p) => `"${p}"`).join(', ') : '(none)'}`,
    `Inbox note:`,
    `"""${input.text}"""`,
  ].join('\n')
}

/** Tolerant parser: accepts fenced or embedded JSON and drops anything that does not fit. */
export function parseClarifySuggestion(raw: string): ClarifySuggestion {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('ai_bad_response')
  const json = JSON.parse(cleaned.slice(start, end + 1)) as Partial<Record<keyof ClarifySuggestion, unknown>>
  const kinds = ['task', 'project', 'meeting', 'someday', 'trash'] as const
  const kind = kinds.includes(json.kind as (typeof kinds)[number]) ? (json.kind as ClarifySuggestion['kind']) : 'task'
  const priorities: Priority[] = ['high', 'normal', 'low']
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
  return {
    kind,
    title: str(json.title) ?? '',
    projectName: str(json.projectName),
    newProjectName: str(json.newProjectName),
    goal: str(json.goal),
    estimateMinutes: typeof json.estimateMinutes === 'number' && json.estimateMinutes > 0 ? json.estimateMinutes : null,
    priority: priorities.includes(json.priority as Priority) ? (json.priority as Priority) : null,
    dueDate: date(json.dueDate),
    plannedDate: date(json.plannedDate),
    note: str(json.note),
    reasoning: str(json.reasoning),
  }
}
