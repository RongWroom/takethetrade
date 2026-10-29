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
  const { priceStart, priceEnd, deltaSats, cvdChangeSats, oiStartBtc, oiEndBtc, longLiqUsd, shortLiqUsd } = input
  if (priceStart === null || priceEnd === null || deltaSats === null || cvdChangeSats === null) {
    return {
      ruleId: 'insufficient-data',
      observation: 'Waiting for baseline',
      headline: 'Insufficient data',
      copy: 'Listening for live trades and open interest so we can translate what buyers and sellers are doing in plain English.',
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
      observation: 'High liquidation event',
      headline: 'High liquidation event! Buyers (longs) are being forced to sell into the drop.',
      copy: 'This means over-leveraged buyers got wiped out as price fell. Their positions were automatically sold at market price, adding extra downward selling pressure.',
      evidence: `${evidenceSummary} · Long liquidations $${Math.round(longLiqUsd).toLocaleString('en-US')}`,
    }
  }
  if (shortLiqUsd >= 100_000 && priceUp) {
    return {
      ruleId: 'short-liquidations-squeeze',
      observation: 'High liquidation event',
      headline: 'High liquidation event! Sellers (shorts) are being forced to buy into the rally.',
      copy: 'This means traders betting on a drop got squeezed as price rose. Their positions were automatically bought back at market price, fueling the move higher.',
      evidence: `${evidenceSummary} · Short liquidations $${Math.round(shortLiqUsd).toLocaleString('en-US')}`,
    }
  }
  if (priceUp && deltaSats > 0n && cvdChangeSats > 0n) {
    return {
      ruleId: 'buying-supporting-price',
      observation: 'Buyers in control',
      headline: 'Buyers are stepping in aggressively and pushing price up.',
      copy: 'This means buyers are impatiently hitting the "buy at market" button faster than sellers, and price is rising right along with their buying.',
      evidence: evidenceSummary,
    }
  }
  if (priceDown && deltaSats < 0n && cvdChangeSats < 0n) {
    return {
      ruleId: 'selling-pressing-price',
      observation: 'Sellers in control',
      headline: 'Sellers are aggressively dumping at market and pushing price down.',
      copy: 'This means sellers are urgently hitting the bid with market sell orders rather than waiting, driving the price lower.',
      evidence: evidenceSummary,
    }
  }
  if (priceFlat && cvdChangeSats > 0n && deltaSats > 0n) {
    return {
      ruleId: 'buying-absorption',
      observation: 'Hidden sell wall (Absorption)',
      headline: 'Buyers are trying to push price up, but big sellers are soaking it all up.',
      copy: 'This means market buyers are buying aggressively, yet price is barely moving. Large passive sellers are sitting with limit orders and absorbing the buying pressure.',
      evidence: evidenceSummary,
    }
  }
  if (priceDown && oiUp) {
    return {
      ruleId: 'decline-oi-expanding',
      observation: 'Strong downtrend · New shorts entering',
      headline: 'Price is dropping while new money enters — aggressive sellers are opening fresh shorts.',
      copy: 'This means the drop is not just people selling spot; traders are actively opening new leveraged bets as price falls, which usually signals strong bearish momentum.',
      evidence: evidenceSummary,
    }
  }
  if (priceUp && oiDown) {
    return {
      ruleId: 'price-up-oi-down',
      observation: 'Weak uptrend · Short covering',
      headline: 'Price is rising, but traders are closing positions rather than opening new ones.',
      copy: 'This means the bounce is likely driven by sellers (shorts) buying back to exit their trades while money leaves the market. Once they finish covering, the move up can stall.',
      evidence: evidenceSummary,
    }
  }
  return {
    ruleId: 'neutral-flow',
    observation: 'Balanced market',
    headline: 'Buyers and sellers are in a tug-of-war with no clear winner right now.',
    copy: 'This means neither buyers nor sellers have taken decisive control in this session window — order flow is mixed and balanced.',
    evidence: evidenceSummary,
  }
}

export type CvdMedianBar = {
  valueBtc: number
  deviationBtc: number
  volumeBtc: number
  direction: 'above' | 'below' | 'on'
  heightPct: number
}

export type CvdMedianProfile = {
  medianBtc: number
  aboveVolumeBtc: number
  belowVolumeBtc: number
  aboveCount: number
  belowCount: number
  bars: CvdMedianBar[]
  summary: string
}

