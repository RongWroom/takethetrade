import { describe, expect, it } from 'vitest'
import { btcToSatoshis, replayTrades, type Trade } from './tradeEngine'

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
