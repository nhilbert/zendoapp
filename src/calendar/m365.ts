import { useStore } from '@/store/useStore'
import { api } from '@/sync/api'
import { refreshNow } from '@/sync/server'

export { NotConfigured, ServiceUnavailable } from '@/sync/api'

/**
 * Client for the calendar routes of the local Zendo server (server/calendar.ts),
 * reached through the Vite proxy in dev. The server owns the Microsoft 365 token
 * cache; the browser never sees tokens.
 */
export interface M365Status {
  connected: boolean
  account: string | null
  lastSync?: string | null
}

export const getStatus = () => api<M365Status>('/api/calendar/status')
export const connect = () => api<M365Status>('/api/calendar/connect', { method: 'POST', timeoutMs: 180_000 })
export const disconnect = () => api<M365Status>('/api/calendar/disconnect', { method: 'POST' })

/**
 * Asks the server to fetch the calendar and write it into the database (the server also does this
 * at start and every 15 minutes), then pulls the updated state.
 */
export async function syncCalendar(): Promise<{ total: number; kept: number; removed: number; account: string | null; lastSync: string }> {
  const result = await api<{ total: number; kept: number; removed: number; account: string | null; lastSync: string }>('/api/calendar/sync', { method: 'POST', timeoutMs: 120_000 })
  useStore.getState().updateSettings({ calendar: { account: result.account, lastSync: result.lastSync } })
  await refreshNow()
  return result
}
