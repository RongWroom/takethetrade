import { describe, expect, it } from 'vitest'
import { normalizeOkxLiquidationOrders, normalizeOkxOpenInterest, normalizeOkxTrade } from './okx'

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

