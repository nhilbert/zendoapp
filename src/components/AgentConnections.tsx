import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@/sync/api'
import { useLocale } from '@/components/TaskBits'
import { Button, SectionLabel } from '@/components/ui'

interface Connection {
  id: string
  name: string
  user: string
  createdAt: string
  lastUsedAt: string | null
}

/** Settings: AI agents connected over OAuth to /mcp (docs/mcp.md), each can be disconnected. */
export function AgentConnections() {
  const { t } = useTranslation()
  const locale = useLocale()
  // undefined = loading, null = OAuth is off on the server (the route answers not_found)
  const [list, setList] = useState<Connection[] | null | undefined>(undefined)
  const [error, setError] = useState('')
  const load = () =>
    api<{ connections: Connection[] }>('/api/mcp/connections')
      .then((r) => {
        setList(r.connections)
        setError('')
      })
      .catch((e: Error) => {
        if (e.message === 'not_found') setList(null)
        else {
          setList((l) => l ?? [])
          setError(t('settings.agentsError', { error: e.message }))
        }
      })
  useEffect(() => {
    void load()
  }, [])
  const fmt = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
  const disconnect = async (c: Connection) => {
    if (!window.confirm(t('settings.agentsDisconnectConfirm', { name: c.name }))) return
    try {
      await api(`/api/mcp/connections/${encodeURIComponent(c.id)}`, { method: 'DELETE' })
      void load()
    } catch (e) {
      setError(t('settings.agentsError', { error: (e as Error).message }))
    }
  }
  if (list === undefined) return null
  return (
    <section>
      <SectionLabel>{t('settings.agents')}</SectionLabel>
      <p className="mb-3 text-[13px] text-ink-2">{list === null ? t('settings.agentsOff') : t('settings.agentsHint')}</p>
      {error && <p className="mb-2 text-[13px] text-amber">{error}</p>}
      {list && list.length === 0 && !error && <p className="text-[13px] text-ink-3">{t('settings.agentsNone')}</p>}
      {list && list.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {list.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
              <div className="min-w-0">
                <div className="truncate text-ink">{c.name}</div>
                <div className="text-[12px] text-ink-3">
                  {t('settings.agentsSince', { date: fmt(c.createdAt), user: c.user })}
                  {c.lastUsedAt && <> · {t('settings.agentsLastUsed', { date: fmt(c.lastUsedAt) })}</>}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => void disconnect(c)}>
                {t('settings.disconnect')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
