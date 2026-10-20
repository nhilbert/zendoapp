import type { Locale, ISODate } from '@/domain/types'
import { NotConfigured, api } from '@/sync/api'
import type { ClarifySuggestion } from './clarify'
import { aiEnabled, loadAiSettings } from './settings'

export type { ClarifySuggestion } from './clarify'
export * from './settings'

export interface AiServerStatus {
  configured: boolean
  provider: 'anthropic' | 'openai' | null
  model: string | null
}

export class NoAiKey extends Error {
  constructor() {
    super('no_ai_key')
  }
}

export const getAiStatus = () => api<AiServerStatus>('/api/ai/status')

/**
 * "Auto" suggestion for one inbox item. The local server makes the call with the key from .env
 * and reads the project names from the database. Only if the server has no key configured does
 * the browser fall back to a key stored in this browser (legacy).
 */
export async function suggestClarification(input: { text: string; projects: string[]; today: ISODate; locale: Locale }): Promise<ClarifySuggestion> {
  try {
    return await api<ClarifySuggestion>('/api/ai/clarify', { method: 'POST', body: JSON.stringify({ text: input.text, locale: input.locale }), timeoutMs: 120_000 })
  } catch (err) {
    if (!(err instanceof NotConfigured)) throw err
    const settings = loadAiSettings()
    if (!aiEnabled(settings)) throw new NoAiKey()
    const { suggestFromBrowser } = await import('./browser')
    return suggestFromBrowser(input, settings)
  }
}
