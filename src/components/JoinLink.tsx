import { useTranslation } from 'react-i18next'
import { Video } from 'lucide-react'
import type { VisibleEvent } from '@/store/visible'
import { PROVIDER_NAME, joinHref, joinUrlOf, meetingProvider } from '@/domain/meeting'
import { cx } from './ui'

/** Phones and tablets open web meeting links in the installed app themselves; computers get the app link directly. */
const APP_LINKS = typeof navigator !== 'undefined' && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

/**
 * One click into the online meeting, as in Outlook. Nothing without a link or for a masked (private, hidden) event.
 * `iconOnPhone`: in tight rows on phones only a round video icon (24px, WCAG 2.5.8) so the title stays readable; the label from md up.
 */
export function JoinLink({ event, className, iconOnPhone }: { event: Pick<VisibleEvent, 'joinUrl' | 'location' | 'masked'>; className?: string; iconOnPhone?: boolean }) {
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
      aria-label={title}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-1 rounded-full bg-accent-soft text-[11px] font-medium leading-none text-accent transition-colors hover:bg-accent hover:text-accent-ink',
        iconOnPhone ? 'h-6 w-6 md:h-5 md:w-auto md:px-2' : 'h-5 px-2',
        className,
      )}
    >
      <Video size={iconOnPhone ? 13 : 11} aria-hidden className={iconOnPhone ? 'md:h-[11px] md:w-[11px]' : undefined} />
      <span className={iconOnPhone ? 'hidden md:inline' : undefined}>{t('event.join')}</span>
    </a>
  )
}
