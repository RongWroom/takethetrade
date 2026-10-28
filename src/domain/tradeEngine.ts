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

export type PulseInput = {
  priceStart: number | null
  priceEnd: number | null
  deltaSats: bigint | null
  cvdChangeSats: bigint | null
  oiStartBtc: number | null
  oiEndBtc: number | null
  longLiqUsd: number
  shortLiqUsd: number
}

export type PulseEvaluation = {
  ruleId: string
  observation: string
  headline: string
  copy: string
  evidence: string
}

export function evaluateMarketPulse(input: PulseInput): PulseEvaluation {
  const { priceStart, priceEnd, deltaSats, cvdChangeSats, oiStartBtc, oiEndBtc, longLiqUsd } = input
  if (priceStart === null || priceEnd === null || deltaSats === null || cvdChangeSats === null) {
    return {
      ruleId: 'insufficient-data',
      observation: 'Waiting for baseline',
      headline: 'Insufficient data',
      copy: 'Collecting live OKX trade and open-interest observations for this session before evaluating order-flow rules.',
      evidence: 'Requires observed session price window, executed trade delta, and cumulative volume delta.',
    }
  }
  const pricePct = priceStart > 0 ? ((priceEnd - priceStart) / priceStart) * 100 : 0
  const priceUp = pricePct > 0.02
  const priceDown = pricePct < -0.02
  const priceFlat = Math.abs(pricePct) <= 0.02
  const oiPct = oiStartBtc !== null && oiEndBtc !== null && oiStartBtc > 0 ? ((oiEndBtc - oiStartBtc) / oiStartBtc) * 100 : null
  const oiUp = oiPct !== null && oiPct > 0.01
  const oiDown = oiPct !== null && oiPct < -0.01

  const evidenceSummary = `Price ${pricePct >= 0 ? '+' : ''}${pricePct.toFixed(2)}% · Delta ${deltaSats >= 0n ? '+' : '-'}${Number(deltaSats < 0n ? -deltaSats : deltaSats) / 1e8} BTC · CVD change ${cvdChangeSats >= 0n ? '+' : '-'}${Number(cvdChangeSats < 0n ? -cvdChangeSats : cvdChangeSats) / 1e8} BTC${oiPct !== null ? ` · OI ${oiPct >= 0 ? '+' : ''}${oiPct.toFixed(2)}%` : ' · OI baseline pending'}`

  if (longLiqUsd >= 100_000 && priceDown) {
    return {
      ruleId: 'long-liquidations-drop',
      observation: 'Rule: liquidation cascade',
      headline: 'Elevated forced long closures coincide with the decline.',
      copy: 'Reported long liquidations coincide with downward price progress. Exchange liquidation feeds are sampled and may not represent every forced closure.',
      evidence: `${evidenceSummary} · Long liquidations $${Math.round(longLiqUsd).toLocaleString('en-US')}`,
    }
  }
  if (priceUp && deltaSats > 0n && cvdChangeSats > 0n) {
    return {
      ruleId: 'buying-supporting-price',
      observation: 'Rule: taker confirmation',
      headline: 'Aggressive buying is supporting the price move.',
      copy: 'Positive taker delta and rising session CVD align with upward price movement. This describes recent order flow, not a prediction.',
      evidence: evidenceSummary,
    }
  }
  if (priceFlat && cvdChangeSats > 0n && deltaSats > 0n) {
    return {
      ruleId: 'buying-absorption',
      observation: 'Rule: divergence check',
      headline: 'Buying aggression is not translating into comparable price progress; possible absorption.',
      copy: 'Net taker buying is positive while price remains near its session baseline, which can occur when resting sell liquidity absorbs market buys.',
      evidence: evidenceSummary,
    }
  }
  if (priceDown && oiUp) {
    return {
      ruleId: 'decline-oi-expanding',
      observation: 'Rule: positioning expansion',
      headline: 'Outstanding positioning is expanding during a decline; direction of new positioning is not proven.',
      copy: 'Open interest has increased alongside lower prices. Rising open interest shows new contracts opening, but every contract has both a long and a short side.',
      evidence: evidenceSummary,
    }
  }
  if (priceUp && oiDown) {
    return {
      ruleId: 'price-up-oi-down',
      observation: 'Rule: position reduction',
      headline: 'Position closing may be contributing to the move.',
      copy: 'Price is higher while open interest has contracted, consistent with net position closures.',
      evidence: evidenceSummary,
    }
  }
  return {
    ruleId: 'neutral-flow',
    observation: 'Live observation',
    headline: 'Mixed or balanced order flow in the current window.',
    copy: 'Observed price, delta, CVD and open-interest changes do not show a single dominant alignment right now.',
    evidence: evidenceSummary,
  }
}

export function scaleSparklineBars(values: readonly number[], count = 12): number[] {
  const padded = values.length >= count ? values.slice(-count) : [...Array<number>(count - values.length).fill(0), ...values]
  const absValues = padded.map(v => Math.abs(v))
  const max = Math.max(...absValues, 0)
  if (max === 0) return padded.map((_, i) => 18 + ((i * 5) % 20))
  return absValues.map(v => Math.round(18 + (v / max) * 76))
}

