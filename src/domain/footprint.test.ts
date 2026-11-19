import { describe, expect, it } from 'vitest'
import {
  evaluateDailyNakedPocs,
  evaluateFootprint,
  evaluateFpbsStats,
  evaluatePrevDayReference,
  evaluateSessionProfile,
  evaluateTradeSizeFlow,
  formatFpbsCsv,
  type FootprintTrade,
} from './footprint'

const baseTime = Date.UTC(2026, 10, 18, 12, 0, 0)
const min = 60_000

function makeTrade(
  id: string,
  time: number,
  side: 'buy' | 'sell',
  price: number,
  quantityBtc: string,
): FootprintTrade {
  return {
    exchange: 'OKX',
    symbol: 'BTC-USDT-SWAP',
    id,
    time,
    side,
    price: String(price),
    quantityBtc,
  }
}

describe('evaluateFootprint', () => {
  it('returns 6 buckets with Waiting for trades badge when no trades are present', () => {
    const res = evaluateFootprint({
      trades: [],
      now: baseTime + 5 * min + 30_000,
      bucketMs: min,
    })

    expect(res.candles).toHaveLength(6)
    expect(res.candles[5].isDeveloping).toBe(true)
    for (const c of res.candles) {
      expect(c.tradeCount).toBe(0)
      expect(c.rows).toHaveLength(0)
      expect(c.badge.label).toBe('Waiting for trades')
    }
  })

  it('quantizes trades into price rows highest-to-lowest, finds POC, and computes 70% Value Area', () => {
    const now = baseTime + 15_000
    const trades: FootprintTrade[] = [
      // $80,000 row: 0.40 BTC total
      makeTrade('t1', baseTime + 1_000, 'buy', 80_002, '0.30000000'),
      makeTrade('t2', baseTime + 2_000, 'sell', 80_008, '0.10000000'),
      // $80,010 row: 1.50 BTC total (POC)
      makeTrade('t3', baseTime + 3_000, 'buy', 80_011, '0.90000000'),
      makeTrade('t4', baseTime + 4_000, 'sell', 80_019, '0.60000000'),
      // $80,020 row: 0.80 BTC total
      makeTrade('t5', baseTime + 5_000, 'buy', 80_022, '0.60000000'),
      makeTrade('t6', baseTime + 6_000, 'sell', 80_029, '0.20000000'),
      // $80,030 row: 0.30 BTC total
      makeTrade('t7', baseTime + 7_000, 'buy', 80_033, '0.30000000'),
    ]

    // Total volume = 3.00 BTC; 70% target = 2.10 BTC
    // Start at POC ($80,010, 1.50) -> next best is $80,020 (0.80) -> accum = 2.30 >= 2.10
    // Value Area = [$80,010, $80,020]
    const res = evaluateFootprint({
      trades,
      now,
      bucketMs: min,
      stepOption: 10,
    })

    const active = res.candles[res.candles.length - 1]
    expect(active.tradeCount).toBe(7)
    expect(active.rows.map(r => r.price)).toEqual([80_030, 80_020, 80_010, 80_000])
    expect(active.pocPrice).toBe(80_010)
    expect(active.pocVolumeBtc).toBeCloseTo(1.5, 6)
    expect(active.valPrice).toBe(80_010)
    expect(active.vahPrice).toBe(80_020)

    const pocRow = active.rows.find(r => r.price === 80_010)!
    expect(pocRow.isPoc).toBe(true)
    expect(pocRow.inValueArea).toBe(true)
    expect(active.rows.find(r => r.price === 80_020)!.inValueArea).toBe(true)
    expect(active.rows.find(r => r.price === 80_000)!.inValueArea).toBe(false)
    expect(active.rows.find(r => r.price === 80_030)!.inValueArea).toBe(false)
    expect(active.rows.find(r => r.price === 80_030)!.isCloseRow).toBe(true)
  })

  it('detects 3x diagonal imbalances and tracks intrabar trapped buyers delta flip', () => {
    const now = baseTime + 25_000
    const trades: FootprintTrade[] = [
      // Early aggressive buying at $80,020 lifts running delta to +1.00 BTC
      // Diagonal compare for $80,020 buy (1.00) vs $80,010 sell (0.10) => >= 3x => buy imbalance
      makeTrade('b1', baseTime + 1_000, 'buy', 80_025, '1.00000000'),
      // Heavy selling below POC at $80,000 and $79,990 flips delta deeply negative
      makeTrade('s1', baseTime + 5_000, 'sell', 80_015, '0.10000000'),
      // At $80,000, sell=2.00 vs diagonal $80,010 buy=0.05 => >= 3x => sell imbalance
      makeTrade('s2', baseTime + 10_000, 'sell', 80_005, '2.00000000'),
      makeTrade('b2', baseTime + 12_000, 'buy', 80_012, '0.05000000'),
      // $80,000 buy=0.20 prevents $79,990 sell=0.40 (2x < 3x) from triggering a second sell imbalance
      makeTrade('b3', baseTime + 13_000, 'buy', 80_002, '0.20000000'),
      // Extra volume at $79,990 closes below the $80,000 POC
      makeTrade('s3', baseTime + 15_000, 'sell', 79_995, '0.40000000'),
    ]

    const res = evaluateFootprint({
      trades,
      now,
      bucketMs: min,
      stepOption: 10,
    })

    const active = res.candles[res.candles.length - 1]
    expect(active.pocPrice).toBe(80_000)
    expect(active.close).toBe(79_995)
    expect(active.maxDeltaBtc).toBeCloseTo(1.0, 6)
    expect(active.minDeltaBtc).toBeCloseTo(-1.25, 6)
    expect(active.deltaBtc).toBeCloseTo(-1.25, 6)
    expect(active.buyImbalanceCount).toBe(1)
    expect(active.sellImbalanceCount).toBe(1)
    expect(active.rows.find(r => r.price === 80_020)?.imbalance).toBe('buy')
    expect(active.rows.find(r => r.price === 80_000)?.imbalance).toBe('sell')
    expect(active.rows.find(r => r.price === 79_990)?.imbalance).toBeNull()
    expect(active.badge.label).toBe('Trapped buyers')
  })
})

