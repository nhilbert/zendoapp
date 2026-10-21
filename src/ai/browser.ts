import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { CLARIFY_SYSTEM_PROMPT, buildClarifyPrompt, parseClarifySuggestion, type ClarifyContext, type ClarifySuggestion } from './clarify'
import { DEFAULT_MODELS, type AiSettings } from './settings'

/**
 * Fallback only: calls the provider directly from the browser with a key stored in this browser.
 * Used when the local server has no AI key configured. Prefer ANTHROPIC_API_KEY / OPENAI_API_KEY in .env.
 * Loaded lazily so the SDKs never weigh on the initial bundle.
 */
export async function suggestFromBrowser(text: string, ctx: ClarifyContext, settings: AiSettings): Promise<ClarifySuggestion> {
  const user = buildClarifyPrompt(text, ctx)
  const model = settings.model.trim() || (settings.provider === 'none' ? '' : DEFAULT_MODELS[settings.provider])
  if (settings.provider === 'anthropic') {
    const client = new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true })
    const response = await client.messages.create({
      model,
      max_tokens: 2048,
      system: CLARIFY_SYSTEM_PROMPT,
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: user }],
    })
    if (response.stop_reason === 'refusal') throw new Error('ai_refused')
    return parseClarifySuggestion(
      response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join(''),
      ctx,
    )
  }
  if (settings.provider === 'openai') {
    const client = new OpenAI({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true })
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: CLARIFY_SYSTEM_PROMPT },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
    })
    return parseClarifySuggestion(response.choices[0]?.message?.content ?? '', ctx)
  }
  throw new Error('not_configured')
}
