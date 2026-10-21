import type { Locale, ISODate } from '@/domain/types'
import { NotConfigured, api } from '@/sync/api'
import { useStore } from '@/store/useStore'
import { buildClarifyContext, type ClarifySuggestion } from './clarify'
import type { WeekProposal } from './week'
import { aiEnabled, loadAiSettings } from './settings'

export type { ClarifySuggestion } from './clarify'
export type { ProposedBlock, WeekProposal } from './week'
export * from './settings'

export interface AiServerStatus {
  configured: boolean
  provider: 'anthropic' | 'openai' | null
  model: string | null
  clarifyModel: string | null
}

export class NoAiKey extends Error {
  constructor() {
    super('no_ai_key')
  }
}

export const getAiStatus = () => api<AiServerStatus>('/api/ai/status')

/**
 * "Auto" suggestion for one inbox item. The local server makes the call with the key from .env and
 * builds the overview (projects, open and recently done tasks) from the database; private items only
 * when they are shown. Only if the server has no key configured does the browser fall back to a key
 * stored in this browser (legacy), with the same overview built from this browser's data.
 */
export async function suggestClarification(input: { text: string; today: ISODate; locale: Locale; includePrivate: boolean }): Promise<ClarifySuggestion> {
  try {
    return await api<ClarifySuggestion>('/api/ai/clarify', { method: 'POST', body: JSON.stringify(input), timeoutMs: 120_000 })
  } catch (err) {
    if (!(err instanceof NotConfigured)) throw err
    const settings = loadAiSettings()
    if (!aiEnabled(settings)) throw new NoAiKey()
    const { suggestFromBrowser } = await import('./browser')
    const { projects, tasks } = useStore.getState()
    return suggestFromBrowser(input.text, buildClarifyContext({ projects, tasks }, input), settings)
  }
}

/**
 * Week proposal: the server reads projects, deadlines, calendar and blocks from the database and returns
 * additional blocks that fit into the free time. Needs the server's AI key (no browser fallback).
 */
export const proposeWeek = (input: { start: ISODate; days: number; today: ISODate; now: string; locale: Locale; includePrivate: boolean }) =>
  api<WeekProposal>('/api/ai/week', { method: 'POST', body: JSON.stringify(input), timeoutMs: 240_000 })
