import type { Trade } from '../domain/tradeEngine'

export type TimeframeId = '1m' | '5m' | '15m' | '30m' | '1h'

export type TimeframeOption = {
  id: TimeframeId
  label: string
  shortLabel: string
  bucketMs: number
  candleBar: string
  rubikPeriod: '5m' | '15m' | '30m' | '1H' | null
}

export const TIMEFRAME_OPTIONS: readonly TimeframeOption[] = [
  { id: '1m', label: '1 minute', shortLabel: '1m', bucketMs: 60_000, candleBar: '1m', rubikPeriod: null },
  { id: '5m', label: '5 minutes', shortLabel: '5m', bucketMs: 300_000, candleBar: '5m', rubikPeriod: '5m' },
  { id: '15m', label: '15 minutes', shortLabel: '15m', bucketMs: 900_000, candleBar: '15m', rubikPeriod: '15m' },
  { id: '30m', label: '30 minutes', shortLabel: '30m', bucketMs: 1_800_000, candleBar: '30m', rubikPeriod: '30m' },
  { id: '1h', label: '1 hour', shortLabel: '1h', bucketMs: 3_600_000, candleBar: '1H', rubikPeriod: '1H' },
]

export function getTimeframeOption(id: TimeframeId): TimeframeOption {
  return TIMEFRAME_OPTIONS.find(t => t.id === id) ?? TIMEFRAME_OPTIONS[0]
}

export type OkxCandlePoint = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volumeBtc: number
}

export type OkxTakerVolumeBucket = {
  time: number
  sellBtc: number
  buyBtc: number
  deltaBtc: number
  volumeBtc: number
}

export type OkxOiHistoryPoint = {
  time: number
  oiUsd: number
}

/** Normalizes OKX /api/v5/market/candles rows (newest-first from API, returned oldest-first). */
export function normalizeOkxCandles(rows: unknown): OkxCandlePoint[] {
  if (!Array.isArray(rows)) return []
  const out: OkxCandlePoint[] = []
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 7) continue
    const ts = Number(row[0])
    const open = Number(row[1])
    const high = Number(row[2])
    const low = Number(row[3])
    const close = Number(row[4])
    const volCcy = Number(row[6])
    if (
      !Number.isSafeInteger(ts) ||
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close) ||
      open <= 0 ||
      close <= 0
    ) {
      continue
    }
    out.push({
      time: ts,
      open,
      high,
      low,
      close,
      volumeBtc: Number.isFinite(volCcy) && volCcy >= 0 ? volCcy : 0,
    })
  }
  return out.sort((a, b) => a.time - b.time)
}

/** Normalizes OKX /api/v5/rubik/stat/taker-volume-contract rows (`[ts, sellVol, buyVol]`), returned oldest-first. */
export function normalizeOkxTakerVolume(rows: unknown): OkxTakerVolumeBucket[] {
  if (!Array.isArray(rows)) return []
  const out: OkxTakerVolumeBucket[] = []
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 3) continue
    const ts = Number(row[0])
    const sellBtc = Number(row[1])
    const buyBtc = Number(row[2])
    if (!Number.isSafeInteger(ts) || !Number.isFinite(sellBtc) || !Number.isFinite(buyBtc) || sellBtc < 0 || buyBtc < 0) {
      continue
    }
    out.push({
      time: ts,
      sellBtc,
      buyBtc,
      deltaBtc: buyBtc - sellBtc,
      volumeBtc: buyBtc + sellBtc,
    })
  }
  return out.sort((a, b) => a.time - b.time)
}

/** Normalizes OKX /api/v5/rubik/stat/contracts/open-interest-volume rows (`[ts, oiUsd, volUsd]`), returned oldest-first. */
export function normalizeOkxOiHistory(rows: unknown): OkxOiHistoryPoint[] {
  if (!Array.isArray(rows)) return []
  const out: OkxOiHistoryPoint[] = []
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2) continue
    const ts = Number(row[0])
    const oiUsd = Number(row[1])
    if (!Number.isSafeInteger(ts) || !Number.isFinite(oiUsd) || oiUsd <= 0) continue
    out.push({ time: ts, oiUsd })
  }
  return out.sort((a, b) => a.time - b.time)
}

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

