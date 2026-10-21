import { Hono } from 'hono'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import type { Repo } from './repo.ts'
import { BadRequest } from './repo.ts'
import { CLARIFY_SYSTEM_PROMPT, buildClarifyContext, buildClarifyPrompt, clarifySchema, parseClarifySuggestion } from '../src/ai/clarify.ts'
import { WEEK_SCHEMA, WEEK_SYSTEM_PROMPT, buildWeekPrompt, fitProposal, parseWeekProposal } from '../src/ai/week.ts'
import type { CalendarEvent, Locale, PlanBlock, Project, Settings, Task } from '../src/domain/types.ts'
import { DEFAULT_SETTINGS } from '../src/domain/types.ts'
import { isHHMM, isISODate, rangeISO, todayISO } from '../src/domain/dates.ts'
import { visibleBlocks } from '../src/domain/selectors.ts'

export type AiProviderName = 'anthropic' | 'openai'

export interface AiConfig {
  provider?: AiProviderName
  model?: string
  /** Model for Clarify (ZENDO_AI_CLARIFY_MODEL); sorting one note needs less than planning a week. */
  clarifyModel?: string
  anthropicKey?: string
  openaiKey?: string
}

export const DEFAULT_SERVER_MODELS: Record<AiProviderName, string> = { anthropic: 'claude-opus-5-5', openai: 'gpt-5' }
/** Clarify without ZENDO_AI_CLARIFY_MODEL: Sonnet for Claude; for OpenAI the main model (set e.g. a mid-tier model by hand). */
export const DEFAULT_CLARIFY_MODELS: Record<AiProviderName, string | null> = { anthropic: 'claude-sonnet-5-5', openai: null }

export interface ResolvedAi {
  provider: AiProviderName
  model: string
  clarifyModel: string
  complete: Complete
}

/** Per call: the output schema, how hard the model thinks, and the output cap. */
export interface CompleteOptions {
  schema: Record<string, unknown>
  effort: 'low' | 'medium' | 'high'
  maxTokens?: number
  /** Overrides the main model for this call (Clarify). */
  model?: string
}

/** A model call: system prompt + user prompt → raw text (JSON expected). Injectable for tests. */
export type Complete = (system: string, user: string, options: CompleteOptions) => Promise<string>

/** Resolves provider and model from the environment: explicit ZENDO_AI_PROVIDER, else whichever key exists (Claude first). */
export function resolveAi(cfg: AiConfig): ResolvedAi | null {
  const provider: AiProviderName | undefined = cfg.provider ?? (cfg.anthropicKey ? 'anthropic' : cfg.openaiKey ? 'openai' : undefined)
  if (!provider) return null
  const model = cfg.model?.trim() || DEFAULT_SERVER_MODELS[provider]
  const clarifyModel = cfg.clarifyModel?.trim() || DEFAULT_CLARIFY_MODELS[provider] || model
  if (provider === 'anthropic') {
    if (!cfg.anthropicKey) return null
    const client = new Anthropic({ apiKey: cfg.anthropicKey })
    const complete: Complete = async (system, user, options) => {
      // Server-side refusal fallback: if a safety classifier declines, the API reruns on a suitable model.
      const response = await client.beta.messages.create({
        model: options.model ?? model,
        max_tokens: options.maxTokens ?? 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system,
        output_config: { effort: options.effort, format: { type: 'json_schema', schema: options.schema } },
        messages: [{ role: 'user', content: user }],
      })
      if (response.stop_reason === 'refusal') throw new Error('ai_refused')
      if (response.stop_reason === 'max_tokens') throw new Error('ai_truncated')
      return response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
    }
    return { provider, model, clarifyModel, complete }
  }
  if (!cfg.openaiKey) return null
  const client = new OpenAI({ apiKey: cfg.openaiKey })
  const complete: Complete = async (system, user, options) => readOpenAiAnswer(await client.chat.completions.create(openAiRequest(options.model ?? model, system, user, options)))
  return { provider, model, clarifyModel, complete }
}

/** The OpenAI request: the same schema (strict), effort and output cap as for Claude. */
export function openAiRequest(model: string, system: string, user: string, options: CompleteOptions): OpenAI.Chat.ChatCompletionCreateParamsNonStreaming {
  return {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'zendo_answer', schema: options.schema, strict: true } },
    max_completion_tokens: options.maxTokens ?? 16000,
    // Only reasoning models (o-series, GPT-5) accept an effort; other chat models reject the parameter.
    ...(/^(o\d|gpt-5)/.test(model) ? { reasoning_effort: options.effort } : {}),
  }
}

export function readOpenAiAnswer(response: OpenAI.Chat.ChatCompletion): string {
  const choice = response.choices[0]
  if (choice?.message?.refusal) throw new Error('ai_refused')
  if (choice?.finish_reason === 'length') throw new Error('ai_truncated')
  return choice?.message?.content ?? ''
}

/**
 * Status and error code for a failed AI call. Never 502/504: the browser reads those as "Zendo server
 * not reachable" (that is what the dev proxy and Caddy answer when it is down), so upstream failures are 500.
 */