describe('evaluateTradeSizeFlow', () => {
  it('classifies small (<0.10), mid (0.10-0.99), and whale (>=1.00) orders and identifies the largest print', () => {
    const trades: FootprintTrade[] = [
      makeTrade('r1', baseTime + 1_000, 'sell', 80_000, '0.09000000'),
      makeTrade('m1', baseTime + 2_000, 'buy', 80_010, '0.10000000'),
      makeTrade('m2', baseTime + 3_000, 'sell', 80_020, '0.99000000'),
      makeTrade('w1', baseTime + 4_000, 'buy', 80_050, '1.00000000'),
      makeTrade('w2', baseTime + 5_000, 'buy', 80_100, '2.50000000'),
    ]

    const res = evaluateTradeSizeFlow({
      trades,
      start: baseTime,
      end: baseTime + min,
    })

    expect(res.totalTradeCount).toBe(5)
    expect(res.whale.tradeCount).toBe(2)
    expect(res.whale.buyBtc).toBeCloseTo(3.5, 6)
    expect(res.mid.tradeCount).toBe(2)
    expect(res.mid.buyBtc).toBeCloseTo(0.1, 6)
    expect(res.mid.sellBtc).toBeCloseTo(0.99, 6)
    expect(res.retail.tradeCount).toBe(1)
    expect(res.retail.sellBtc).toBeCloseTo(0.09, 6)

    expect(res.largestTrade).not.toBeNull()
    expect(res.largestTrade?.side).toBe('buy')
    expect(res.largestTrade?.btc).toBeCloseTo(2.5, 6)
    expect(res.largestTrade?.price).toBe(80_100)
    expect(res.largestTrade?.notionalUsd).toBeCloseTo(200_250, 2)
  })

  it('flags Whales absorbing retail and Whales selling into retail accurately', () => {
    const absorbing = evaluateTradeSizeFlow({
      trades: [
        makeTrade('w1', baseTime + 1_000, 'buy', 80_000, '1.50000000'),
        makeTrade('r1', baseTime + 2_000, 'sell', 79_990, '0.05000000'),
        makeTrade('r2', baseTime + 3_000, 'sell', 79_980, '0.05000000'),
      ],
      start: baseTime,
      end: baseTime + min,
    })
    expect(absorbing.badge.label).toBe('Whales absorbing retail')
    expect(absorbing.badge.tone).toBe('teal')

    const distributing = evaluateTradeSizeFlow({
      trades: [
        makeTrade('w1', baseTime + 1_000, 'sell', 80_100, '1.80000000'),
        makeTrade('r1', baseTime + 2_000, 'buy', 80_110, '0.04000000'),
        makeTrade('r2', baseTime + 3_000, 'buy', 80_120, '0.06000000'),
      ],
      start: baseTime,
      end: baseTime + min,
    })
    expect(distributing.badge.label).toBe('Whales selling into retail')
    expect(distributing.badge.tone).toBe('rose')
  })
})

