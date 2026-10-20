import type { CalendarEvent } from '@/domain/types'
import { addDaysISO, startOfWeekISO, todayISO } from '@/domain/dates'
import { useStore } from '@/store/useStore'
import { api } from '@/sync/api'

export { NotConfigured, ServiceUnavailable } from '@/sync/api'

/**
 * Client for the calendar routes of the local Zendo server (server/calendar.ts),
 * reached through the Vite proxy in dev. The server owns the Microsoft 365 token
 * cache; the browser never sees tokens.
 */
export interface M365Status {
  connected: boolean
  account: string | null
}

export const getStatus = () => api<M365Status>('/api/calendar/status')
export const connect = () => api<M365Status>('/api/calendar/connect', { method: 'POST', timeoutMs: 180_000 })
export const disconnect = () => api<M365Status>('/api/calendar/disconnect', { method: 'POST' })

/** Sync range: last week … five weeks ahead (covers the two-week plan and the review). */
export function syncRange(): { from: string; to: string } {
  const from = addDaysISO(startOfWeekISO(todayISO()), -7)
  return { from, to: addDaysISO(from, 7 + 35) }
}

export async function syncCalendar(): Promise<{ total: number; kept: number; removed: number; account: string | null }> {
  const { from, to } = syncRange()
  const data = await api<{ events: Omit<CalendarEvent, 'id'>[]; account: string | null }>(`/api/calendar/events?from=${from}&to=${to}`, { timeoutMs: 60_000 })
  const store = useStore.getState()
  const result = store.importEvents(
    data.events.map((e) => ({ ...e, id: crypto.randomUUID() })),
    'm365',
  )
  store.updateSettings({ calendar: { account: data.account, lastSync: new Date().toISOString() } })
  return { ...result, account: data.account }
}