export function describeError(err: unknown): { status: 400 | 401 | 429 | 500; error: string } {
  if (err instanceof Anthropic.AuthenticationError || err instanceof OpenAI.AuthenticationError) return { status: 401, error: 'ai_auth' }
  if (err instanceof Anthropic.RateLimitError || err instanceof OpenAI.RateLimitError) return { status: 429, error: 'ai_rate_limited' }
  if (err instanceof Anthropic.BadRequestError || err instanceof OpenAI.BadRequestError) return { status: 400, error: `ai_bad_request: ${(err as Error).message.slice(0, 200)}` }
  if (err instanceof Anthropic.APIConnectionError || err instanceof OpenAI.APIConnectionError) return { status: 500, error: 'ai_unreachable' }
  return { status: 500, error: (err as Error)?.message || 'ai_error' }
}

/**
 * AI routes, mounted at /api/ai. The key comes from .env and never reaches the browser.
 * The server builds the prompts itself from the database (Clarify: the overview of src/ai/clarify.ts).
 */
export function aiRoutes(repo: Repo, ai: ResolvedAi | null): Hono {
  const app = new Hono()
  app.get('/status', (c) => c.json({ configured: !!ai, provider: ai?.provider ?? null, model: ai?.model ?? null, clarifyModel: ai?.clarifyModel ?? null }))
  app.post('/clarify', async (c) => {
    if (!ai) return c.json({ error: 'not_configured' }, 503)
    const body = (await c.req.json().catch(() => ({}))) as { text?: unknown; locale?: unknown; today?: unknown; includePrivate?: unknown }
    if (typeof body.text !== 'string' || !body.text.trim()) throw new BadRequest('text required')
    const locale: Locale = body.locale === 'de' ? 'de' : 'en'
    const state = repo.loadState()
    const ctx = buildClarifyContext(
      { projects: state.projects as unknown as Project[], tasks: state.tasks as unknown as Task[] },
      // the browser's date (the server may run in another time zone); private items only while they are shown
      { today: isISODate(body.today) ? body.today : todayISO(), locale, includePrivate: body.includePrivate === true },
    )
    try {
      const raw = await ai.complete(CLARIFY_SYSTEM_PROMPT, buildClarifyPrompt(body.text.slice(0, 4000), ctx), { schema: clarifySchema(ctx), effort: 'low', model: ai.clarifyModel })
      return c.json(parseClarifySuggestion(raw, ctx))
    } catch (err) {
      const { status, error } = describeError(err)
      console.error('AI clarify failed:', error)
      return c.json({ error }, status)
    }
  })

  /**
   * Week proposal: additional plan blocks for the given range, fitted into each day's free time.
   * The browser sends its own date and time (the server may run in another time zone) and whether
   * private projects are shown; private ones are otherwise left out and never named.
   */
  app.post('/week', async (c) => {
    if (!ai) return c.json({ error: 'not_configured' }, 503)
    const body = (await c.req.json().catch(() => ({}))) as { start?: unknown; days?: unknown; today?: unknown; now?: unknown; locale?: unknown; includePrivate?: unknown }
    if (!isISODate(body.start)) throw new BadRequest('start required')
    const today = isISODate(body.today) ? body.today : todayISO()
    const now = isHHMM(body.now) ? body.now : undefined
    const days = Math.min(14, Math.max(1, Math.round(Number(body.days)) || 7))
    const dates = rangeISO(body.start, days).filter((d) => d >= today)
    if (dates.length === 0) return c.json({ summary: '', blocks: [], dropped: 0 })
    const includePrivate = body.includePrivate === true
    const state = repo.loadState()
    const allProjects = state.projects as unknown as Project[]
    const hiddenProjectIds = new Set(allProjects.filter((p) => p.private && !includePrivate).map((p) => p.id))
    const ctx = {
      today,
      now: dates[0] === today ? now : undefined,
      locale: (body.locale === 'de' ? 'de' : 'en') as Locale,
      dates,
      settings: { ...DEFAULT_SETTINGS, ...(state.settings ?? {}) } as Settings,
      projects: allProjects.filter((p) => p.status === 'active' && !hiddenProjectIds.has(p.id)),
      tasks: (state.tasks as unknown as Task[]).filter((t) => includePrivate || (!t.private && !(t.projectId && hiddenProjectIds.has(t.projectId)))),
      events: state.events as unknown as CalendarEvent[],
      // as in Week and Today: archived projects' blocks no longer take time; private ones always do
      blocks: visibleBlocks(state.blocks as unknown as PlanBlock[], allProjects, false),
      hiddenProjectIds,
    }
    try {
      const raw = await ai.complete(WEEK_SYSTEM_PROMPT, buildWeekPrompt(ctx), { schema: WEEK_SCHEMA, effort: 'medium' })
      return c.json(fitProposal(parseWeekProposal(raw), ctx))
    } catch (err) {
      const { status, error } = describeError(err)
      console.error('AI week proposal failed:', error)
      return c.json({ error }, status)
    }
  })
  return app
}
