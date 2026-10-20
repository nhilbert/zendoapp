/**
 * Online meeting links (Teams, Zoom, Webex, Google Meet): found in calendar data, opened by the Join button.
 * Pure and dependency-free, used by the server (Outlook import) and the browser (ICS import, buttons).
 */

export type MeetingProvider = 'teams' | 'zoom' | 'webex' | 'meet'

const PROVIDERS: [MeetingProvider, RegExp][] = [
  ['teams', /(^|\.)teams\.(microsoft|live)\.com$/],
  ['zoom', /(^|\.)zoom\.(us|com)$/],
  ['webex', /(^|\.)webex\.com$/],
  ['meet', /^meet\.google\.com$/],
]

export const PROVIDER_NAME: Record<MeetingProvider, string> = { teams: 'Teams', zoom: 'Zoom', webex: 'Webex', meet: 'Google Meet' }

/** A link that may be opened from Zendo: http(s) only, never javascript:, data: or file: from calendar data. */
export function safeJoinUrl(raw: string | null | undefined): string | undefined {
  if (!raw?.trim()) return undefined
  try {
    const url = new URL(raw.trim())
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined
  } catch {
    return undefined
  }
}

export function meetingProvider(url: string): MeetingProvider | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return PROVIDERS.find(([, re]) => re.test(host))?.[0]
  } catch {
    return undefined
  }
}

/** The first video-meeting link in free text (location, description); other links (maps, websites) are ignored. */
export function findMeetingUrl(...texts: (string | null | undefined)[]): string | undefined {
  for (const text of texts) {
    for (const match of (text ?? '').matchAll(/https?:\/\/[^\s<>"'()[\]]+/gi)) {
      const url = safeJoinUrl(match[0].replace(/[.,;:!?]+$/, ''))
      if (url && meetingProvider(url)) return url
    }
  }
  return undefined
}

/** The event's join link: the stored one, else a meeting link typed into the location. */
export function joinUrlOf(event: { joinUrl?: string; location?: string }): string | undefined {
  return safeJoinUrl(event.joinUrl) ?? findMeetingUrl(event.location)
}

/**
 * What the Join button opens. On a computer, Teams and Zoom links go straight to the installed app
 * (msteams: / zoommtg:), as Outlook does; elsewhere, and for other links, the web link (on phones it opens the app).
 */
export function joinHref(url: string, opts: { app: boolean }): string {
  if (!opts.app) return url
  const u = new URL(url)
  const provider = meetingProvider(url)
  if (provider === 'teams' && u.hostname === 'teams.microsoft.com' && u.pathname.startsWith('/l/')) return `msteams:${u.pathname}${u.search}`
  const zoomId = provider === 'zoom' ? /^\/j\/(\d+)/.exec(u.pathname)?.[1] : undefined
  if (zoomId) {
    const pwd = u.searchParams.get('pwd')
    return `zoommtg://${u.hostname}/join?action=join&confno=${zoomId}${pwd ? `&pwd=${encodeURIComponent(pwd)}` : ''}`
  }
  return url
}
