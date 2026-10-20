type AiErrorKey = 'clarify.ai.errAuth' | 'clarify.ai.errRate' | 'clarify.ai.errRefused' | 'clarify.ai.errServer' | 'sync.signin'

/** User-facing text for a failed AI call (error codes from server/ai.ts and src/sync/api.ts). */
export function aiErrorText(err: unknown, t: (k: AiErrorKey) => string): string {
  const m = err instanceof Error ? err.message : String(err)
  if (m === 'ai_auth') return t('clarify.ai.errAuth')
  if (m === 'ai_rate_limited') return t('clarify.ai.errRate')
  if (m === 'ai_refused') return t('clarify.ai.errRefused')
  if (m === 'service_unavailable') return t('clarify.ai.errServer')
  if (m === 'login_required') return t('sync.signin')
  return m
}
