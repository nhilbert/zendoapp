import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Locale } from '@/domain/types'
import { parseIcs } from '@/domain/ics'
import { useStore, type DataSnapshot } from '@/store/useStore'
import { changeLocale } from '@/i18n'
import { type AiProvider, type AiSettings, DEFAULT_MODELS, loadAiSettings, saveAiSettings } from '@/ai/settings'
import { type M365Status, ServiceUnavailable, connect, disconnect, getStatus, syncCalendar } from '@/calendar/m365'
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
  const [m365, setM365] = useState<{ status?: M365Status; busy: boolean; message?: string; error?: string; down?: boolean }>({ busy: false })
  useEffect(() => {
    getStatus()
      .then((status) => setM365((m) => ({ ...m, status, down: false })))
      .catch((e) => setM365((m) => ({ ...m, down: e instanceof ServiceUnavailable, error: e instanceof ServiceUnavailable ? undefined : String(e.message) })))
  }, [])
  const m365Action = async (action: 'connect' | 'sync' | 'disconnect') => {
    setM365((m) => ({ ...m, busy: true, message: undefined, error: undefined }))
    try {
      if (action === 'connect') {
        const status = await connect()
        setM365((m) => ({ ...m, status }))
        const r = await syncCalendar()
        setM365((m) => ({ ...m, message: t('settings.synced', { total: r.total, kept: r.kept, removed: r.removed }) }))
      } else if (action === 'sync') {
        const r = await syncCalendar()
        setM365((m) => ({ ...m, message: t('settings.synced', { total: r.total, kept: r.kept, removed: r.removed }) }))
      } else {
        const status = await disconnect()
        updateSettings({ calendar: undefined })
        setM365((m) => ({ ...m, status, message: undefined }))
      }
    } catch (e) {
      setM365((m) => ({ ...m, down: e instanceof ServiceUnavailable, error: e instanceof ServiceUnavailable ? t('settings.serviceDown') : String((e as Error).message) }))
    } finally {
      setM365((m) => ({ ...m, busy: false }))
    }
  }
  const [ai, setAi] = useState<AiSettings>(() => loadAiSettings())
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

  const download = () => {
    const blob = new Blob([JSON.stringify(exportData(), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `zendo-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const onJson = async (file: File) => {
    const snap = JSON.parse(await file.text()) as DataSnapshot
    importData(snap)
    changeLocale(snap.settings?.locale ?? settings.locale)
    if (jsonRef.current) jsonRef.current.value = ''
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
              <Input type="time" step={900} value={settings.workdayStart} onChange={(e) => updateSettings({ workdayStart: e.target.value })} />
            </Field>
            <Field label={t('settings.end')}>
              <Input type="time" step={900} value={settings.workdayEnd} onChange={(e) => updateSettings({ workdayEnd: e.target.value })} />
            </Field>
            <Field label={t('settings.capacity')}>
              <Input type="number" min={1} max={16} step={0.5} value={settings.dayCapacityHours} onChange={(e) => updateSettings({ dayCapacityHours: Number(e.target.value) || 8 })} />
            </Field>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Field label={t('settings.budgetStart')} hint={t('settings.budgetHint')}>
              <Input type="time" step={900} value={settings.budgetStart} onChange={(e) => updateSettings({ budgetStart: e.target.value })} />
            </Field>
            <Field label={t('settings.budgetEnd')}>
              <Input type="time" step={900} value={settings.budgetEnd} onChange={(e) => updateSettings({ budgetEnd: e.target.value })} />
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
            ) : m365.status?.connected ? (
              <span className="text-ink">
                {t('settings.connectedAs', { account: m365.status.account ?? '' })}
                {settings.calendar?.lastSync && (
                  <span className="text-ink-3"> · {t('settings.lastSync', { time: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(settings.calendar.lastSync)) })}</span>
                )}
              </span>
            ) : (
              <span className="text-ink-3">{t('settings.notConnected')}</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {!m365.status?.connected && (
              <Button variant="primary" disabled={m365.busy || m365.down} onClick={() => void m365Action('connect')}>
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
          <p className="mb-3 text-[13px] text-ink-2">{t('settings.aiHint')}</p>
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
        </section>

        <section>
          <SectionLabel>{t('settings.data')}</SectionLabel>
          <p className="mb-3 text-[13px] text-ink-2">{t('settings.dataHint')}</p>
          <input ref={jsonRef} type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && onJson(e.target.files[0])} />
          <div className="flex flex-wrap gap-2">
            <Button onClick={download}>{t('settings.export')}</Button>
            <Button onClick={() => jsonRef.current?.click()}>{t('settings.import')}</Button>
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
