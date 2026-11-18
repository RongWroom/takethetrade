import { describe, expect, it } from 'vitest'
import {
  evaluateFootprint,
  evaluateFpbsStats,
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



