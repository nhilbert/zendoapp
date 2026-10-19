/** AI settings live in their own localStorage key so they are never part of data exports. */
export type AiProvider = 'none' | 'anthropic' | 'openai'

export interface AiSettings {
  provider: AiProvider
  apiKey: string
  model: string
}

export const DEFAULT_MODELS: Record<Exclude<AiProvider, 'none'>, string> = {
  anthropic: 'claude-opus-5-5',
  openai: 'gpt-5',
}

const STORAGE_KEY = 'zendo.ai'

export function loadAiSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { provider: 'none', apiKey: '', model: '', ...(JSON.parse(raw) as Partial<AiSettings>) }
  } catch {
    /* ignore */
  }
  return { provider: 'none', apiKey: '', model: '' }
}

export function saveAiSettings(s: AiSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}

export function aiEnabled(s: AiSettings): boolean {
  return s.provider !== 'none' && s.apiKey.trim().length > 0
}