describe('evaluateSessionProfile', () => {
  it('aggregates multi-candle trades into Session POC, 70% Value Area, and valueStatus', () => {
    const now = baseTime + 2 * min + 30_000
    const trades: FootprintTrade[] = [
      // Candle 0: heavy volume at $80,010
      makeTrade('c0-1', baseTime + 5_000, 'buy', 80_012, '1.20000000'),
      makeTrade('c0-2', baseTime + 10_000, 'sell', 80_014, '0.80000000'),
      // Candle 1: trades at $80,020 (1.00) and $80,010 (0.50 -> $80,010 becomes 2.50 total POC)
      makeTrade('c1-1', baseTime + min + 5_000, 'buy', 80_015, '0.50000000'),
      makeTrade('c1-2', baseTime + min + 10_000, 'buy', 80_024, '1.00000000'),
      // Candle 2 (developing): trades above at $80,040 (0.50)
      makeTrade('c2-1', baseTime + 2 * min + 5_000, 'buy', 80_042, '0.50000000'),
    ]

    // Total volume = 4.00 BTC; 70% target = 2.80 BTC
    // POC = $80,010 (2.50 BTC) -> next best = $80,020 (1.00 BTC) -> accum = 3.50 >= 2.80
    // VAH = $80,020, VAL = $80,010; latest trade at $80,042 => above Value Area
    const fp = evaluateFootprint({ trades, now, bucketMs: min, stepOption: 10 })
    const svp = evaluateSessionProfile({ trades, candles: fp.candles, stepOption: 10 })

    expect(svp.tradeCount).toBe(5)
    expect(svp.sessionPocPrice).toBe(80_010)
    expect(svp.sessionPocVolumeBtc).toBeCloseTo(2.5, 6)
    expect(svp.sessionValPrice).toBe(80_010)
    expect(svp.sessionVahPrice).toBe(80_020)
    expect(svp.valueStatus).toBe('above')

    const pocRow = svp.rows.find(r => r.price === 80_010)!
    expect(pocRow.isSessionPoc).toBe(true)
    expect(pocRow.totalWidthPct).toBe(100)
    expect(svp.rows.find(r => r.price === 80_040)?.isLatestRow).toBe(true)
  })

  it('detects untested Naked POCs and clears them once price revisits the level', () => {
    const now = baseTime + 2 * min + 20_000
    const untestedTrades: FootprintTrade[] = [
      // Candle 0 POC at $80,000
      makeTrade('u0', baseTime + 5_000, 'buy', 80_005, '1.50000000'),
      // Candle 1 trades strictly higher ($80,030-$80,040)
      makeTrade('u1', baseTime + min + 5_000, 'buy', 80_035, '1.00000000'),
      // Candle 2 stays higher ($80,040) -> Candle 0 ($80,000) & Candle 1 ($80,030) are untested!
      makeTrade('u2', baseTime + 2 * min + 5_000, 'buy', 80_045, '0.80000000'),
    ]

    const fp1 = evaluateFootprint({ trades: untestedTrades, now, bucketMs: min, stepOption: 10 })
    const svp1 = evaluateSessionProfile({ trades: untestedTrades, candles: fp1.candles, stepOption: 10 })

    expect(svp1.nakedPocs.map(n => n.price)).toEqual([80_030, 80_000])
    expect(svp1.rows.find(r => r.price === 80_000)?.isNakedPoc).toBe(true)
    expect(svp1.rows.find(r => r.price === 80_030)?.isNakedPoc).toBe(true)

    // Now Candle 2 drops through $80,030 down to $80,000, revisiting both prior POCs
    const testedTrades: FootprintTrade[] = [
      ...untestedTrades,
      makeTrade('u3', baseTime + 2 * min + 10_000, 'sell', 80_002, '0.40000000'),
    ]
    const fp2 = evaluateFootprint({ trades: testedTrades, now, bucketMs: min, stepOption: 10 })
    const svp2 = evaluateSessionProfile({ trades: testedTrades, candles: fp2.candles, stepOption: 10 })

    expect(svp2.nakedPocs).toHaveLength(0)
    expect(svp2.rows.some(r => r.isNakedPoc)).toBe(false)
  })

  it('uses backfilled candles in chart mode so different timeframes produce distinct Value Areas', () => {
    const tf15m = 15 * min
    const tf1h = 60 * min
    const now = Date.UTC(2026, 10, 18, 12, 5, 0)
    const liveSlot15m = Date.UTC(2026, 10, 18, 12, 0, 0)

    const liveTrades: FootprintTrade[] = [
      makeTrade('live-1', liveSlot15m + 10_000, 'buy', 63_820, '0.20000000'),
      makeTrade('live-2', liveSlot15m + 20_000, 'sell', 63_800, '0.10000000'),
    ]

    const candles15m = [
      { time: liveSlot15m - 3 * tf15m, open: 63_500, high: 63_580, low: 63_480, close: 63_560, volumeBtc: 25 },
      { time: liveSlot15m - 2 * tf15m, open: 63_560, high: 63_650, low: 63_540, close: 63_630, volumeBtc: 30 },
      { time: liveSlot15m - tf15m, open: 63_630, high: 63_760, low: 63_620, close: 63_740, volumeBtc: 28 },
    ]
    const candles1h = [
      { time: liveSlot15m - 3 * tf1h, open: 62_600, high: 62_900, low: 62_550, close: 62_850, volumeBtc: 120 },
      { time: liveSlot15m - 2 * tf1h, open: 62_850, high: 63_200, low: 62_800, close: 63_150, volumeBtc: 140 },
      { time: liveSlot15m - tf1h, open: 63_150, high: 63_600, low: 63_100, close: 63_550, volumeBtc: 110 },
    ]

    const fp15 = evaluateFootprint({
      trades: liveTrades,
      now,
      bucketMs: tf15m,
      backfill: { candles: candles15m },
    })
    const svp15 = evaluateSessionProfile({
      trades: liveTrades,
      candles: fp15.candles,
      rangeId: 'chart',
      now,
      timeframeShort: '15m',
      bucketMs: tf15m,
      backfill: { candles: candles15m },
    })

    const fp1h = evaluateFootprint({
      trades: liveTrades,
      now,
      bucketMs: tf1h,
      backfill: { candles: candles1h },
    })
    const svp1h = evaluateSessionProfile({
      trades: liveTrades,
      candles: fp1h.candles,
      rangeId: 'chart',
      now,
      timeframeShort: '1h',
      bucketMs: tf1h,
      backfill: { candles: candles1h },
    })

    expect(svp15.sessionValPrice).not.toBeNull()
    expect(svp1h.sessionValPrice).not.toBeNull()
    expect(svp1h.sessionValPrice!).toBeLessThan(svp15.sessionValPrice!)
    expect(svp15.sourceLabel).toBe('Backfill + live')
    expect(svp1h.totalBtc).toBeCloseTo(370.3, 4)
  })

  it('computes distinct Value Areas across 24h, today, prevDay, 3d, and 7d without double-counting live slots', () => {
    const dayStart = Date.UTC(2026, 10, 18, 0, 0, 0)
    const now = dayStart + 6 * 60 * min + 20_000 // 06:00:20 UTC
    const current15mStart = dayStart + 6 * 60 * min

    // Yesterday (Nov 17): lower swing around $61,500–$62,200
    const prevDayCandles = [
      { time: dayStart - 16 * 60 * min, open: 61_500, high: 61_800, low: 61_450, close: 61_750, volumeBtc: 80 },
      { time: dayStart - 8 * 60 * min, open: 61_750, high: 62_100, low: 61_700, close: 62_000, volumeBtc: 120 },
      { time: dayStart - 2 * 60 * min, open: 62_000, high: 62_250, low: 61_950, close: 62_150, volumeBtc: 60 },
    ]
    // Today (Nov 18): pushed up to $63,500–$63,900
    const todayCandles = [
      { time: dayStart + 1 * 60 * min, open: 63_400, high: 63_650, low: 63_350, close: 63_600, volumeBtc: 50 },
      { time: dayStart + 3 * 60 * min, open: 63_600, high: 63_880, low: 63_580, close: 63_820, volumeBtc: 90 },
      // Developing bar present in REST snapshot too; live trade covers full bar because earliestLiveTime <= current15mStart
      { time: current15mStart, open: 63_820, high: 63_900, low: 63_800, close: 63_860, volumeBtc: 10 },
    ]
    const candles15m = [...prevDayCandles, ...todayCandles]

    // 1H candles spanning 3D & 7D: heavy 7D base around $60,000, 3D cluster around $62,500
    const candles1h = [
      { time: dayStart - 5 * 24 * 60 * min, open: 59_800, high: 60_200, low: 59_700, close: 60_000, volumeBtc: 600 },
      { time: dayStart - 2 * 24 * 60 * min, open: 62_300, high: 62_700, low: 62_200, close: 62_550, volumeBtc: 300 },
      { time: dayStart + 2 * 60 * min, open: 63_500, high: 63_850, low: 63_450, close: 63_820, volumeBtc: 110 },
    ]

    const liveTrades: FootprintTrade[] = [
      makeTrade('cur-1', current15mStart, 'buy', 63_860, '2.00000000'),
    ]
    const fp = evaluateFootprint({ trades: liveTrades, now, bucketMs: 15 * min })
    const svpHistory = { candles15m, candles1h }

    const svp24h = evaluateSessionProfile({
      trades: liveTrades,
      candles: fp.candles,
      rangeId: '24h',
      now,
      svpHistory,
    })
    const svpToday = evaluateSessionProfile({
      trades: liveTrades,
      candles: fp.candles,
      rangeId: 'today',
      now,
      svpHistory,
    })
    const svpPrevDay = evaluateSessionProfile({
      trades: liveTrades,
      candles: fp.candles,
      rangeId: 'prevDay',
      now,
      svpHistory,
    })
    const svp3d = evaluateSessionProfile({
      trades: liveTrades,
      candles: fp.candles,
      rangeId: '3d',
      now,
      svpHistory,
    })
    const svp7d = evaluateSessionProfile({
      trades: liveTrades,
      candles: fp.candles,
      rangeId: '7d',
      now,
      svpHistory,
    })

    // No double counting of current15mStart (live 2.00 BTC replaces REST 10 BTC developing snapshot)
    expect(svpToday.totalBtc).toBeCloseTo(142, 4) // 50 + 90 + 2
    expect(svp24h.totalBtc).toBeCloseTo(402, 4) // 260 prevDay + 142 today
    expect(svpPrevDay.totalBtc).toBeCloseTo(260, 4) // strict yesterday only; live trade excluded

    // Distinct Value Areas & POCs
    expect(svpPrevDay.sessionVahPrice!).toBeLessThan(svpToday.sessionValPrice!)
    expect(svpPrevDay.valueStatus).toBe('above') // live price $63,860 is above yesterday's VA
    expect(svp3d.sessionPocPrice!).toBeGreaterThan(svp7d.sessionPocPrice!)
    expect(svpToday.prevDayLevels?.pocPrice).toBe(svpPrevDay.sessionPocPrice)
    expect(svp24h.rows.some(r => r.isPrevDayPoc)).toBe(true)
    expect(svpPrevDay.rows.some(r => r.isPrevDayPoc)).toBe(false)

    // When live stream opened mid-bar (earliestLiveTime > current15mStart) with partial volume, keep REST candle (no double count)
    const partialLive: FootprintTrade[] = [
      makeTrade('cur-partial', current15mStart + 5_000, 'buy', 63_860, '2.00000000'),
    ]
    const svpTodayPartial = evaluateSessionProfile({
      trades: partialLive,
      candles: fp.candles,
      rangeId: 'today',
      now,
      svpHistory,
    })
    expect(svpTodayPartial.totalBtc).toBeCloseTo(150, 4) // 50 + 90 + 10 REST snapshot
  })
})

