import { describe, expect, it } from 'vitest'
import type { OkxCandlePoint } from '../data/okx'
import { DAY_MS, findCalendarLevels, periodStart, type LevelPeriod } from './levels'

const hour = DAY_MS / 24
const base = Date.UTC(2024, 0, 1)
const bar = (time: number, open: number, low = open, high = open + 10, close = high): OkxCandlePoint => ({
  time, open, low, high, close, volumeBtc: 10,
})

describe('calendar levels', () => {
  it('uses UTC calendar boundaries across leap February and Monday weeks', () => {
    const leap = Date.UTC(2024, 1, 29, 23)
    expect(periodStart(leap, 'monthly')).toBe(Date.UTC(2024, 1, 1))
    expect(periodStart(leap, 'weekly')).toBe(Date.UTC(2024, 1, 26))
  })

  it.each([
    ['daily', 1, 1], ['weekly', 7, 7], ['monthly', 31, 29],
  ] as [LevelPeriod, number, number][])('waits for period three and removes a revisited %s level', (period, firstLength, secondLength) => {
    const third = firstLength + secondLength
    const days = Array.from({ length: third + 1 }, (_, i) => {
      const time = base + i * DAY_MS
      if (i === firstLength - 1) return bar(time, 90)
      if (i === firstLength) return bar(time, 100)
      return bar(time, 105)
    })
    const second = base + firstLength * DAY_MS
    const hours = Array.from({ length: 24 }, (_, i) => bar(second + i * hour, i === 0 ? 100 : 105))
    const boundary = (now: number, daily = days, hourly = hours) => findCalendarLevels({ days: daily, hours: hourly, now })
      .find(level => level.kind === 'boundary' && level.period === period && level.price === 100)
    const eligible = base + third * DAY_MS
    expect(boundary(eligible - 1)).toBeUndefined()
    expect(boundary(eligible)?.date).toBe(eligible)
    expect(boundary(eligible, days.map(day => day.time === eligible ? bar(eligible, 103, 100) : day))).toBeUndefined()
    expect(boundary(eligible, days, hours.map((row, i) => i === 3 ? { ...row, low: 100 } : row))).toBeUndefined()
    expect(boundary(eligible, days.filter(day => day.time !== eligible))).toBeUndefined()
  })

  it('shows calendar NPOC magnets for untouched profiles and removes them on a wick into the band', () => {
    const days = Array.from({ length: 61 }, (_, i) => bar(base + i * DAY_MS, i < 28 ? 100 : i < 31 ? 500 : i < 59 ? 1000 : 2000))
    const hours = Array.from({ length: 24 }, (_, i) => bar(base + 58 * DAY_MS + i * hour, 1000))
    const now = base + 60 * DAY_MS
    const levels = findCalendarLevels({ days, hours, now })
    expect(new Set(levels.filter(level => level.kind === 'npoc').map(level => level.period))).toEqual(new Set(['daily', 'weekly', 'monthly']))
    const revisited = findCalendarLevels({ days: days.map(row => row.time === now ? { ...row, low: 95 } : row), hours, now })
    expect(revisited.some(level => level.kind === 'npoc' && level.period === 'monthly')).toBe(false)
  })
})
