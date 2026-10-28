/** Quantities are represented as integer satoshis. No floating-point arithmetic. */
export type Side = 'buy' | 'sell'
export type Trade = { exchange: string; symbol: string; id: string; time: number; side: Side; quantityBtc: string }
export type Gap = { start: number; end: number }
export type Bucket = { start: number; end: number; buy: bigint; sell: bigint; volume: bigint; delta: bigint; cvd: bigint; incomplete: boolean }
export type Replay = { buckets: Bucket[]; duplicates: number; outsideSession: number }

export function btcToSatoshis(value: string): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(value)) throw new Error('Invalid BTC quantity')
  const [whole, fraction = ''] = value.split('.')
  const amount = BigInt(whole) * 100_000_000n + BigInt(fraction.padEnd(8, '0'))
  if (amount <= 0n) throw new Error('Trade quantity must be positive')
  return amount
}

/** Replays one exchange and symbol, with UTC epoch-millisecond boundaries [start, end). */
export function replayTrades(trades: readonly Trade[], options: { exchange: string; symbol: string; start: number; end: number; bucketMs: number; gaps?: readonly Gap[] }): Replay {
  const { exchange, symbol, start, end, bucketMs, gaps = [] } = options
  if (!exchange || !symbol || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !Number.isSafeInteger(bucketMs) || bucketMs <= 0 || end <= start || (end - start) % bucketMs !== 0) throw new Error('Invalid session boundaries')
  if ((end - start) / bucketMs > 10000) throw new Error('Too many buckets')
  for (const gap of gaps) if (!Number.isSafeInteger(gap.start) || !Number.isSafeInteger(gap.end) || gap.end <= gap.start) throw new Error('Invalid gap')
  const buckets: Bucket[] = Array.from({ length: (end - start) / bucketMs }, (_, i) => {
    const from = start + i * bucketMs, to = from + bucketMs
    return { start: from, end: to, buy: 0n, sell: 0n, volume: 0n, delta: 0n, cvd: 0n, incomplete: gaps.some(g => g.start < to && g.end > from) }
  })
  const seen = new Map<string, string>()
  let duplicates = 0, outsideSession = 0
  for (const trade of trades) {
    if (trade.exchange !== exchange || trade.symbol !== symbol || !trade.id || !Number.isSafeInteger(trade.time) || (trade.side !== 'buy' && trade.side !== 'sell')) throw new Error('Invalid or mismatched trade')
    const amount = btcToSatoshis(trade.quantityBtc)
    const fingerprint = `${trade.time}:${trade.side}:${amount}`
    const previous = seen.get(trade.id)
    if (previous !== undefined) {
      if (previous !== fingerprint) throw new Error('Conflicting duplicate trade')
      duplicates++
      continue
    }
    seen.set(trade.id, fingerprint)
    if (trade.time < start || trade.time >= end) { outsideSession++; continue }
    const bucket = buckets[Math.floor((trade.time - start) / bucketMs)]
    if (trade.side === 'buy') bucket.buy += amount
    else bucket.sell += amount
  }
  let cvd = 0n, gapSeen = false
  for (const bucket of buckets) {
    bucket.volume = bucket.buy + bucket.sell
    bucket.delta = bucket.buy - bucket.sell
    cvd += bucket.delta
    bucket.cvd = cvd
    gapSeen ||= bucket.incomplete
    bucket.incomplete = gapSeen
  }
  return { buckets, duplicates, outsideSession }
}
