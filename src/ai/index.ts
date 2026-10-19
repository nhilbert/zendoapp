import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import type { ISODate, Locale, Priority } from '@/domain/types'

/**
 * AI assistance for Zendo.
 *
 * Prototype note: the browser calls the provider directly with the user's own
 * key (stored only in localStorage under its own key, excluded from exports).
 * The target architecture routes these calls through the local server so the
 * key never lives in the browser – see docs/architecture.md.
 */
import { DEFAULT_MODELS, type AiSettings } from './settings'

export * from './settings'

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

const SYSTEM_PROMPT = `You help a consultant and facilitator clarify raw inbox notes following Getting Things Done.
Given one inbox note and the list of the user's active projects, decide what it is and formulate it.
Rules:
- kind: "task" if it is a single concrete action; "project" if it needs several actions; "meeting" if it is a dated appointment; "someday" if it is an idea without commitment; "trash" if it is noise.
- title: for a task, the concrete NEXT PHYSICAL ACTION, verb first (e.g. "Call Jana about …", "Draft agenda for …"). Keep the language of the note (German stays German). Max 80 characters.
- projectName: one of the given project names if the note clearly belongs to it, else null. Never invent a project name here.
- newProjectName / goal (one sentence, the project's main goal): only when kind is "project".
- estimateMinutes: one of 15, 30, 60, 120, 240, 480.
- priority: "high" only for clearly urgent/important, otherwise "normal" or "low".
- dueDate: only if the note states a hard external deadline. plannedDate: only if the note says when the user wants to do it. ISO format YYYY-MM-DD, relative to today.
- note: optional short context to keep, max 200 characters. reasoning: one short sentence.
Respond with ONLY a JSON object with keys: kind, title, projectName, newProjectName, goal, estimateMinutes, priority, dueDate, plannedDate, note, reasoning.`

function buildUserPrompt(input: { text: string; projects: string[]; today: ISODate; locale: Locale }): string {
  return [
    `Today: ${input.today} (ISO). User interface language: ${input.locale}.`,
    `Active projects: ${input.projects.length ? input.projects.map((p) => `"${p}"`).join(', ') : '(none)'}`,
    `Inbox note:`,
    `"""${input.text}"""`,
  ].join('\n')
}

function parseSuggestion(raw: string): ClarifySuggestion {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  const json = JSON.parse(cleaned.slice(start, end + 1)) as Partial<ClarifySuggestion>
  const kinds = ['task', 'project', 'meeting', 'someday', 'trash'] as const
  const kind = kinds.includes(json.kind as (typeof kinds)[number]) ? (json.kind as ClarifySuggestion['kind']) : 'task'
  const priorities: Priority[] = ['high', 'normal', 'low']
  return {
    kind,
    title: typeof json.title === 'string' && json.title.trim() ? json.title.trim() : '',
    projectName: typeof json.projectName === 'string' ? json.projectName : null,
    newProjectName: typeof json.newProjectName === 'string' ? json.newProjectName : null,
    goal: typeof json.goal === 'string' ? json.goal : null,
    estimateMinutes: typeof json.estimateMinutes === 'number' ? json.estimateMinutes : null,
    priority: priorities.includes(json.priority as Priority) ? (json.priority as Priority) : null,
    dueDate: typeof json.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(json.dueDate) ? json.dueDate : null,
    plannedDate: typeof json.plannedDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(json.plannedDate) ? json.plannedDate : null,
    note: typeof json.note === 'string' ? json.note : null,
    reasoning: typeof json.reasoning === 'string' ? json.reasoning : null,
  }
}

export async function suggestClarification(
  input: { text: string; projects: string[]; today: ISODate; locale: Locale },
  settings: AiSettings,
): Promise<ClarifySuggestion> {
  const user = buildUserPrompt(input)
  const model = settings.model.trim() || (settings.provider === 'none' ? '' : DEFAULT_MODELS[settings.provider])

  if (settings.provider === 'anthropic') {
    const client = new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true })
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: user }],
    })
    if (response.stop_reason === 'refusal') throw new Error('The model declined this request.')
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
    return parseSuggestion(text)
  }

  if (settings.provider === 'openai') {
    const client = new OpenAI({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true })
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
    })
    return parseSuggestion(response.choices[0]?.message?.content ?? '')
  }

  throw new Error('AI is not configured.')
}