export function calculateCvdMedianProfile(
  cvdSeriesBtc: readonly number[],
  volumeSeriesBtc: readonly number[] = [],
  count = 12,
): CvdMedianProfile {
  const paddedCvd =
    cvdSeriesBtc.length >= count
      ? cvdSeriesBtc.slice(-count)
      : [...Array<number>(count - cvdSeriesBtc.length).fill(0), ...cvdSeriesBtc]
  const paddedVol =
    volumeSeriesBtc.length >= count
      ? volumeSeriesBtc.slice(-count)
      : [...Array<number>(count - volumeSeriesBtc.length).fill(0), ...volumeSeriesBtc]

  const activeValues = cvdSeriesBtc.length > 0 ? [...cvdSeriesBtc].sort((a, b) => a - b) : [0]
  const mid = Math.floor(activeValues.length / 2)
  const medianBtc =
    activeValues.length % 2 === 1
      ? activeValues[mid]
      : (activeValues[mid - 1] + activeValues[mid]) / 2

  const deviations = paddedCvd.map(v => v - medianBtc)
  const maxAbsDev = Math.max(...deviations.map(d => Math.abs(d)), 0)

  let aboveVolumeBtc = 0
  let belowVolumeBtc = 0
  let aboveCount = 0
  let belowCount = 0

  const bars: CvdMedianBar[] = paddedCvd.map((valueBtc, idx) => {
    const hasData = idx >= count - cvdSeriesBtc.length && cvdSeriesBtc.length > 0
    const deviationBtc = hasData ? valueBtc - medianBtc : 0
    const rawVol = paddedVol[idx] ?? 0
    const fallbackVol = Math.abs(deviationBtc)
    const volumeBtc = hasData ? (rawVol > 0 ? rawVol : fallbackVol) : 0
    const direction: CvdMedianBar['direction'] =
      !hasData || Math.abs(deviationBtc) < 1e-9
        ? 'on'
        : deviationBtc > 0
          ? 'above'
          : 'below'

    if (hasData) {
      if (deviationBtc > 1e-9) {
        aboveVolumeBtc += volumeBtc
        aboveCount++
      } else if (deviationBtc < -1e-9) {
        belowVolumeBtc += volumeBtc
        belowCount++
      }
    }

    const heightPct =
      !hasData || maxAbsDev === 0
        ? 8
        : Math.round(14 + (Math.abs(deviationBtc) / maxAbsDev) * 82)

    return {
      valueBtc,
      deviationBtc,
      volumeBtc,
      direction,
      heightPct,
    }
  })

  const latestCvd = cvdSeriesBtc.length > 0 ? cvdSeriesBtc[cvdSeriesBtc.length - 1] : null
  const summary =
    latestCvd === null
      ? 'Waiting for live trades to plot volume above and below the CVD median line.'
      : latestCvd > medianBtc
        ? `CVD is above the median line — buyers are holding control above the session midpoint (${aboveVolumeBtc.toFixed(2)} BTC traded above vs ${belowVolumeBtc.toFixed(2)} BTC below).`
        : latestCvd < medianBtc
          ? `CVD is below the median line — sellers are pressing underneath the session midpoint (${belowVolumeBtc.toFixed(2)} BTC traded below vs ${aboveVolumeBtc.toFixed(2)} BTC above).`
          : `CVD is sitting right on the median line — buying and selling volume are balanced around the midpoint.`

  return {
    medianBtc,
    aboveVolumeBtc,
    belowVolumeBtc,
    aboveCount,
    belowCount,
    bars,
    summary,
  }
}

export type OiRegimeId = 'strong-uptrend' | 'weak-uptrend' | 'strong-downtrend' | 'weak-downtrend'

export type OiCheatSheetRow = {
  id: OiRegimeId
  priceLabel: 'rising' | 'declining'
  volumeLabel: 'increasing' | 'decreasing'
  oiLabel: 'increasing' | 'decreasing'
  marketTitle: string
  sentiment: 'Bullish' | 'Bearish'
  explanation: string
  plainEnglish: string
}

export const OI_CHEAT_SHEET_ROWS: readonly OiCheatSheetRow[] = [
  {
    id: 'strong-uptrend',
    priceLabel: 'rising',
    volumeLabel: 'increasing',
    oiLabel: 'increasing',
    marketTitle: 'Strong uptrend',
    sentiment: 'Bullish',
    explanation:
      'With prices moving up in an uptrend and total open interest increasing this shows that new money is coming into the market which is considered bullish.',
    plainEnglish:
      'Buyers are in control! Price is rising while volume and open interest climb — fresh money is entering the market to open new long positions.',
  },
  {
    id: 'weak-uptrend',
    priceLabel: 'rising',
    volumeLabel: 'decreasing',
    oiLabel: 'decreasing',
    marketTitle: 'Weak uptrend',
    sentiment: 'Bearish',
    explanation:
      'If prices are rising and open interest declines the movement up is only likely to be caused by shorts covering and money is leaving rather than entering the market. Once shorts stop covering the trend is likely to reverse back down.',
    plainEnglish:
      'Watch out for a fake bounce! Price is rising, but open interest is dropping — sellers (shorts) are just buying back to close their trades and money is leaving the market.',
  },
  {
    id: 'strong-downtrend',
    priceLabel: 'declining',
    volumeLabel: 'increasing',
    oiLabel: 'increasing',
    marketTitle: 'Strong downtrend',
    sentiment: 'Bearish',
    explanation:
      'If price is in a downtrend and open interest is rising this shows that new money is coming into the market with aggressive short selling which is considered bearish.',
    plainEnglish:
      'Sellers are piling in! Price is falling while open interest rises — fresh money is entering the market with aggressive short selling, pushing price down.',
  },
  {
    id: 'weak-downtrend',
    priceLabel: 'declining',
    volumeLabel: 'decreasing',
    oiLabel: 'decreasing',
    marketTitle: 'Weak downtrend',
    sentiment: 'Bullish',
    explanation:
      'If total open interest is declining along with declining prices this is considered bullish.',
    plainEnglish:
      'Selling is running out of steam! Price and open interest are falling together — trapped buyers (longs) are closing out and leaving the market, meaning the drop may be exhausting.',
  },
]

