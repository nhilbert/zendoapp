import { useEffect } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { BookOpen, CalendarRange, Columns3, Eye, EyeOff, Folder, Inbox, ListChecks, Settings, Sun } from 'lucide-react'
import { useUi } from '@/store/useUi'
import { useStore } from '@/store/useStore'
import { useSync } from '@/store/useSync'
import QuickCapture from './QuickCapture'
import TaskDrawer from './TaskDrawer'
import EventDialog from './EventDialog'
import SyncConflictDialog from './SyncConflictDialog'
import MobileNav from './MobileNav'
import { Kbd, cx, isTyping } from './ui'

const NAV = [
  { to: '/today', key: 'nav.today', icon: Sun, shortcut: 't' },
  { to: '/week', key: 'nav.week', icon: CalendarRange, shortcut: 'w' },
  { to: '/inbox', key: 'nav.inbox', icon: Inbox, shortcut: 'i' },
  { to: '/clarify', key: 'nav.clarify', icon: ListChecks, shortcut: 'c' },
  { to: '/projects', key: 'nav.projects', icon: Folder, shortcut: 'p' },
  { to: '/board', key: 'nav.board', icon: Columns3, shortcut: 'b' },
  { to: '/review', key: 'nav.review', icon: BookOpen, shortcut: 'r' },
] as const

/** Server trouble (offline, browser only, sign-in expired) stays visible, also in focus mode without the sidebar. */
function SyncNotice({ className }: { className?: string }) {
  const { t } = useTranslation()
  const syncStatus = useSync((s) => s.status)
  if (syncStatus === 'offline' || syncStatus === 'local') {
    return (
      <NavLink to="/settings" className={cx('text-[12px] text-amber hover:underline', className)}>
        {t(`sync.${syncStatus}Short`)}
      </NavLink>
    )
  }
  if (syncStatus === 'signin') {
    return (
      <button type="button" onClick={() => window.location.reload()} title={t('sync.signin')} className={cx('text-left text-[12px] text-amber hover:underline', className)}>
        {t('sync.signinShort')}
      </button>
    )
  }
  return null
}

export default function AppShell() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  // Focus mode (/focus/:id): no navigation, only the project – capture and dialogs stay available.
  const focus = useLocation().pathname.startsWith('/focus/')
  const openCapture = useUi((s) => s.openCapture)
  const closeAll = useUi((s) => s.closeAll)
  const hidePrivate = useStore((s) => !!s.settings.hidePrivate)
  const updateSettings = useStore((s) => s.updateSettings)
  const togglePrivate = () => updateSettings({ hidePrivate: !useStore.getState().settings.hidePrivate })

  useEffect(() => {
    let pendingGo = false
    let timer: number | undefined
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape') {
        closeAll()
        return
      }
      if (isTyping(e.target)) return
      if (pendingGo) {
        pendingGo = false
        const hit = NAV.find((n) => n.shortcut === e.key)
        if (hit) {
          e.preventDefault()
          navigate(hit.to)
        }
        return
      }
      if (e.key === 'g') {
        pendingGo = true
        window.clearTimeout(timer)
        timer = window.setTimeout(() => (pendingGo = false), 1500)
        return
      }
      if (e.key === 'n') {
        e.preventDefault()
        openCapture()
        return
      }
      if (e.key === 'h') {
        e.preventDefault()
        togglePrivate()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(timer)
    }
  }, [navigate, openCapture, closeAll]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex min-h-dvh">
      {!focus && (
        <aside className="sticky top-0 hidden h-dvh w-[216px] shrink-0 flex-col border-r border-line px-4 py-7 md:flex">
          <div className="mb-8 flex items-center gap-2 px-2">
            <span className="inline-block h-3 w-3 rounded-full border-[2.5px] border-accent" />
            <span className="text-[15px] font-medium tracking-[-0.01em]">{t('app.name')}</span>
          </div>
          <nav className="flex flex-col gap-0.5">
            {NAV.map(({ to, key, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cx(
                    'flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[14px] transition-colors',
                    isActive ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
                  )
                }
              >
                <Icon size={16} strokeWidth={1.75} className="text-ink-3" />
                {t(key)}
              </NavLink>
            ))}
          </nav>
          <div className="mt-auto flex flex-col gap-3 px-2.5">
            <SyncNotice />
            <button
              type="button"
              onClick={togglePrivate}
              title={t('settings.shortcutPrivate')}
              className={cx('flex items-center gap-2.5 rounded-lg py-1.5 text-[13px] transition-colors hover:text-ink', hidePrivate ? 'text-ink' : 'text-ink-3')}
            >
              {hidePrivate ? <EyeOff size={15} strokeWidth={1.75} /> : <Eye size={15} strokeWidth={1.75} />}
              {hidePrivate ? t('privacy.hidden') : t('privacy.visible')}
              <span className="ml-auto">
                <Kbd>h</Kbd>
              </span>
            </button>
            <button
              type="button"
              onClick={openCapture}
              className="flex items-center justify-between rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              {t('capture.button')} <Kbd>n</Kbd>
            </button>
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                cx('flex items-center gap-2.5 rounded-lg py-1.5 text-[13px] transition-colors', isActive ? 'text-ink' : 'text-ink-3 hover:text-ink')
              }
            >
              <Settings size={15} strokeWidth={1.75} />
              {t('nav.settings')}
            </NavLink>
          </div>
        </aside>
      )}
      <main className={cx('min-w-0 flex-1 px-4 pt-5 md:px-12', focus ? 'pb-10 md:py-8' : 'pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:py-10')}>
        <Outlet />
      </main>
      {!focus && <MobileNav />}
      {focus && <SyncNotice className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-4 z-30 rounded-full border border-line bg-surface px-3 py-1.5" />}
      <QuickCapture />
      <TaskDrawer />
      <EventDialog />
      <SyncConflictDialog />
    </div>
  )
}
