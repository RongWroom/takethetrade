import type { Trade } from '../domain/tradeEngine'

export type Liquidation = {
  id: string
  time: number
  /** Disclosed position side that was liquidated ('long' = forced sell, 'short' = forced buy). */
  side: 'long' | 'short'
  btc: string
  notionalUsd: number
  price: string
}

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

/**
 * Normalizes OKX public liquidation-orders entries for BTC-USDT-SWAP.
 * Filters out other SWAP instruments on the shared liquidation-orders channel.
 */
export function normalizeOkxLiquidationOrders(row: unknown): Liquidation[] {
  if (!row || typeof row !== 'object') throw new Error('Invalid liquidation payload')
  const r = row as Record<string, unknown>
  if (typeof r.instId !== 'string' || !Array.isArray(r.details)) throw new Error('Invalid liquidation payload')
  if (r.instId !== 'BTC-USDT-SWAP') return []
  const out: Liquidation[] = []
  for (const item of r.details) {
    if (!item || typeof item !== 'object') throw new Error('Invalid liquidation detail')
    const d = item as Record<string, unknown>
    if (typeof d.sz !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(d.sz) || typeof d.bkPx !== 'string' || !/^\d+(?:\.\d+)?$/.test(d.bkPx) || typeof d.ts !== 'string' || !/^\d+$/.test(d.ts) || !Number.isSafeInteger(Number(d.ts))) throw new Error('Invalid liquidation detail')
    const [whole, fraction = ''] = d.sz.split('.')
    const sats = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))
    const px = Number(d.bkPx)
    if (sats <= 0n || px <= 0) throw new Error('Invalid liquidation detail')
    let side: 'long' | 'short'
    if (d.posSide === 'long' || d.posSide === 'short') {
      side = d.posSide
    } else if (d.side === 'sell') {
      side = 'long'
    } else if (d.side === 'buy') {
      side = 'short'
    } else {
      throw new Error('Invalid liquidation side')
    }
    const btcNum = Number(sats) / 100_000_000
    const btc = `${sats / 100_000_000n}.${String(sats % 100_000_000n).padStart(8, '0')}`
    out.push({
      id: `${d.ts}:${side}:${d.sz}:${d.bkPx}`,
      time: Number(d.ts),
      side,
      btc,
      notionalUsd: btcNum * px,
      price: d.bkPx,
    })
  }
  return out
}