describe('evaluatePrevDayReference', () => {
  it('returns null when no prior UTC day candles exist and classifies price position vs pVAH/pVAL', () => {
    const dayStart = Date.UTC(2026, 10, 18, 0, 0, 0)
    const now = dayStart + 4 * 60 * min

    expect(evaluatePrevDayReference({ candles15m: [], now, latestPrice: 63_000 })).toBeNull()

    const candles15m = [
      { time: dayStart - 12 * 60 * min, open: 62_000, high: 62_250, low: 61_950, close: 62_150, volumeBtc: 100 },
      { time: dayStart - 6 * 60 * min, open: 62_150, high: 62_450, low: 62_100, close: 62_350, volumeBtc: 150 },
    ]

    const above = evaluatePrevDayReference({ candles15m, now, latestPrice: 63_100 })
    expect(above?.pricePosition).toBe('above-pvah')
    expect(above?.dateLabel).toBe('Nov 17 UTC')

    const inside = evaluatePrevDayReference({ candles15m, now, latestPrice: above!.pocPrice })
    expect(inside?.pricePosition).toBe('inside-pva')

    const below = evaluatePrevDayReference({ candles15m, now, latestPrice: 61_200 })
    expect(below?.pricePosition).toBe('below-pval')
  })
})

describe('evaluateDailyNakedPocs & Daily nPOC integration', () => {
  it('computes Daily nPOCs across prior UTC days, reconciles onLadder vs off-range, tracks multi-nPOC rows, and clears on live touch', () => {
    const dayMs = 86_400_000
    const hour = 60 * min
    const dayStart = Date.UTC(2026, 10, 18, 0, 0, 0) // Nov 18
    const now = dayStart + 6 * hour + 15_000

    // Nov 15 (day - 3): $59,950–$60,050 (untested!)
    // Nov 16 (day - 2): $62,950–$63,050 (tested by Today's low at $62,950)
    // Nov 17 (day - 1): $61,850–$62,000 (untested!)
    const candles1h = [
      { time: dayStart - 3 * dayMs + 8 * hour, open: 59_950, high: 60_050, low: 59_950, close: 60_020, volumeBtc: 200 },
      { time: dayStart - 2 * dayMs + 8 * hour, open: 62_950, high: 63_050, low: 62_950, close: 63_020, volumeBtc: 200 },
      { time: dayStart - 1 * dayMs + 8 * hour, open: 61_850, high: 62_000, low: 61_850, close: 61_950, volumeBtc: 250 },
      { time: dayStart + 2 * hour, open: 63_000, high: 63_900, low: 62_950, close: 63_850, volumeBtc: 180 },
    ]
    const candles15m = [
      // Prev Day (Nov 17) within last 24h
      { time: dayStart - 4 * hour, open: 61_860, high: 62_000, low: 61_850, close: 61_940, volumeBtc: 140 },
      { time: dayStart - 2 * hour, open: 61_940, high: 62_000, low: 61_880, close: 61_920, volumeBtc: 120 },
      // Today (Nov 18): dips to 62,950 (tests Nov 16) then holds high at 63,850
      { time: dayStart + 1 * hour, open: 63_100, high: 63_500, low: 62_950, close: 63_450, volumeBtc: 40 },
      { time: dayStart + 4 * hour, open: 63_450, high: 63_900, low: 63_400, close: 63_850, volumeBtc: 160 },
    ]
    const liveTrades: FootprintTrade[] = [
      makeTrade('dnp-1', dayStart + 6 * hour + 5_000, 'buy', 63_850, '1.00000000'),
    ]
    const fp = evaluateFootprint({ trades: liveTrades, now, bucketMs: 15 * min })
    const svpHistory = { candles15m, candles1h }

    const svp24h = evaluateSessionProfile({
      trades: liveTrades,
      candles: fp.candles,
      rangeId: '24h',
      now,
      svpHistory,
    })

    expect(svp24h.nakedPocMode).toBe('daily')
    // Nearest first: Nov 17 (~$61,900) then Nov 15 (~$60,000); Nov 16 ($63,000) excluded because Today touched it
    expect(svp24h.nakedPocs).toHaveLength(2)
    expect(svp24h.nakedPocs[0].originLabel).toBe('Nov 17 dPOC')
    expect(svp24h.nakedPocs[0].price).toBe(svp24h.prevDayLevels?.pocPrice)
    expect(svp24h.nakedPocs[0].onLadder).toBe(true)
    expect(svp24h.nakedPocs[1].originLabel).toBe('Nov 15 dPOC')
    expect(svp24h.nakedPocs[1].onLadder).toBe(false)

    // Widening to 7D brings Nov 15 onto the ladder too
    const svp7d = evaluateSessionProfile({
      trades: liveTrades,
      candles: fp.candles,
      rangeId: '7d',
      now,
      svpHistory,
    })
    expect(svp7d.nakedPocs).toHaveLength(2)
    expect(svp7d.nakedPocs.every(n => n.onLadder)).toBe(true)
    expect(svp7d.rows.filter(r => r.isNakedPoc)).toHaveLength(2)

    // Two distinct untested days landing in the same coarse row bucket report nakedPocCount = 2
    const candlesTwoCloseDays = [
      { time: dayStart - 4 * dayMs + 8 * hour, open: 60_000, high: 60_080, low: 60_000, close: 60_050, volumeBtc: 200 },
      { time: dayStart - 3 * dayMs + 8 * hour, open: 60_120, high: 60_200, low: 60_120, close: 60_180, volumeBtc: 200 },
      { time: dayStart + 2 * hour, open: 63_500, high: 63_900, low: 63_450, close: 63_850, volumeBtc: 180 },
    ]
    const svpCoarse = evaluateSessionProfile({
      trades: liveTrades,
      candles: fp.candles,
      rangeId: '7d',
      now,
      svpHistory: { candles1h: candlesTwoCloseDays },
    })
    const groupedRow = svpCoarse.rows.find(r => r.nakedPocCount === 2)
    expect(groupedRow).toBeDefined()
    expect(groupedRow?.nakedPocLabels).toHaveLength(2)

    // A live trade revisiting Nov 17's POC bin clears it immediately
    const liveRevisit: FootprintTrade[] = [
      ...liveTrades,
      makeTrade('dnp-2', dayStart + 6 * hour + 10_000, 'sell', svp24h.nakedPocs[0].price + 1, '0.25000000'),
    ]
    const svpAfterTouch = evaluateSessionProfile({
      trades: liveRevisit,
      candles: fp.candles,
      rangeId: '24h',
      now: dayStart + 6 * hour + 16_000,
      svpHistory,
    })
    expect(svpAfterTouch.nakedPocs.map(n => n.originLabel)).toEqual(['Nov 15 dPOC'])
  })

  it('skips a truncated leading partial UTC day when >= 48 hourly bars exist', () => {
    const dayMs = 86_400_000
    const hour = 60 * min
    const dayStart = Date.UTC(2026, 10, 18, 0, 0, 0)
    const now = dayStart + 4 * hour

    // Oldest day (Nov 15) has only 3 bars (< 12); Nov 16 & Nov 17 have 24 bars each (total 51 >= 48)
    const candles1h = [
      // Partial leading day Nov 15 at $58,000 (should be skipped)
      ...Array.from({ length: 3 }, (_, i) => ({
        time: dayStart - 3 * dayMs + (21 + i) * hour,
        open: 58_000,
        high: 58_100,
        low: 57_950,
        close: 58_050,
        volumeBtc: 50,
      })),
      // Full day Nov 16 at $61,000 (untested)
      ...Array.from({ length: 24 }, (_, i) => ({
        time: dayStart - 2 * dayMs + i * hour,
        open: 61_000,
        high: 61_150,
        low: 60_950,
        close: 61_050,
        volumeBtc: 50,
      })),
      // Full day Nov 17 at $62,000 (untested)
      ...Array.from({ length: 24 }, (_, i) => ({
        time: dayStart - 1 * dayMs + i * hour,
        open: 62_000,
        high: 62_150,
        low: 61_950,
        close: 62_050,
        volumeBtc: 50,
      })),
    ]

    const magnets = evaluateDailyNakedPocs({
      candles1h,
      now,
      latestPrice: 63_500,
      ladderStepUsd: 100,
      ladderMinRowPrice: 60_000,
      ladderMaxRowPrice: 64_000,
    })

    expect(magnets.map(m => m.originLabel)).toEqual(['Nov 17 dPOC', 'Nov 16 dPOC'])
  })
})