export type OiRegimeEvaluation = {
  activeRowId: OiRegimeId | null
  activeRow: OiCheatSheetRow | null
  priceDirection: 'rising' | 'declining' | 'flat'
  volumeDirection: 'increasing' | 'decreasing' | 'flat'
  oiDirection: 'increasing' | 'decreasing' | 'flat'
  volumeConfirmsOi: boolean
  continuationNote: string
}

export function evaluateOiRegime(input: {
  priceStart: number | null
  priceEnd: number | null
  volumeSeriesBtc: readonly number[]
  oiStartBtc: number | null
  oiEndBtc: number | null
}): OiRegimeEvaluation {
  const { priceStart, priceEnd, volumeSeriesBtc, oiStartBtc, oiEndBtc } = input

  const priceDiff = priceStart !== null && priceEnd !== null ? priceEnd - priceStart : 0
  const priceDirection: OiRegimeEvaluation['priceDirection'] =
    priceStart === null || priceEnd === null || Math.abs(priceDiff) < 1e-9
      ? 'flat'
      : priceDiff > 0
        ? 'rising'
        : 'declining'

  const oiDiff = oiStartBtc !== null && oiEndBtc !== null ? oiEndBtc - oiStartBtc : 0
  const oiDirection: OiRegimeEvaluation['oiDirection'] =
    oiStartBtc === null || oiEndBtc === null || Math.abs(oiDiff) < 1e-9
      ? 'flat'
      : oiDiff > 0
        ? 'increasing'
        : 'decreasing'

  let volumeDirection: OiRegimeEvaluation['volumeDirection'] = 'flat'
  if (volumeSeriesBtc.length >= 2) {
    const mid = Math.floor(volumeSeriesBtc.length / 2)
    const firstHalf = volumeSeriesBtc.slice(0, mid)
    const secondHalf = volumeSeriesBtc.slice(mid)
    const firstAvg = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length
    const secondAvg = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length
    if (secondAvg > firstAvg) volumeDirection = 'increasing'
    else if (secondAvg < firstAvg) volumeDirection = 'decreasing'
  } else if (volumeSeriesBtc.length === 1 && volumeSeriesBtc[0] > 0) {
    volumeDirection = oiDirection === 'decreasing' ? 'decreasing' : 'increasing'
  }

  let activeRowId: OiRegimeId | null = null
  if (priceDirection !== 'flat' && oiDirection !== 'flat') {
    if (priceDirection === 'rising' && oiDirection === 'increasing') activeRowId = 'strong-uptrend'
    else if (priceDirection === 'rising' && oiDirection === 'decreasing') activeRowId = 'weak-uptrend'
    else if (priceDirection === 'declining' && oiDirection === 'increasing') activeRowId = 'strong-downtrend'
    else if (priceDirection === 'declining' && oiDirection === 'decreasing') activeRowId = 'weak-downtrend'
  }

  const activeRow = activeRowId ? OI_CHEAT_SHEET_ROWS.find(r => r.id === activeRowId) ?? null : null
  const volumeConfirmsOi =
    volumeDirection !== 'flat' && oiDirection !== 'flat' && volumeDirection === oiDirection

  const continuationNote =
    volumeDirection === 'increasing' && oiDirection === 'increasing'
      ? 'Both volume and open interest are increasing — the current price trend will probably continue in its present direction.'
      : volumeDirection === 'decreasing' && oiDirection === 'decreasing'
        ? 'Both volume and open interest are declining — the action can be viewed as exhausted and the current price trend may be nearing an end.'
        : 'If volume and open interest are both increasing then the current price trend will probably continue in its present direction. If both are declining, the action can be viewed as exhausted and the trend may be nearing an end.'

  return {
    activeRowId,
    activeRow,
    priceDirection,
    volumeDirection,
    oiDirection,
    volumeConfirmsOi,
    continuationNote,
  }
}

export function scaleSparklineBars(values: readonly number[], count = 12): number[] {
  const padded = values.length >= count ? values.slice(-count) : [...Array<number>(count - values.length).fill(0), ...values]
  const absValues = padded.map(v => Math.abs(v))
  const max = Math.max(...absValues, 0)
  if (max === 0) return padded.map((_, i) => 18 + ((i * 5) % 20))
  return absValues.map(v => Math.round(18 + (v / max) * 76))
}

