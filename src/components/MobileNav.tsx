import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router'
import { useTranslation } from 'react-i18next'
import { BookOpen, CalendarRange, Columns3, Eye, EyeOff, Folder, Inbox, ListChecks, MoreHorizontal, Plus, Settings, Sun } from 'lucide-react'
import { useUi } from '@/store/useUi'
import { useStore } from '@/store/useStore'
import { useSync } from '@/store/useSync'
import { cx } from './ui'

const MORE = [
  { to: '/week', key: 'nav.week', icon: CalendarRange },
  { to: '/clarify', key: 'nav.clarify', icon: ListChecks },
  { to: '/board', key: 'nav.board', icon: Columns3 },
  { to: '/review', key: 'nav.review', icon: BookOpen },
  { to: '/settings', key: 'nav.settings', icon: Settings },
] as const

/** Bottom navigation for small screens: the four things done on the go, plus a calm "more" sheet. */
export default function MobileNav() {
  const { t } = useTranslation()
  const location = useLocation()
  const openCapture = useUi((s) => s.openCapture)
  const hidePrivate = useStore((s) => !!s.settings.hidePrivate)
  const updateSettings = useStore((s) => s.updateSettings)
  const syncStatus = useSync((s) => s.status)
  const [moreOpen, setMoreOpen] = useState(false)
  useEffect(() => setMoreOpen(false), [location.pathname])
  const inMore = MORE.some((m) => location.pathname.startsWith(m.to))

  const tab = (isActive: boolean) =>
    cx('flex min-w-0 flex-1 flex-col items-center gap-0.5 pt-2 pb-1 text-[11px] transition-colors', isActive ? 'text-ink' : 'text-ink-3')

  return (
    <>
      {moreOpen && (
        <div className="fixed inset-0 z-40 bg-ink/15 backdrop-blur-[2px] md:hidden" onClick={() => setMoreOpen(false)}>
          <div
            className="fade-in absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-line bg-surface px-4 pt-3 pb-[calc(5.5rem+env(safe-area-inset-bottom))] shadow-[var(--shadow)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line-2" />
            <nav className="flex flex-col">
              {MORE.map(({ to, key, icon: Icon }) => (
                <NavLink key={to} to={to} className={({ isActive }) => cx('flex items-center gap-3 rounded-lg px-3 py-3 text-[15px]', isActive ? 'bg-surface-2 text-ink' : 'text-ink-2')}>
                  <Icon size={18} strokeWidth={1.75} className="text-ink-3" />
                  {t(key)}
                </NavLink>
              ))}
            </nav>
            <button
              type="button"
              onClick={() => updateSettings({ hidePrivate: !hidePrivate })}
              className={cx('mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-3 text-[15px]', hidePrivate ? 'text-ink' : 'text-ink-2')}
            >
              {hidePrivate ? <EyeOff size={18} strokeWidth={1.75} className="text-ink-3" /> : <Eye size={18} strokeWidth={1.75} className="text-ink-3" />}
              {hidePrivate ? t('privacy.hidden') : t('privacy.visible')}
            </button>
            {(syncStatus === 'offline' || syncStatus === 'local' || syncStatus === 'conflict') && (
              <p className="px-3 pt-2 text-[13px] text-amber">{t(`sync.${syncStatus}Short`)}</p>
            )}
          </div>
        </div>
      )}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <NavLink to="/today" className={({ isActive }) => tab(isActive)}>
          <Sun size={20} strokeWidth={1.75} />
          {t('nav.today')}
        </NavLink>
        <NavLink to="/inbox" className={({ isActive }) => tab(isActive)}>
          <Inbox size={20} strokeWidth={1.75} />
          {t('nav.inbox')}
        </NavLink>
        <button type="button" onClick={openCapture} aria-label={t('capture.button')} className="flex flex-1 items-center justify-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-accent-ink shadow-[var(--shadow)]">
            <Plus size={22} strokeWidth={2} />
          </span>
        </button>
        <NavLink to="/projects" className={({ isActive }) => tab(isActive)}>
          <Folder size={20} strokeWidth={1.75} />
          {t('nav.projects')}
        </NavLink>
        <button type="button" onClick={() => setMoreOpen((o) => !o)} className={tab(inMore || moreOpen)}>
          <MoreHorizontal size={20} strokeWidth={1.75} />
          {t('nav.more')}
          {(syncStatus === 'offline' || syncStatus === 'local' || syncStatus === 'conflict') && <span className="sr-only">{t(`sync.${syncStatus}Short`)}</span>}
        </button>
      </nav>
    </>
  )
}
