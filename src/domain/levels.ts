import type { OkxCandlePoint } from '../data/okx'
import { computeUtcDayProfile } from './footprint'

export const DAY_MS = 86_400_000
const HOUR_MS = DAY_MS / 24
export const PERIODS = ['daily', 'weekly', 'monthly'] as const
export type LevelPeriod = typeof PERIODS[number]
export const PERIOD_LABEL: Record<LevelPeriod, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' }

export type MarketLevel = {
  id: string
  kind: 'boundary' | 'npoc' | 'manual' | 'profile' | 'vwap'
  price: number
  label: string
  period?: LevelPeriod
  date?: number
  note?: string
  revisited?: boolean
  volumeBtc?: number
}

export function periodStart(time: number, period: LevelPeriod): number {
  const day = Math.floor(time / DAY_MS) * DAY_MS
  const date = new Date(day)
  if (period === 'monthly') return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
  if (period === 'weekly') return day - ((date.getUTCDay() + 6) % 7) * DAY_MS
  return day
}

function nextPeriod(start: number, period: LevelPeriod): number {
  if (period === 'monthly') {
    const date = new Date(start)
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)
  }
  return start + (period === 'weekly' ? 7 : 1) * DAY_MS
}

function hasCoverage(candles: readonly OkxCandlePoint[], start: number, end: number, step: number) {
  return candles.length === (end - start) / step && candles.every((bar, index) => bar.time === start + index * step)
}

const touches = (bar: OkxCandlePoint, price: number) => bar.low <= price && price <= bar.high

export function findCalendarLevels({
  days, hours, quarters = [], now,
}: {
  days: readonly OkxCandlePoint[]
  hours: readonly OkxCandlePoint[]
  quarters?: readonly OkxCandlePoint[]
  now: number
}): MarketLevel[] {
  const byTime = (bars: readonly OkxCandlePoint[]) =>
    [...new Map(bars.filter(bar => bar.time <= now).map(bar => [bar.time, bar])).values()].sort((a, b) => a.time - b.time)
  const daily = byTime(days)
  const hourly = byTime(hours)
  const quarterHourly = byTime(quarters)
  const today = periodStart(now, 'daily')
  const result: MarketLevel[] = []
  for (const period of PERIODS) {
    const groups = new Map<number, OkxCandlePoint[]>()
    for (const day of daily) {
      const start = periodStart(day.time, period)
      const group = groups.get(start)
      if (group) group.push(day)
      else groups.set(start, [day])
    }

    const completed = [...groups.entries()].filter(([start, bars]) => {
      const end = nextPeriod(start, period)
      return end <= now && hasCoverage(bars, start, end, DAY_MS)
    })
    const maxLookback = period === 'daily' ? 14 : period === 'weekly' ? 16 : 8
    for (const [start, bars] of completed.slice(-maxLookback)) {
      const end = nextPeriod(start, period)
      const later = daily.filter(bar => bar.time >= end)
      // Require contiguous days through today. Otherwise a missing bar might hide a revisit.
      if (!hasCoverage(later, end, today + DAY_MS, DAY_MS)) continue
      const recent = [...hourly, ...quarterHourly].filter(bar => bar.time >= end)
      const revisitBars = [...later, ...recent]

      const finer = period === 'daily'
        ? hourly.filter(bar => bar.time >= start && bar.time < end)
        : bars
      if (period !== 'daily' || hasCoverage(finer, start, end, HOUR_MS)) {
        const profile = computeUtcDayProfile({ dayCandles: finer, takerMap: new Map(), dayStart: start })
        if (profile && !revisitBars.some(bar => bar.low < profile.pocPrice + profile.stepUsd && bar.high >= profile.pocPrice)) {
          result.push({
            id: `npoc-${period}-${start}`, kind: 'npoc', period, price: profile.pocPrice,
            label: `${PERIOD_LABEL[period]} NPOC Magnet`, date: start, volumeBtc: profile.pocVolumeBtc,
            note: `Estimated volume profile from ${period === 'daily' ? 'hourly' : 'daily'} candles. Revisit checks use the full price band.`,
          })
        }
      }

      const preceding = completed.find(([previous]) => nextPeriod(previous, period) === start)?.[1]
      const first = bars[0]
      const last = bars.at(-1)
      if (!preceding || preceding.at(-1)?.close !== first.open || last?.close === first.open) continue
      const price = first.open
      if (revisitBars.some(bar => touches(bar, price))) continue

      // Prefer finer bars for the second period's opening day. Exclude just the first available opening
      // interval, since its wick includes the opening trade. A return inside it cannot be ruled out.
      const openingDayHours = hourly.filter(bar => bar.time >= start && bar.time < start + DAY_MS)
      const openingDayQuarters = quarterHourly.filter(bar => bar.time >= start && bar.time < start + DAY_MS)
      const openingBars = hasCoverage(openingDayQuarters, start, start + DAY_MS, 15 * 60_000)
        ? openingDayQuarters
        : hasCoverage(openingDayHours, start, start + DAY_MS, HOUR_MS) ? openingDayHours : [first]
      const opening = openingBars[0]
      if (opening.close === price || (opening.low < price && opening.high > price)) continue
      if (openingBars.slice(1).some(bar => touches(bar, price)) || bars.slice(1).some(bar => touches(bar, price))) continue

      const interval = openingBars.length === 96 ? '15 minutes' : openingBars.length === 24 ? 'hour' : 'day'
      result.push({
        id: `boundary-${period}-${start}`, kind: 'boundary', period, price,
        label: `${PERIOD_LABEL[period]} Level`, date: end,
        note: `No later candle touched this price. A return within the opening ${interval} could not be verified.`,
      })
    }
  }
  return result
}
