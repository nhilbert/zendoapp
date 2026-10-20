import { useTranslation } from 'react-i18next'
import { Video } from 'lucide-react'
import type { VisibleEvent } from '@/store/visible'
import { PROVIDER_NAME, joinHref, joinUrlOf, meetingProvider } from '@/domain/meeting'
import { cx } from './ui'

/** Phones and tablets open web meeting links in the installed app themselves; computers get the app link directly. */
const APP_LINKS = typeof navigator !== 'undefined' && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

/** One click into the online meeting, as in Outlook. Nothing without a link or for a masked (private, hidden) event. */
export function JoinLink({ event, className }: { event: Pick<VisibleEvent, 'joinUrl' | 'location' | 'masked'>; className?: string }) {
  const { t } = useTranslation()
  const url = event.masked ? undefined : joinUrlOf(event)
  if (!url) return null
  const provider = meetingProvider(url)
  const title = provider ? t('event.joinWith', { app: PROVIDER_NAME[provider] }) : t('event.join')
  const href = joinHref(url, { app: APP_LINKS })
  // App links (msteams:, zoommtg:) open the app from this page; web links get their own browser tab.
  const web = href.startsWith('http')
  return (
    <a
      href={href}
      target={web ? '_blank' : undefined}
      rel={web ? 'noopener noreferrer' : undefined}
      title={title}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className={cx('inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-accent-soft px-2 text-[11px] font-medium leading-none text-accent transition-colors hover:bg-accent hover:text-accent-ink', className)}
    >
      <Video size={11} />
      {t('event.join')}
    </a>
  )
}
