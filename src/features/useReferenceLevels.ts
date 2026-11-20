import { useEffect, useMemo, useState } from 'react'
import { normalizeOkxCandles, type OkxCandlePoint } from '../data/okx'
import { evaluatePrevDayReference } from '../domain/footprint'
import { DAY_MS, findCalendarLevels, PERIOD_LABEL, PERIODS, periodStart, type LevelPeriod, type MarketLevel } from '../domain/levels'
import type { SvpHistoryData } from './LiveOverview'

const STORAGE = 'ttt.manual-levels.v1'
const emptyDays: OkxCandlePoint[] = []
type ManualLevel = MarketLevel & { kind: 'manual'; period: LevelPeriod }

function loadManualLevels(): ManualLevel[] {
  try {
    const entries = JSON.parse(localStorage.getItem(STORAGE) ?? '[]')
    if (Array.isArray(entries)) return entries.filter(entry =>
      entry?.kind === 'manual' && PERIODS.includes(entry.period) &&
      typeof entry.id === 'string' && typeof entry.price === 'number' &&
      Number.isFinite(entry.price) && entry.price > 0 && typeof entry.label === 'string' &&
      typeof entry.note === 'string' && typeof entry.revisited === 'boolean',
    )
  } catch {
    // Storage may be unavailable.
  }
  return []
}

export function useReferenceLevels(history: SvpHistoryData, latestPrice: number | null, vwap: number | null) {
  const [historyState, setHistoryState] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [days, setDays] = useState(emptyDays)
  const [now, setNow] = useState(() => Date.now())
  const [manual, setManual] = useState(loadManualLevels)
  const [storageError, setStorageError] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    let pending = false
    async function refresh() {
      if (pending) return
      pending = true
      try {
        const response = await fetch('https://www.okx.com/api/v5/market/candles?instId=BTC-USDT-SWAP&bar=1Dutc&limit=300', { signal: controller.signal })
        const data = response.ok ? (await response.json()).data : null
        const bars = normalizeOkxCandles(data)
        if (controller.signal.aborted) return
        setNow(Date.now())
        setHistoryState(bars.length ? 'ready' : 'unavailable')
        setDays(bars)
      } catch {
        if (!controller.signal.aborted) {
          setDays(emptyDays)
          setHistoryState('unavailable')
        }
      } finally {
        pending = false
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 60_000)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [])

  const calendar = useMemo(() => findCalendarLevels({
    days, hours: history.candles1h, quarters: history.candles15m, now,
  }), [days, history.candles1h, history.candles15m, now])

  const prev = useMemo(() => {
    const yesterday = periodStart(now, 'daily') - DAY_MS
    const bars = history.candles15m.filter(bar => bar.time >= yesterday && bar.time < yesterday + DAY_MS)
    if (new Set(bars.map(bar => bar.time)).size !== 96) return null
    return evaluatePrevDayReference({ candles15m: bars, taker15m: history.taker15m, now })
  }, [history.candles15m, history.taker15m, now])

  const levels: MarketLevel[] = [...calendar, ...manual]
  if (prev) levels.push(...([
    ['PDVAH', prev.vahPrice, 'Upper bound of the previous UTC day’s 70% volume area.'],
    ['PDPOC', prev.pocPrice, 'Most traded price in the previous UTC day’s estimated profile.'],
    ['PDVAL', prev.valPrice, 'Lower bound of the previous UTC day’s 70% volume area.'],
  ] as const).map(([label, price, note]) => ({ id: label, label, price, note, kind: 'profile', period: 'daily' } as const)))
  if (vwap !== null) levels.push({ id: 'vwap', label: '6h VWAP', price: vwap, kind: 'vwap', note: 'Volume-weighted average price over the 6-hour window used by the app.' })

  function save(entries: ManualLevel[]) {
    setManual(entries)
    try {
      localStorage.setItem(STORAGE, JSON.stringify(entries))
      setStorageError(false)
    } catch {
      setStorageError(true)
    }
  }

  return {
    levels, latestPrice, historyState, storageError,
    add(price: number, period: LevelPeriod, note: string) {
      if (!Number.isFinite(price) || price <= 0) return
      save([...manual, {
        id: crypto.randomUUID(), label: `${PERIOD_LABEL[period]} Level`, kind: 'manual',
        price, period, note: note.trim(), revisited: false,
      }])
    },
    toggle(id: string) {
      save(manual.map(level => level.id === id ? { ...level, revisited: !level.revisited } : level))
    },
    remove(id: string) {
      save(manual.filter(level => level.id !== id))
    },
  }
}
export type ReferenceLevels = ReturnType<typeof useReferenceLevels>
