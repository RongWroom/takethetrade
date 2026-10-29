import { describe, expect, it } from 'vitest'
import {
  getTimeframeOption,
  normalizeOkxCandles,
  normalizeOkxLiquidationOrders,
  normalizeOkxOiHistory,
  normalizeOkxOpenInterest,
  normalizeOkxTakerVolume,
  normalizeOkxTrade,
} from './okx'

const trade = { instId: 'BTC-USDT-SWAP', tradeId: '123', side: 'buy', sz: '0.61', ts: '1793220086598', px: '81069.9' }

describe('OKX trades', () => {
  it('converts swap contracts to BTC exactly', () => {
    expect(normalizeOkxTrade(trade)).toMatchObject({ quantityBtc: '0.00610000', side: 'buy', id: '123', time: 1793220086598 })
  })
  it('rejects malformed and unrelated data', () => {
    for (const value of [{ ...trade, sz: '0.0000001' }, { ...trade, side: 'unknown' }, { ...trade, instId: 'OTHER' }, { ...trade, px: '0' }]) {
      expect(() => normalizeOkxTrade(value)).toThrow()
    }
  })
})

describe('OKX open interest', () => {
  it('preserves BTC units and timestamp', () => {
    expect(normalizeOkxOpenInterest({ instId: 'BTC-USDT-SWAP', oiCcy: '30416.048100000105', ts: '1793220083984' })).toEqual({
      btc: '30416.048100000105',
      time: 1793220083984,
    })
  })
  it('rejects malformed samples', () => {
    expect(() => normalizeOkxOpenInterest({ instId: 'BTC-USDT-SWAP', oiCcy: 'NaN', ts: '0' })).toThrow()
  })
})

describe('OKX liquidation orders', () => {
  it('normalizes BTC-USDT-SWAP liquidation details and ignores other swap symbols', () => {
    expect(normalizeOkxLiquidationOrders({ instId: 'ETH-USDT-SWAP', details: [] })).toEqual([])
    const res = normalizeOkxLiquidationOrders({
      instId: 'BTC-USDT-SWAP',
      details: [{ bkPx: '80000', posSide: 'long', side: 'sell', sz: '50', ts: '1793220085000' }],
    })
    expect(res).toEqual([
      {
        id: '1793220085000:long:50:80000',
        time: 1793220085000,
        side: 'long',
        btc: '0.50000000',
        notionalUsd: 40000,
        price: '80000',
      },
    ])
  })
})

describe('OKX timeframe options and REST normalizers', () => {
  it('returns correct bucket duration and rubik period for 15m and 30m', () => {
    expect(getTimeframeOption('15m')).toMatchObject({ bucketMs: 900_000, candleBar: '15m', rubikPeriod: '15m' })
    expect(getTimeframeOption('30m')).toMatchObject({ bucketMs: 1_800_000, candleBar: '30m', rubikPeriod: '30m' })
  })

  it('normalizes and sorts OKX candles, taker volume, and open interest history oldest-first', () => {
    const candles = normalizeOkxCandles([
      ['1793220900000', '80100', '80250', '80050', '80200', '1000', '10.5'],
      ['1793220000000', '80000', '80150', '79950', '80100', '800', '8.0'],
    ])
    expect(candles).toHaveLength(2)
    expect(candles[0].time).toBe(1793220000000)
    expect(candles[1].close).toBe(80200)

    const taker = normalizeOkxTakerVolume([
      ['1793220900000', '12.5', '18.5'],
      ['1793220000000', '15.0', '10.0'],
    ])
    expect(taker).toHaveLength(2)
    expect(taker[0].deltaBtc).toBe(-5)
    expect(taker[1].deltaBtc).toBe(6)

    const oi = normalizeOkxOiHistory([
      ['1793220900000', '2500000000', '10000000'],
      ['1793220000000', '2400000000', '9000000'],
    ])
    expect(oi).toHaveLength(2)
    expect(oi[0].oiUsd).toBe(2400000000)
    expect(oi[1].oiUsd).toBe(2500000000)
  })
})

