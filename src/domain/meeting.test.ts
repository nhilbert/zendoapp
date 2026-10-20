import { describe, expect, it } from 'vitest'
import { findMeetingUrl, joinHref, joinUrlOf, meetingProvider, safeJoinUrl } from './meeting'

const TEAMS = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%22Tid%22%3a%22t%22%7d'
const ZOOM = 'https://us02web.zoom.us/j/81234567890?pwd=abc.1'

describe('meeting links', () => {
  it('only lets web links through, never script or file links from calendar data', () => {
    expect(safeJoinUrl(` ${TEAMS} `)).toBe(TEAMS)
    expect(safeJoinUrl('javascript:alert(1)')).toBeUndefined()
    expect(safeJoinUrl('data:text/html,<b>x</b>')).toBeUndefined()
    expect(safeJoinUrl('file:///C:/x.exe')).toBeUndefined()
    expect(safeJoinUrl('not a link')).toBeUndefined()
    expect(safeJoinUrl('')).toBeUndefined()
  })

  it('recognises Teams, Zoom, Webex and Meet, and nothing else', () => {
    expect(meetingProvider(TEAMS)).toBe('teams')
    expect(meetingProvider('https://teams.live.com/meet/9876')).toBe('teams')
    expect(meetingProvider(ZOOM)).toBe('zoom')
    expect(meetingProvider('https://acme.webex.com/meet/jana')).toBe('webex')
    expect(meetingProvider('https://meet.google.com/abc-defg-hij')).toBe('meet')
    expect(meetingProvider('https://maps.google.com/?q=Köln')).toBeUndefined()
    expect(meetingProvider('https://zoom.us.evil.example/j/1')).toBeUndefined()
  })

  it('finds the meeting link in free text and skips other links', () => {
    expect(findMeetingUrl('Büro Köln, https://maps.google.com/?q=1', `Join Zoom Meeting ${ZOOM}. Meeting ID: 812 3456 7890`)).toBe(ZOOM)
    expect(findMeetingUrl(`Microsoft Teams-Besprechung <${TEAMS}>`)).toBe(TEAMS)
    expect(findMeetingUrl('Raum 3', undefined, null)).toBeUndefined()
  })

  it('takes the stored link first, else a meeting link typed into the location', () => {
    expect(joinUrlOf({ joinUrl: TEAMS, location: ZOOM })).toBe(TEAMS)
    expect(joinUrlOf({ location: `Zoom ${ZOOM}` })).toBe(ZOOM)
    expect(joinUrlOf({ joinUrl: 'javascript:alert(1)' })).toBeUndefined()
  })

  it('opens Teams and Zoom in the app on a computer, the web link elsewhere', () => {
    expect(joinHref(TEAMS, { app: true })).toBe('msteams:/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%22Tid%22%3a%22t%22%7d')
    expect(joinHref(ZOOM, { app: true })).toBe('zoommtg://us02web.zoom.us/join?action=join&confno=81234567890&pwd=abc.1')
    expect(joinHref('https://zoom.us/j/123', { app: true })).toBe('zoommtg://zoom.us/join?action=join&confno=123')
    // links the apps cannot take directly stay web links
    expect(joinHref('https://teams.live.com/meet/9876', { app: true })).toBe('https://teams.live.com/meet/9876')
    expect(joinHref('https://zoom.us/my/jana', { app: true })).toBe('https://zoom.us/my/jana')
    expect(joinHref('https://meet.google.com/abc-defg-hij', { app: true })).toBe('https://meet.google.com/abc-defg-hij')
    expect(joinHref(TEAMS, { app: false })).toBe(TEAMS)
  })
})
