type AiErrorKey =
  | 'clarify.ai.errAuth'
  | 'clarify.ai.errRate'
  | 'clarify.ai.errRefused'
  | 'clarify.ai.errTruncated'
  | 'clarify.ai.errBadResponse'
  | 'clarify.ai.errUnreachable'
  | 'clarify.ai.errTimeout'
  | 'clarify.ai.errServer'
  | 'sync.signin'

/** User-facing text for a failed AI call (error codes from server/ai.ts, src/ai/clarify.ts and src/sync/api.ts). */
export function aiErrorText(err: unknown, t: (k: AiErrorKey) => string): string {
  const m = err instanceof Error ? err.message : String(err)
  if (m === 'ai_auth') return t('clarify.ai.errAuth')
  if (m === 'ai_rate_limited') return t('clarify.ai.errRate')
  if (m === 'ai_refused') return t('clarify.ai.errRefused')
  if (m === 'ai_truncated') return t('clarify.ai.errTruncated')
  if (m === 'ai_bad_response') return t('clarify.ai.errBadResponse')
  if (m === 'ai_unreachable') return t('clarify.ai.errUnreachable')
  if (m === 'timeout') return t('clarify.ai.errTimeout')
  if (m === 'service_unavailable') return t('clarify.ai.errServer')
  if (m === 'login_required') return t('sync.signin')
  return m
}
