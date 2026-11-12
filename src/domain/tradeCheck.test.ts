import { describe, expect, it } from 'vitest'
import {
  approxLiquidationPrice,
  calcAtrPct,
  calcVwap,
  evaluateTradeCheck,
  validateIntent,
  type MarketSnapshot,
  type TradeCheckItem,
} from './tradeCheck'

const base: MarketSnapshot = {
  price: 80_000,
  priceStart: 80_000,
  deltaBtc: 0,
  cvdBtc: 0,
  volumeBtc: 100,
  oiRegimeId: null,
  vwap: 80_000,
  atrPct: 0.4,
  fundingRate: 0.0001,
  lsRatio: 2,
  lsRatioAvg: 2,
  trendPct: 0,
  recentLongLiqUsd: 0,
  recentShortLiqUsd: 0,
  timeframeLabel: '5 minutes',
}

const snap = (o: Partial<MarketSnapshot> = {}): MarketSnapshot => ({ ...base, ...o })
const find = (checks: TradeCheckItem[], id: string) => {
  const c = checks.find(x => x.id === id)
  if (!c) throw new Error(`missing check ${id}`)
  return c
}

describe('helpers', () => {
  it('computes VWAP from typical price weighted by volume', () => {
    const v = calcVwap([
      { high: 110, low: 90, close: 100, volumeBtc: 1 },
      { high: 220, low: 180, close: 200, volumeBtc: 3 },
    ])
    expect(v).toBeCloseTo(175)
    expect(calcVwap([{ high: 1, low: 1, close: 1, volumeBtc: 0 }])).toBeNull()
  })

  it('computes ATR as a percentage of the last close', () => {
    const atr = calcAtrPct([
      { high: 101, low: 99, close: 100, volumeBtc: 1 },
      { high: 102, low: 100, close: 101, volumeBtc: 1 },
      { high: 103, low: 99, close: 100, volumeBtc: 1 },
    ])
    // TRs: max(2, 2, 0)=2 ; max(4, 2, 2)=4 → avg 3 → 3%
    expect(atr).toBeCloseTo(3)
    expect(calcAtrPct([{ high: 1, low: 1, close: 1, volumeBtc: 1 }])).toBeNull()
  })

  it('approximates isolated liquidation prices symmetrically', () => {
    expect(approxLiquidationPrice('long', 100_000, 10)).toBeCloseTo(90_400)
    expect(approxLiquidationPrice('short', 100_000, 10)).toBeCloseTo(109_600)
  })
})

describe('validateIntent', () => {
  it('flags stops on the wrong side, far entries and bad leverage', () => {
    expect(validateIntent({ side: 'long', entry: 80_000, stop: 81_000 }, 80_000).map(i => i.field)).toEqual(['stop'])
    expect(validateIntent({ side: 'short', entry: 80_000, stop: 79_000 }, 80_000).map(i => i.field)).toEqual(['stop'])
    expect(validateIntent({ side: 'long', entry: 50_000 }, 80_000).map(i => i.field)).toEqual(['entry'])
    expect(validateIntent({ side: 'long', leverage: 200 }, 80_000).map(i => i.field)).toEqual(['leverage'])
    expect(validateIntent({ side: 'long', entry: 80_000, stop: 79_000, leverage: 10 }, 80_000)).toEqual([])
  })

  it('validates a stop against the current price when no entry is given', () => {
    expect(validateIntent({ side: 'long', stop: 81_000 }, 80_000)[0].message).toContain('current price')
  })
})

