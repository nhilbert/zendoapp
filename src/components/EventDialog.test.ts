import { describe, expect, it } from 'vitest'
import { isValidEventTimes } from './EventDialog'

describe('isValidEventTimes', () => {
  it('rejects empty or reversed times and bad dates', () => {
    expect(isValidEventTimes({ date: '2026-10-20', start: '09:00', end: '10:00' })).toBe(true)
    expect(isValidEventTimes({ date: '2026-10-20', start: '09:00', end: '' })).toBe(false)
    expect(isValidEventTimes({ date: '2026-10-20', start: '10:00', end: '09:00' })).toBe(false)
    expect(isValidEventTimes({ date: '', start: '09:00', end: '10:00' })).toBe(false)
    expect(isValidEventTimes({ date: '2026-10-20', start: '', end: '', allDay: true })).toBe(true)
  })
})
