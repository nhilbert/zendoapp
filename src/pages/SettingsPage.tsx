import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Locale } from '@/domain/types'
import { parseIcs } from '@/domain/ics'
import { useStore } from '@/store/useStore'
import { isHHMM } from '@/domain/dates'
import { changeLocale } from '@/i18n'
import { type AiProvider, type AiSettings, DEFAULT_MODELS, loadAiSettings, saveAiSettings } from '@/ai/settings'
import { api } from '@/sync/api'
import { type M365Status, NotConfigured, ServiceUnavailable, connect, disconnect, getStatus, syncCalendar } from '@/calendar/m365'
import { useSync } from '@/store/useSync'
import { PRE_SYNC_BACKUP } from '@/sync/server'
import { useLocale } from '@/components/TaskBits'
import { Button, Field, Input, Kbd, PageHeader, SectionLabel, Segmented, Select, cx } from '@/components/ui'

export default function SettingsPage() {
  const { t } = useTranslation()
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const importEvents = useStore((s) => s.importEvents)
  const loadSample = useStore((s) => s.loadSample)
  const clearAll = useStore((s) => s.clearAll)
  const exportData = useStore((s) => s.exportData)
  const importData = useStore((s) => s.importData)
  const [icsMsg, setIcsMsg] = useState('')
  const locale = useLocale()
  const [m365, setM365] = useState<{ status?: M365Status; busy: boolean; message?: string; error?: string; down?: boolean; unconfigured?: boolean }>({ busy: false })
  const syncState = useSync()
  useEffect(() => {
    getStatus()
      .then((status) => setM365((m) => ({ ...m, status, down: false })))
      .catch((e) => setM365((m) => ({ ...m, down: e instanceof ServiceUnavailable, unconfigured: e instanceof NotConfigured, error: e instanceof ServiceUnavailable || e instanceof NotConfigured ? undefined : String(e.message) })))
  }, [])
  const m365Action = async (action: 'connect' | 'sync' | 'disconnect') => {
    setM365((m) => ({ ...m, busy: true, message: undefined, error: undefined }))
    try {
      if (action === 'connect') {
        const status = await connect()
        setM365((m) => ({ ...m, status }))
        const r = await syncCalendar()
        setM365((m) => ({ ...m, status: { ...status, lastSync: r.lastSync }, message: t('settings.synced', { total: r.total, kept: r.kept, removed: r.removed }) }))
      } else if (action === 'sync') {
        const r = await syncCalendar()
        setM365((m) => ({ ...m, status: m.status ? { ...m.status, lastSync: r.lastSync } : m.status, message: t('settings.synced', { total: r.total, kept: r.kept, removed: r.removed }) }))
      } else {
        const status = await disconnect()
        updateSettings({ calendar: undefined })
        setM365((m) => ({ ...m, status, message: undefined }))
      }
    } catch (e) {
      setM365((m) => ({ ...m, down: e instanceof ServiceUnavailable, unconfigured: e instanceof NotConfigured, error: e instanceof ServiceUnavailable ? t('settings.serviceDown') : e instanceof NotConfigured ? t('settings.m365NotConfigured') : String((e as Error).message) }))
    } finally {
      setM365((m) => ({ ...m, busy: false }))
    }
  }
  const [ai, setAi] = useState<AiSettings>(() => loadAiSettings())
  const [aiServer, setAiServer] = useState<{ configured: boolean; provider: string | null; model: string | null } | null>(null)
  useEffect(() => {
    api<{ configured: boolean; provider: string | null; model: string | null }>('/api/ai/status')
      .then(setAiServer)
      .catch(() => setAiServer(null))
  }, [])
  const icsRef = useRef<HTMLInputElement>(null)
  const jsonRef = useRef<HTMLInputElement>(null)

  const setLocale = (locale: Locale) => {
    updateSettings({ locale })
    changeLocale(locale)
  }

  const updateAi = (patch: Partial<AiSettings>) => {
    const next = { ...ai, ...patch }
    setAi(next)
    saveAiSettings(next)
  }

  const onIcs = async (file: File) => {
    const text = await file.text()
    const result = parseIcs(text)
    const { total, kept, removed } = importEvents(result.events, 'ics')
    setIcsMsg(t('settings.imported', { total, kept, removed, skipped: result.skippedRecurring }))
    if (icsRef.current) icsRef.current.value = ''
  }

  const downloadJson = (text: string, name: string) => {
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }
  const download = () => downloadJson(JSON.stringify(exportData(), null, 2), `zendo-export-${new Date().toISOString().slice(0, 10)}.json`)
  let preSyncBackup: string | null = null
  try {
    preSyncBackup = localStorage.getItem(PRE_SYNC_BACKUP)
  } catch {
    /* ignore */
  }

  const [jsonMsg, setJsonMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const onJson = async (file: File) => {
    try {
      const raw: unknown = JSON.parse(await file.text())
      if (!window.confirm(t('settings.importConfirm'))) return
      importData(raw as Parameters<typeof importData>[0])
      changeLocale(useStore.getState().settings.locale)
      setJsonMsg({ ok: true, text: t('settings.importDone') })
    } catch {
      setJsonMsg({ ok: false, text: t('settings.importInvalid') })
    } finally {
      if (jsonRef.current) jsonRef.current.value = ''
    }
  }
  /** Time inputs: ignore an emptied field instead of persisting '' (which would make every capacity NaN). */
  const timeChange = (key: 'workdayStart' | 'workdayEnd' | 'budgetStart' | 'budgetEnd') => (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isHHMM(e.target.value)) updateSettings({ [key]: e.target.value })
  }

  const toggleDay = (d: number) => {
    const set = new Set(settings.workDays)
    if (set.has(d)) set.delete(d)
    else set.add(d)
    updateSettings({ workDays: [...set].sort() })
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t('settings.title')} />
      <div className="flex flex-col gap-10">
        <section>
          <SectionLabel>{t('settings.language')}</SectionLabel>
          <Segmented<Locale>
            value={settings.locale}
            onChange={setLocale}
            options={[
              { value: 'en', label: t('settings.english') },
              { value: 'de', label: t('settings.german') },
            ]}
          />
        </section>

        <section>
          <SectionLabel>{t('settings.workday')}</SectionLabel>
          <div className="grid grid-cols-3 gap-3">
            <Field label={t('settings.start')}>
              <Input type="time" step={900} value={settings.workdayStart} onChange={timeChange('workdayStart')} />
            </Field>
            <Field label={t('settings.end')}>
              <Input type="time" step={900} value={settings.workdayEnd} onChange={timeChange('workdayEnd')} />
            </Field>
            <Field label={t('settings.capacity')}>
              <Input type="number" min={1} max={16} step={0.5} value={settings.dayCapacityHours} onChange={(e) => updateSettings({ dayCapacityHours: Number(e.target.value) || 8 })} />
            </Field>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Field label={t('settings.budgetStart')} hint={t('settings.budgetHint')}>
              <Input type="time" step={900} value={settings.budgetStart} onChange={timeChange('budgetStart')} />
            </Field>
            <Field label={t('settings.budgetEnd')}>
              <Input type="time" step={900} value={settings.budgetEnd} onChange={timeChange('budgetEnd')} />
            </Field>
          </div>
          <div className="mt-3">
            <div className="mb-1 text-[12px] font-medium text-ink-2">{t('settings.workDays')}</div>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(d)}
                  className={cx('h-8 w-10 rounded-lg border text-[12px] transition-colors', settings.workDays.includes(d) ? 'border-accent bg-accent-soft text-ink' : 'border-line text-ink-3 hover:bg-surface-2')}
                >
                  {t(`weekday.${d}` as 'weekday.1')}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section>
          <SectionLabel>{t('settings.m365')}</SectionLabel>
          <p className="mb-3 text-[13px] text-ink-2">{t('settings.m365Hint')}</p>
          <div className="mb-3 text-[13px]">
            {m365.down ? (
              <span className="text-amber">{t('settings.serviceDown')}</span>
            ) : m365.unconfigured ? (
              <span className="text-ink-3">{t('settings.m365NotConfigured')}</span>
            ) : m365.status?.connected ? (
              <span className="text-ink">
                {t('settings.connectedAs', { account: m365.status.account ?? '' })}
                {(m365.status.lastSync ?? settings.calendar?.lastSync) && (
                  <span className="text-ink-3"> · {t('settings.lastSync', { time: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date((m365.status.lastSync ?? settings.calendar?.lastSync)!)) })}</span>
                )}
              </span>
            ) : (
              <span className="text-ink-3">{t('settings.notConnected')}</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {!m365.status?.connected && (
              <Button variant="primary" disabled={m365.busy || m365.down || m365.unconfigured} onClick={() => void m365Action('connect')}>
                {t('settings.connect')}
              </Button>
            )}
            {m365.status?.connected && (
              <>
                <Button variant="primary" disabled={m365.busy} onClick={() => void m365Action('sync')}>
                  {t('settings.syncNow')}
                </Button>
                <Button variant="ghost" disabled={m365.busy} onClick={() => void m365Action('disconnect')}>
                  {t('settings.disconnect')}
                </Button>
              </>
            )}
          </div>
          {m365.message && <p className="fade-in mt-2 text-[12px] text-accent">{m365.message}</p>}
          {m365.error && !m365.down && <p className="fade-in mt-2 text-[12px] text-rose">{m365.error}</p>}
        </section>

        <section>
          <SectionLabel>{t('settings.calendar')}</SectionLabel>
          <p className="mb-3 text-[13px] text-ink-2">{t('settings.calendarHint')}</p>
          <input ref={icsRef} type="file" accept=".ics,text/calendar" className="hidden" onChange={(e) => e.target.files?.[0] && onIcs(e.target.files[0])} />
          <Button onClick={() => icsRef.current?.click()}>{t('settings.importIcs')}</Button>
          {icsMsg && <p className="fade-in mt-2 text-[12px] text-accent">{icsMsg}</p>}
        </section>

        <section>
          <SectionLabel>{t('settings.ai')}</SectionLabel>
          {aiServer?.configured ? (
            <p className="mb-3 text-[13px] text-ink">
              {t('settings.aiServer', { provider: aiServer.provider === 'openai' ? 'ChatGPT (OpenAI)' : 'Claude (Anthropic)', model: aiServer.model ?? '' })}
            </p>
          ) : (
            <p className="mb-3 text-[13px] text-ink-2">{t('settings.aiServerMissing')}</p>
          )}
          {aiServer?.configured ? (
            ai.apiKey && (
              <Button variant="ghost" size="sm" onClick={() => updateAi({ provider: 'none', apiKey: '', model: '' })}>
                {t('settings.aiRemoveBrowserKey')}
              </Button>
            )
          ) : (
            <details className="mt-1" open={!!ai.apiKey}>
              <summary className="cursor-pointer select-none text-[12px] text-ink-3">{t('settings.aiBrowserFallback')}</summary>
              <p className="my-3 text-[13px] text-ink-2">{t('settings.aiHint')}</p>
          <div className="grid grid-cols-[160px_1fr] gap-3">
            <Field label={t('settings.provider')}>
              <Select value={ai.provider} onChange={(e) => updateAi({ provider: e.target.value as AiProvider })}>
                <option value="none">{t('settings.off')}</option>
                <option value="anthropic">Claude (Anthropic)</option>
                <option value="openai">ChatGPT (OpenAI)</option>
              </Select>
            </Field>
            <Field label={t('settings.apiKey')}>
              <Input type="password" autoComplete="off" value={ai.apiKey} onChange={(e) => updateAi({ apiKey: e.target.value })} disabled={ai.provider === 'none'} />
            </Field>
          </div>
          {ai.provider !== 'none' && (
            <Field label={t('settings.model')} className="mt-3 w-72">
              <Input value={ai.model} placeholder={DEFAULT_MODELS[ai.provider]} onChange={(e) => updateAi({ model: e.target.value })} />
            </Field>
          )}
            </details>
          )}
        </section>

        <section>
          <SectionLabel>{t('settings.data')}</SectionLabel>
          <p className="mb-2 text-[13px] text-ink-2">{t('settings.dataHint')}</p>
          <p className={cx('mb-3 text-[13px]', syncState.status === 'online' ? 'text-ink-2' : syncState.status === 'connecting' ? 'text-ink-3' : 'text-amber')}>
            {t(`sync.${syncState.status}`)}
            {syncState.lastSync && syncState.status === 'online' && (
              <span className="text-ink-3"> · {t('sync.lastSync', { time: new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(new Date(syncState.lastSync)) })}</span>
            )}
            {syncState.pending > 0 && <span className="text-ink-3"> · {t('sync.pending', { count: syncState.pending })}</span>}
          </p>
          <input ref={jsonRef} type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && onJson(e.target.files[0])} />
          <div className="flex flex-wrap gap-2">
            <Button onClick={download}>{t('settings.export')}</Button>
            <Button onClick={() => jsonRef.current?.click()}>{t('settings.import')}</Button>
            {jsonMsg && <span className={cx('fade-in self-center text-[12px]', jsonMsg.ok ? 'text-accent' : 'text-rose')}>{jsonMsg.text}</span>}
          </div>
          {preSyncBackup && (
            <div className="mt-3">
              <Button variant="ghost" size="sm" onClick={() => downloadJson(preSyncBackup!, 'zendo-before-first-sync.json')}>
                {t('sync.downloadBackup')}
              </Button>
            </div>
          )}
          <div className="hidden">
            <Button
              variant="ghost"
              onClick={() => {
                if (window.confirm(t('settings.sampleConfirm'))) loadSample(settings.locale)
              }}
            >
              {t('settings.sample')}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (window.confirm(t('settings.clearConfirm'))) clearAll()
              }}
            >
              {t('settings.clear')}
            </Button>
          </div>
        </section>

        <section>
          <SectionLabel>{t('settings.shortcuts')}</SectionLabel>
          <ul className="flex flex-col gap-1.5 text-[13px] text-ink-2">
            <li className="flex items-center gap-2">
              <Kbd>n</Kbd> {t('settings.shortcutCapture')}
            </li>
            <li className="flex items-center gap-2">
              <Kbd>g</Kbd> {t('settings.shortcutGo')}
            </li>
            <li className="flex items-center gap-2">
              <Kbd>h</Kbd> {t('settings.shortcutPrivate')}
            </li>
            <li className="flex items-center gap-2">
              <Kbd>Esc</Kbd> {t('settings.shortcutEsc')}
            </li>
          </ul>
        </section>
      </div>
    </div>
  )
}
