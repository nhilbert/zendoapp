import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSync } from '@/store/useSync'
import { resolveConflict } from '@/sync/server'
import { Button, Modal } from './ui'

/** Shown once when this browser's data and the server's data differ on first contact. */
export default function SyncConflictDialog() {
  const { t } = useTranslation()
  const status = useSync((s) => s.status)
  const conflict = useSync((s) => s.conflict)
  const [busy, setBusy] = useState(false)
  if (status !== 'conflict' || !conflict) return null
  const choose = async (choice: 'browser' | 'server') => {
    setBusy(true)
    try {
      await resolveConflict(choice)
    } finally {
      setBusy(false)
    }
  }
  const line = (c: { projects: number; tasks: number; inbox: number }) =>
    `${c.projects} ${t('nav.projects')} · ${c.tasks} ${t('project.tasks')} · ${c.inbox} ${t('nav.inbox')}`
  return (
    <Modal open onClose={() => {}} width="max-w-xl">
      <h2 className="text-[17px] font-medium">{t('sync.conflictTitle')}</h2>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{t('sync.conflictBody')}</p>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
        <dt className="text-ink-3">{t('sync.inBrowser')}</dt>
        <dd className="tnum">{line(conflict.local)}</dd>
        <dt className="text-ink-3">{t('sync.onServer')}</dt>
        <dd className="tnum">{line(conflict.server)}</dd>
      </dl>
      <p className="mt-3 text-[12px] text-ink-3">{t('sync.conflictBackup')}</p>
      <div className="mt-5 flex flex-col gap-2">
        <Button disabled={busy} onClick={() => void choose('browser')}>
          {t('sync.keepBrowser')}
        </Button>
        <Button disabled={busy} onClick={() => void choose('server')}>
          {t('sync.keepServer')}
        </Button>
      </div>
    </Modal>
  )
}
