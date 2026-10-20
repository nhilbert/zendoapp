import { Hono } from 'hono'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import type { Repo } from './repo.ts'
import { BadRequest } from './repo.ts'
import { CLARIFY_SCHEMA, CLARIFY_SYSTEM_PROMPT, buildClarifyPrompt, parseClarifySuggestion } from '../src/ai/clarify.ts'
import type { Locale, Project } from '../src/domain/types.ts'
import { todayISO } from '../src/domain/dates.ts'

export type AiProviderName = 'anthropic' | 'openai'

export interface AiConfig {
  provider?: AiProviderName
  model?: string
  anthropicKey?: string
  openaiKey?: string
}

export const DEFAULT_SERVER_MODELS: Record<AiProviderName, string> = { anthropic: 'claude-opus-5-5', openai: 'gpt-5' }

/** A model call: system prompt + user prompt → raw text (JSON expected). Injectable for tests. */
export type Complete = (system: string, user: string) => Promise<string>

/** Resolves provider and model from the environment: explicit ZENDO_AI_PROVIDER, else whichever key exists (Claude first). */
export function resolveAi(cfg: AiConfig): { provider: AiProviderName; model: string; complete: Complete } | null {
  const provider: AiProviderName | undefined = cfg.provider ?? (cfg.anthropicKey ? 'anthropic' : cfg.openaiKey ? 'openai' : undefined)
  if (!provider) return null
  const model = cfg.model?.trim() || DEFAULT_SERVER_MODELS[provider]
  if (provider === 'anthropic') {
    if (!cfg.anthropicKey) return null
    const client = new Anthropic({ apiKey: cfg.anthropicKey })
    const complete: Complete = async (system, user) => {
      // Server-side refusal fallback: if a safety classifier declines, the API reruns on a suitable model.
      const response = await client.beta.messages.create({
        model,
        max_tokens: 2048,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: CLARIFY_SCHEMA } },
        messages: [{ role: 'user', content: user }],
      })
      if (response.stop_reason === 'refusal') throw new Error('ai_refused')
      if (response.stop_reason === 'max_tokens') throw new Error('ai_truncated')
      return response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
    }
    return { provider, model, complete }
  }
  if (!cfg.openaiKey) return null
  const client = new OpenAI({ apiKey: cfg.openaiKey })
  const complete: Complete = async (system, user) => {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
    })
    return response.choices[0]?.message?.content ?? ''
  }
  return { provider, model, complete }
}

function describeError(err: unknown): { status: 400 | 401 | 429 | 502; error: string } {
  if (err instanceof Anthropic.AuthenticationError || err instanceof OpenAI.AuthenticationError) return { status: 401, error: 'ai_auth' }
  if (err instanceof Anthropic.RateLimitError || err instanceof OpenAI.RateLimitError) return { status: 429, error: 'ai_rate_limited' }
  if (err instanceof Anthropic.BadRequestError || err instanceof OpenAI.BadRequestError) return { status: 400, error: `ai_bad_request: ${(err as Error).message.slice(0, 200)}` }
  if (err instanceof Anthropic.APIConnectionError || err instanceof OpenAI.APIConnectionError) return { status: 502, error: 'ai_unreachable' }
  return { status: 502, error: (err as Error)?.message ?? 'ai_error' }
}

/**
 * AI routes, mounted at /api/ai. The key comes from .env and never reaches the browser.
 * The server builds the prompt itself: project names (active and planned) are read from the database.
 */
export function aiRoutes(repo: Repo, ai: { provider: AiProviderName; model: string; complete: Complete } | null): Hono {
  const app = new Hono()
  app.get('/status', (c) => c.json({ configured: !!ai, provider: ai?.provider ?? null, model: ai?.model ?? null }))
  app.post('/clarify', async (c) => {
    if (!ai) return c.json({ error: 'not_configured' }, 503)
    const body = (await c.req.json().catch(() => ({}))) as { text?: unknown; locale?: unknown }
    if (typeof body.text !== 'string' || !body.text.trim()) throw new BadRequest('text required')
    const locale: Locale = body.locale === 'de' ? 'de' : 'en'
    const projects = (repo.loadState().projects as unknown as Project[]).filter((p) => p.status === 'active' || p.status === 'planned').map((p) => p.name)
    try {
      const raw = await ai.complete(CLARIFY_SYSTEM_PROMPT, buildClarifyPrompt({ text: body.text.slice(0, 4000), projects, today: todayISO(), locale }))
      return c.json(parseClarifySuggestion(raw))
    } catch (err) {
      const { status, error } = describeError(err)
      console.error('AI clarify failed:', error)
      return c.json({ error }, status)
    }
  })
  return app
}
