import type { Trade } from '../domain/tradeEngine'

/** OKX reports swap sizes in contracts; BTC-USDT-SWAP is 0.01 BTC per contract. */
export function normalizeOkxTrade(row: unknown): Trade & { price: string } {
  if (!row || typeof row !== 'object') throw new Error('Invalid trade')
  const r = row as Record<string, unknown>
  if (r.instId !== 'BTC-USDT-SWAP' || typeof r.tradeId !== 'string' || !r.tradeId || (r.side !== 'buy' && r.side !== 'sell') || typeof r.sz !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(r.sz) || typeof r.ts !== 'string' || !/^\d+$/.test(r.ts) || typeof r.px !== 'string' || !/^\d+(?:\.\d+)?$/.test(r.px) || !Number.isSafeInteger(Number(r.ts))) throw new Error('Invalid trade')
  const [whole, fraction = ''] = r.sz.split('.')
  const sats = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))
  if (sats <= 0n || Number(r.px) <= 0) throw new Error('Invalid trade')
  return { exchange:'OKX', symbol:'BTC-USDT-SWAP', id:r.tradeId, time:Number(r.ts), side:r.side, quantityBtc:`${sats / 100_000_000n}.${String(sats % 100_000_000n).padStart(8,'0')}`, price:r.px }
}

/** OI currency units are supplied by OKX as BTC for the linear BTC-USDT swap. */
export function normalizeOkxOpenInterest(row: unknown): { btc: string; time: number } {
  if (!row || typeof row !== 'object') throw new Error('Invalid open interest')
  const r = row as Record<string, unknown>
  if (r.instId !== 'BTC-USDT-SWAP' || typeof r.oiCcy !== 'string' || !/^\d+(?:\.\d+)?$/.test(r.oiCcy) || typeof r.ts !== 'string' || !/^\d+$/.test(r.ts) || !Number.isSafeInteger(Number(r.ts))) throw new Error('Invalid open interest')
  return { btc: r.oiCcy, time: Number(r.ts) }
}
