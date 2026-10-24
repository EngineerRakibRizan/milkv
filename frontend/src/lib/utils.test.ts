import { describe, expect, it } from 'vitest'
import { shiftDate } from './utils'

describe('shiftDate', () => {
  it('moves across month and year boundaries in local time', () => {
    expect(shiftDate('2026-10-31', 1)).toBe('2026-11-01')
    expect(shiftDate('2026-01-01', -1)).toBe('2025-12-31')
    expect(shiftDate('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('never shifts by a day because of the UTC offset', () => {
    // Asia/Dhaka is UTC+6: a toISOString()-based version would return 2026-10-23 here.
    expect(shiftDate('2026-10-24', 0)).toBe('2026-10-24')
  })
})