describe('evaluateTradeCheck', () => {
  it('reports planning mode without an entry and position mode with one', () => {
    expect(evaluateTradeCheck({ side: 'long' }, snap()).mode).toBe('planning')
    const r = evaluateTradeCheck({ side: 'long', entry: 79_000 }, snap())
    expect(r.mode).toBe('position')
    expect(find(r.checks, 'position').status).toBe('good')
  })

  it('never reports a false positive when data is missing', () => {
    const empty = snap({
      price: null,
      priceStart: null,
      deltaBtc: null,
      cvdBtc: null,
      volumeBtc: null,
      vwap: null,
      atrPct: null,
      fundingRate: null,
      lsRatio: null,
      lsRatioAvg: null,
      trendPct: null,
    })
    const r = evaluateTradeCheck({ side: 'long' }, empty)
    for (const id of ['flow', 'divergence', 'absorption', 'location', 'crowding', 'trend']) {
      expect(find(r.checks, id).status).toBe('unknown')
    }
    expect(r.summary.good).toBe(0)
  })

  it('mirrors flow agreement for long and short', () => {
    const buyers = snap({ deltaBtc: 10, cvdBtc: 30 })
    expect(find(evaluateTradeCheck({ side: 'long' }, buyers).checks, 'flow').status).toBe('good')
    expect(find(evaluateTradeCheck({ side: 'short' }, buyers).checks, 'flow').status).toBe('against')
    const sellers = snap({ deltaBtc: -10, cvdBtc: -30 })
    expect(find(evaluateTradeCheck({ side: 'short' }, sellers).checks, 'flow').status).toBe('good')
    expect(find(evaluateTradeCheck({ side: 'long' }, snap({ deltaBtc: 10, cvdBtc: -5 })).checks, 'flow').status).toBe('neutral')
  })

  it('flags a hollow rise as against a long and good for a short', () => {
    const s = snap({ priceStart: 80_000, price: 80_200, cvdBtc: -20 })
    expect(find(evaluateTradeCheck({ side: 'long' }, s).checks, 'divergence').status).toBe('against')
    expect(find(evaluateTradeCheck({ side: 'short' }, s).checks, 'divergence').status).toBe('good')
  })

  it('detects absorption when one-sided flow fails to move price', () => {
    const s = snap({ deltaBtc: 40, volumeBtc: 100, price: 80_005 })
    const long = find(evaluateTradeCheck({ side: 'long' }, s).checks, 'absorption')
    expect(long.status).toBe('against')
    expect(long.headline).toContain('above you')
    expect(find(evaluateTradeCheck({ side: 'short' }, s).checks, 'absorption').status).toBe('good')
  })

  it('keeps closed-window flow checks stable while the live risk price changes', () => {
    const closed = snap({ flowPrice: 80_200, priceStart: 80_000, cvdBtc: -20, deltaBtc: 40, volumeBtc: 100 })
    for (const price of [79_000, 80_005, 81_000]) {
      const checks = evaluateTradeCheck({ side: 'long' }, { ...closed, price }).checks
      expect(find(checks, 'divergence').status).toBe('against')
      expect(find(checks, 'absorption').status).toBe('neutral')
    }
    const missing = evaluateTradeCheck({ side: 'long' }, { ...closed, flowPrice: null }).checks
    expect(find(missing, 'divergence').status).toBe('unknown')
    expect(find(missing, 'absorption').status).toBe('unknown')
  })

  it('uses the shared large-liquidation boundary rather than the former 25k threshold', () => {
    expect(find(evaluateTradeCheck({ side: 'long' }, snap({ recentShortLiqUsd: 99_999 })).checks, 'liquidations').status).toBe('neutral')
    expect(find(evaluateTradeCheck({ side: 'long' }, snap({ recentShortLiqUsd: 100_000 })).checks, 'liquidations').status).toBe('caution')
  })

  it('maps OI regimes to each side', () => {
    const s = snap({ oiRegimeId: 'strong-downtrend' })
    expect(find(evaluateTradeCheck({ side: 'long' }, s).checks, 'regime').status).toBe('against')
    expect(find(evaluateTradeCheck({ side: 'short' }, s).checks, 'regime').status).toBe('good')
    expect(find(evaluateTradeCheck({ side: 'long' }, snap({ oiRegimeId: 'weak-uptrend' })).checks, 'regime').status).toBe('caution')
  })

  it('warns about chasing relative to VWAP scaled by ATR', () => {
    // 1.25% above VWAP with 0.4% ATR ≈ 3.1× → chasing for a long, a good location for a short
    const s = snap({ price: 81_000, priceStart: 81_000 })
    expect(find(evaluateTradeCheck({ side: 'long' }, s).checks, 'location').status).toBe('against')
    expect(find(evaluateTradeCheck({ side: 'short' }, s).checks, 'location').status).toBe('good')
    // Using the entry instead of the current price
    const r = evaluateTradeCheck({ side: 'long', entry: 79_700 }, s)
    expect(find(r.checks, 'location').status).toBe('good')
    expect(find(r.checks, 'location').title).toContain('entry')
  })

  it('detects crowding from funding and a rising long/short ratio', () => {
    const hot = snap({ fundingRate: 0.0005 })
    expect(find(evaluateTradeCheck({ side: 'long' }, hot).checks, 'crowding').status).toBe('against')
    expect(find(evaluateTradeCheck({ side: 'short' }, hot).checks, 'crowding').status).toBe('good')
    const piling = snap({ lsRatio: 2.3, lsRatioAvg: 2 })
    expect(find(evaluateTradeCheck({ side: 'long' }, piling).checks, 'crowding').status).toBe('caution')
    expect(find(evaluateTradeCheck({ side: 'short' }, piling).checks, 'crowding').status).toBe('neutral')
  })

  it('compares against the hourly trend', () => {
    const down = snap({ trendPct: -1.2 })
    expect(find(evaluateTradeCheck({ side: 'long' }, down).checks, 'trend').status).toBe('caution')
    expect(find(evaluateTradeCheck({ side: 'short' }, down).checks, 'trend').status).toBe('good')
  })

  it('treats opposite-side liquidations as a possible squeeze', () => {
    const s = snap({ recentShortLiqUsd: 200_000 })
    expect(find(evaluateTradeCheck({ side: 'long' }, s).checks, 'liquidations').status).toBe('caution')
    expect(find(evaluateTradeCheck({ side: 'short' }, s).checks, 'liquidations').status).toBe('neutral')
  })

  it('warns when a stop is inside normal noise', () => {
    const tight = evaluateTradeCheck({ side: 'long', entry: 80_000, stop: 79_850 }, snap())
    expect(find(tight.checks, 'stop').status).toBe('against')
    const roomy = evaluateTradeCheck({ side: 'short', entry: 80_000, stop: 80_800 }, snap())
    expect(find(roomy.checks, 'stop').status).toBe('good')
    const hit = evaluateTradeCheck({ side: 'long', entry: 80_500, stop: 80_100 }, snap())
    expect(find(hit.checks, 'stop').headline).toContain('already past')
  })

  it('warns about close liquidation and a stop beyond liquidation', () => {
    const high = evaluateTradeCheck({ side: 'long', entry: 80_000, leverage: 100 }, snap())
    expect(find(high.checks, 'liq-distance').status).toBe('against')
    const low = evaluateTradeCheck({ side: 'long', entry: 80_000, leverage: 3 }, snap())
    expect(find(low.checks, 'liq-distance').status).toBe('good')
    const beyond = evaluateTradeCheck({ side: 'short', entry: 80_000, stop: 90_000, leverage: 20 }, snap())
    expect(find(beyond.checks, 'liq-distance').headline).toContain('beyond your liquidation')
  })

  it('omits stop and leverage checks when those inputs are invalid', () => {
    const r = evaluateTradeCheck({ side: 'long', entry: 80_000, stop: 81_000, leverage: 500 }, snap())
    expect(r.issues).toHaveLength(2)
    expect(r.checks.some(c => c.id === 'stop' || c.id === 'liq-distance')).toBe(false)
  })

  it('sorts against-first and summarises counts', () => {
    const r = evaluateTradeCheck({ side: 'long' }, snap({ deltaBtc: -10, cvdBtc: -30, trendPct: 1 }))
    expect(r.checks[0].status).toBe('against')
    expect(r.summary.against).toBeGreaterThan(0)
    expect(r.summary.headline).toMatch(/in your favour/)
  })
})