describe('evaluateFpbsStats & formatFpbsCsv', () => {
  it('computes running CVD, flags trapped buyers and sell absorption, picks peak conviction bar, and exports 6-row CSV', () => {
    const now = baseTime + 5 * min + 30_000
    const trades: FootprintTrade[] = [
      // Bar 3: Sell absorption — positive delta (+0.40) while closing lower (80,020 -> 80,000)
      makeTrade('f3-1', baseTime + 3 * min + 1_000, 'sell', 80_020, '0.20000000'),
      makeTrade('f3-2', baseTime + 3 * min + 2_000, 'buy', 80_010, '0.65000000'),
      makeTrade('f3-3', baseTime + 3 * min + 3_000, 'sell', 80_000, '0.05000000'),
      // Bar 4: Strongest conviction buying bar (+2.00 delta)
      makeTrade('f4-1', baseTime + 4 * min + 1_000, 'buy', 80_030, '2.00000000'),
      // Bar 5 (live): Trapped buyers — early +0.60 buy before -1.20 sell closes below POC (80,010)
      makeTrade('f5-1', baseTime + 5 * min + 1_000, 'buy', 80_040, '0.60000000'),
      makeTrade('f5-2', baseTime + 5 * min + 2_000, 'sell', 80_015, '1.00000000'),
      makeTrade('f5-3', baseTime + 5 * min + 3_000, 'sell', 80_005, '0.20000000'),
    ]

    const fp = evaluateFootprint({ trades, now, bucketMs: min, stepOption: 10 })
    const fpbs = evaluateFpbsStats(fp.candles)

    expect(fpbs.columns).toHaveLength(6)
    expect(fpbs.columns[3].signalKind).toBe('sell-absorption')
    expect(fpbs.columns[4].signalKind).toBe('buyers-driving')
    expect(fpbs.columns[5].signalKind).toBe('trapped-buyers')

    // Running CVD: 0, 0, 0, +0.40, +2.40, +1.80
    expect(fpbs.columns[3].cvdBtc).toBeCloseTo(0.4, 6)
    expect(fpbs.columns[4].cvdBtc).toBeCloseTo(2.4, 6)
    expect(fpbs.columns[5].cvdBtc).toBeCloseTo(1.8, 6)
    expect(fpbs.windowCvdBtc).toBeCloseTo(1.8, 6)

    expect(fpbs.trapOrWallCount).toBe(2)
    expect(fpbs.latestTrapOrWall?.index).toBe(5)
    expect(fpbs.peakConvictionCol?.index).toBe(4)

    const csv = formatFpbsCsv(fpbs)
    const lines = csv.split('\n')
    expect(lines).toHaveLength(7)
    expect(lines[0]).toBe(
      'Time (UTC),State,Trades,Volume (BTC),Delta (BTC),Delta (%),Max Delta (BTC),Min Delta (BTC),Running CVD (BTC),POC (USD),Signal',
    )
    expect(lines[6]).toContain('Live')
    expect(lines[6]).toContain('Buyer Trap')
  })

  it('fills prior closed bars from REST backfill when raw live ticks only cover the latest bar', () => {
    const tf5m = 5 * min
    const now = baseTime + 5 * tf5m + 45_000

    const candles = [
      { time: baseTime, open: 80_000, high: 80_120, low: 79_980, close: 80_100, volumeBtc: 10 },
      { time: baseTime + tf5m, open: 80_100, high: 80_150, low: 80_040, close: 80_060, volumeBtc: 8 },
      { time: baseTime + 2 * tf5m, open: 80_060, high: 80_110, low: 80_010, close: 80_090, volumeBtc: 12 },
      { time: baseTime + 3 * tf5m, open: 80_090, high: 80_200, low: 80_070, close: 80_180, volumeBtc: 15 },
      { time: baseTime + 4 * tf5m, open: 80_180, high: 80_220, low: 80_120, close: 80_140, volumeBtc: 9 },
    ]
    const takerBuckets = [
      { time: baseTime, buyBtc: 6, sellBtc: 4, deltaBtc: 2, volumeBtc: 10 },
      { time: baseTime + tf5m, buyBtc: 3, sellBtc: 5, deltaBtc: -2, volumeBtc: 8 },
      { time: baseTime + 2 * tf5m, buyBtc: 7, sellBtc: 5, deltaBtc: 2, volumeBtc: 12 },
      { time: baseTime + 3 * tf5m, buyBtc: 10, sellBtc: 5, deltaBtc: 5, volumeBtc: 15 },
      { time: baseTime + 4 * tf5m, buyBtc: 4, sellBtc: 5, deltaBtc: -1, volumeBtc: 9 },
    ]

    const liveTrades: FootprintTrade[] = [
      makeTrade('live-1', baseTime + 5 * tf5m + 5_000, 'buy', 80_150, '1.50000000'),
      makeTrade('live-2', baseTime + 5 * tf5m + 10_000, 'sell', 80_145, '0.50000000'),
    ]

    const fp = evaluateFootprint({
      trades: liveTrades,
      now,
      bucketMs: tf5m,
      backfill: { candles, takerBuckets },
    })
    const fpbs = evaluateFpbsStats(fp.candles)

    expect(fpbs.columns).toHaveLength(6)
    for (const col of fpbs.columns) {
      expect(col.tradeCount).toBeGreaterThan(0)
      expect(col.volumeBtc).toBeGreaterThan(0)
      expect(col.pocPrice).not.toBeNull()
      expect(col.signalKind).not.toBe('empty')
    }
    // Running CVD across bars 0..5: +2, 0, +2, +7, +6, +7
    expect(fpbs.columns.map(c => Number(c.cvdBtc.toFixed(4)))).toEqual([2, 0, 2, 7, 6, 7])
    expect(fpbs.windowCvdBtc).toBeCloseTo(7, 6)
  })
})



