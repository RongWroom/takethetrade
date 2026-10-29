import { describe, expect, it } from 'vitest'
import {
  btcToSatoshis,
  calculateCvdMedianProfile,
  evaluateMarketPulse,
  evaluateOiRegime,
  replayTrades,
  scaleSparklineBars,
  type Trade,
} from './tradeEngine'

const trade = (id: string, time: number, side: Trade['side'], quantityBtc: string): Trade => ({ exchange: 'demo', symbol: 'BTC', id, time, side, quantityBtc })
const options = { exchange: 'demo', symbol: 'BTC', start: 0, end: 3000, bucketMs: 1000 }

describe('trade replay', () => {
  it('calculates exact volumes, signed delta and CVD even with late events and duplicates', () => {
    const buy = trade('a', 200, 'buy', '0.3')
    const result = replayTrades([trade('c', 1100, 'sell', '0.2'), buy, trade('b', 999, 'sell', '0.1'), buy, trade('d', 2000, 'buy', '0.00000001')], options)
    expect(result.duplicates).toBe(1)
    expect(result.buckets.map(b => [b.buy, b.sell, b.volume, b.delta, b.cvd])).toEqual([
      [30000000n,10000000n,40000000n,20000000n,20000000n],
      [0n,20000000n,20000000n,-20000000n,0n],
      [1n,0n,1n,1n,1n],
    ])
  })
  it('treats session end as exclusive and resets CVD in a new session', () => {
    const trades = [trade('a', 999, 'buy', '1'), trade('b', 1000, 'sell', '0.5')]
    expect(replayTrades(trades, { ...options, end: 1000 }).outsideSession).toBe(1)
    expect(replayTrades(trades, { ...options, start: 1000, end: 2000 }).buckets[0].cvd).toBe(-50000000n)
  })
  it('marks gaps and all subsequent session CVD as incomplete', () => {
    const result = replayTrades([], { ...options, gaps: [{ start: 1000, end: 1500 }] })
    expect(result.buckets.map(b => b.incomplete)).toEqual([false, true, true])
  })
  it('rejects malformed values, mismatched markets and conflicting duplicates', () => {
    for (const value of ['-1', '0', '1e-8', '0.000000001', 'NaN']) expect(() => btcToSatoshis(value)).toThrow()
    expect(() => replayTrades([trade('a', 0, 'buy', '1'), trade('a', 1, 'buy', '1')], options)).toThrow('Conflicting')
    expect(() => replayTrades([{ ...trade('a', 0, 'buy', '1'), symbol: 'OTHER' }], options)).toThrow('mismatched')
  })
})

describe('market pulse and sparkline scaling', () => {
  it('returns insufficient data when baseline observations are missing', () => {
    const res = evaluateMarketPulse({
      priceStart: null,
      priceEnd: null,
      deltaSats: null,
      cvdChangeSats: null,
      oiStartBtc: null,
      oiEndBtc: null,
      longLiqUsd: 0,
      shortLiqUsd: 0,
    })
    expect(res.ruleId).toBe('insufficient-data')
    expect(res.headline).toBe('Insufficient data')
  })

  it('matches deterministic rules for buying support, absorption, and high liquidation events', () => {
    const supporting = evaluateMarketPulse({
      priceStart: 80000,
      priceEnd: 80100,
      deltaSats: 500_000_000n,
      cvdChangeSats: 1_000_000_000n,
      oiStartBtc: 30000,
      oiEndBtc: 30010,
      longLiqUsd: 0,
      shortLiqUsd: 0,
    })
    expect(supporting.ruleId).toBe('buying-supporting-price')
    expect(supporting.headline).toBe('Buyers are stepping in aggressively and pushing price up.')

    const absorption = evaluateMarketPulse({
      priceStart: 80000,
      priceEnd: 80005,
      deltaSats: 500_000_000n,
      cvdChangeSats: 1_000_000_000n,
      oiStartBtc: 30000,
      oiEndBtc: 30000,
      longLiqUsd: 0,
      shortLiqUsd: 0,
    })
    expect(absorption.ruleId).toBe('buying-absorption')

    const liqDrop = evaluateMarketPulse({
      priceStart: 80000,
      priceEnd: 79500,
      deltaSats: -500_000_000n,
      cvdChangeSats: -1_000_000_000n,
      oiStartBtc: 30000,
      oiEndBtc: 29900,
      longLiqUsd: 250_000,
      shortLiqUsd: 0,
    })
    expect(liqDrop.ruleId).toBe('long-liquidations-drop')
    expect(liqDrop.headline).toContain('High liquidation event!')
  })

  it('scales sparkline bars to 12 items within 18..94', () => {
    const bars = scaleSparklineBars([1, 2, 4])
    expect(bars).toHaveLength(12)
    expect(Math.max(...bars)).toBe(94)
    expect(Math.min(...bars)).toBe(18)
  })

  it('calculates CVD median line and volume above/below median', () => {
    const profile = calculateCvdMedianProfile([-4, -2, 0, 2, 4], [10, 20, 15, 30, 40])
    expect(profile.medianBtc).toBe(0)
    expect(profile.aboveCount).toBe(2)
    expect(profile.belowCount).toBe(2)
    expect(profile.aboveVolumeBtc).toBe(70)
    expect(profile.belowVolumeBtc).toBe(30)
    expect(profile.bars).toHaveLength(12)
  })

  it('calculates all 4 Open Interest + Price + Volume regimes', () => {
    expect(
      evaluateOiRegime({
        priceStart: 80000,
        priceEnd: 80500,
        volumeSeriesBtc: [10, 25],
        oiStartBtc: 30000,
        oiEndBtc: 30500,
      }).activeRowId,
    ).toBe('strong-uptrend')

    expect(
      evaluateOiRegime({
        priceStart: 80000,
        priceEnd: 80500,
        volumeSeriesBtc: [25, 10],
        oiStartBtc: 30500,
        oiEndBtc: 30000,
      }).activeRowId,
    ).toBe('weak-uptrend')

    expect(
      evaluateOiRegime({
        priceStart: 80500,
        priceEnd: 80000,
        volumeSeriesBtc: [10, 25],
        oiStartBtc: 30000,
        oiEndBtc: 30500,
      }).activeRowId,
    ).toBe('strong-downtrend')

    expect(
      evaluateOiRegime({
        priceStart: 80500,
        priceEnd: 80000,
        volumeSeriesBtc: [25, 10],
        oiStartBtc: 30500,
        oiEndBtc: 30000,
      }).activeRowId,
    ).toBe('weak-downtrend')
  })
})

