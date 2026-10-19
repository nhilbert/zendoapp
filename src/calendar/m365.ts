import type { CalendarEvent } from '@/domain/types'
import { addDaysISO, startOfWeekISO, todayISO } from '@/domain/dates'
import { useStore } from '@/store/useStore'

/**
 * Client for the local calendar service (server/calendar.mjs), reached through the
 * Vite proxy at /api/calendar/*. The service owns the Microsoft 365 token cache;
 * the browser never sees tokens.
 */
export interface M365Status {
  connected: boolean
  account: string | null
}

export class ServiceUnavailable extends Error {
  constructor() {
    super('service_unavailable')
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, init)
  } catch {
    throw new ServiceUnavailable()
  }
  if (res.status >= 500) throw new ServiceUnavailable()
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? res.statusText)
  }
  return (await res.json()) as T
}

export const getStatus = () => call<M365Status>('/api/calendar/status')
export const connect = () => call<M365Status>('/api/calendar/connect', { method: 'POST' })
export const disconnect = () => call<M365Status>('/api/calendar/disconnect', { method: 'POST' })

/** Sync range: last week … five weeks ahead (covers the two-week plan and the review). */
export function syncRange(): { from: string; to: string } {
  const from = addDaysISO(startOfWeekISO(todayISO()), -7)
  return { from, to: addDaysISO(from, 7 + 35) }
}

export async function syncCalendar(): Promise<{ total: number; kept: number; removed: number; account: string | null }> {
  const { from, to } = syncRange()
  const data = await call<{ events: Omit<CalendarEvent, 'id'>[]; account: string | null }>(`/api/calendar/events?from=${from}&to=${to}`)
  const store = useStore.getState()
  const result = store.importEvents(
    data.events.map((e) => ({ ...e, id: crypto.randomUUID() })),
    'm365',
  )
  store.updateSettings({ calendar: { account: data.account, lastSync: new Date().toISOString() } })
  return { ...result, account: data.account }
}
