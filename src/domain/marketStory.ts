import { LIQUIDATION_LARGE_USD } from './marketRules'
import { calcRsi } from './tradeCheck'

export type StoryDivergenceKind = 'bullish' | 'bearish' | null
export type StoryAbsorptionKind = 'buy-wall' | 'sell-wall' | null
export type StoryOiState = 'opening' | 'closing' | 'steady' | 'missing'
export type StoryRsiZone = 'overbought' | 'oversold' | 'neutral'
export type StoryStructureEvent = 'bullish-bos' | 'bearish-bos' | 'bullish-choch' | 'bearish-choch' | null
export type StoryLiquiditySweep = 'bullish-sweep' | 'bearish-sweep' | null

export type OrderBlockZone = {
  kind: 'bullish' | 'bearish'
  top: number
  bottom: number
  topY: number
  bottomY: number
  bucketIndex: number
  volumeBtc: number | null
  deltaBtc: number | null
  label: string
}

export type MarketStructureEvaluation = {
  bias: 'bullish' | 'bearish' | 'neutral'
  lastEvent: StoryStructureEvent
  lastEventLabel: string | null
  lastEventLevel: number | null
  lastEventLevelY: number | null
  lastEventBucketIndex: number | null
  recentSweep: {
    kind: 'bullish-sweep' | 'bearish-sweep'
    level: number
    levelY: number | null
    wickExtreme: number
    bucketIndex: number
    label: string
    summary: string
  } | null
  orderBlock: OrderBlockZone | null
  shortLabel: string
  tone: 'teal' | 'rose' | 'amber' | 'blue' | 'neutral'
  summary: string
}

export type SmartRsiZone = 'overbought' | 'oversold' | 'bullish' | 'bearish' | 'neutral'

export type SmartRsiEvaluation = {
  value: number
  priceRsi: number
  volumeRsi: number | null
  zone: SmartRsiZone
  label: string
  shortLabel: string
  tone: 'teal' | 'rose' | 'amber' | 'blue' | 'neutral'
  flowConfirmed: boolean
  summary: string
}

export type StoryPhaseId =
  | 'waiting'
  | 'buyers-advancing'
  | 'sellers-pressing'
  | 'bearish-divergence'
  | 'bullish-divergence'
  | 'sell-absorption'
  | 'buy-absorption'
  | 'buyers-pushing'
  | 'sellers-pushing'
  | 'balanced'

export type RawStoryBucketInput = {
  start: number
  end: number
  priceOpen: number | null
  priceClose: number | null
  priceHigh?: number | null
  priceLow?: number | null
  deltaBtc: number | null
  cvdBtc: number | null
  volumeBtc: number | null
  oiChangeBtc: number | null
  oiEndBtc?: number | null
  longLiqUsd: number
  shortLiqUsd: number
  isDeveloping?: boolean
}

export type StoryBucketPoint = {
  index: number
  start: number
  end: number
  priceOpen: number | null
  priceClose: number | null
  priceHigh: number | null
  priceLow: number | null
  pricePct: number | null
  /** Normalized 0..100 vertical coordinate for the SVG price path. */
  priceY: number | null
  deltaBtc: number | null
  cvdBtc: number | null
  volumeBtc: number | null
  /** Normalized 0..100 bar magnitude for the pressure ribbon. */
  pressureHeightPct: number
  pressureDirection: 'buy' | 'sell' | 'flat' | 'missing'
  oiChangeBtc: number | null
  oiEndBtc: number | null
  oiState: StoryOiState
  longLiqUsd: number
  shortLiqUsd: number
  totalLiqUsd: number
  isLargeLiq: boolean
  divergence: StoryDivergenceKind
  absorption: StoryAbsorptionKind
  rsi: number | null
  rsiZone: StoryRsiZone
  structureBreak: StoryStructureEvent
  structureLevel: number | null
  liquiditySweep: StoryLiquiditySweep
  phaseId: StoryPhaseId
  phaseLabel: string
  phaseTone: 'teal' | 'rose' | 'amber' | 'blue' | 'neutral'
  summary: string
  isDeveloping: boolean
}

export type StoryChapter = {
  id: string
  phaseId: StoryPhaseId
  label: string
  tone: StoryBucketPoint['phaseTone']
  startBucket: number
  endBucket: number
  startTime: number
  endTime: number
  count: number
  isCurrent: boolean
  isDeveloping: boolean
}

export type WindowDivergenceAlert = {
  kind: 'bullish' | 'bearish'
  label: string
  headline: string
  explanation: string
  evidence: string
}

export type MarketStoryEvaluation = {
  buckets: StoryBucketPoint[]
  chapters: StoryChapter[]
  headline: string
  subheadline: string
  tone: StoryBucketPoint['phaseTone']
  vwap: number | null
  vwapY: number | null
  priceMin: number | null
  priceMax: number | null
  windowDivergence: WindowDivergenceAlert | null
  smartRsi: SmartRsiEvaluation | null
  structure: MarketStructureEvaluation
  hasLiveData: boolean
}

const PRICE_MOVE_PCT_THRESHOLD = 0.025
const DIVERGENCE_PRICE_PCT_THRESHOLD = 0.03
const WINDOW_DIVERGENCE_PCT_THRESHOLD = 0.05
const ABSORPTION_FLAT_PCT_THRESHOLD = 0.02
const ABSORPTION_IMBALANCE_RATIO = 0.25
const STRUCTURE_BREAK_PCT_THRESHOLD = 0.015

function formatUsdLevel(val: number): string {
  return `$${val.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

function formatSignedBtcCompact(val: number): string {
  const sign = val > 0 ? '+' : val < 0 ? '-' : ''
  const abs = Math.abs(val)
  if (abs === 0) return '0.00 ₿'
  if (abs >= 10) return `${sign}${abs.toFixed(1)} ₿`
  return `${sign}${abs.toFixed(2)} ₿`
}

function formatPct(val: number): string {
  return `${val >= 0 ? '+' : ''}${val.toFixed(2)}%`
}

function classifyBucket(
  input: RawStoryBucketInput,
  prevPriceClose: number | null,
  prevCvdBtc: number | null,
  maxAbsDelta: number,
): Omit<
  StoryBucketPoint,
  'index' | 'priceY' | 'rsi' | 'rsiZone' | 'structureBreak' | 'structureLevel' | 'liquiditySweep'
> {
  const {
    start,
    end,
    priceOpen,
    priceClose,
    priceHigh = null,
    priceLow = null,
    deltaBtc,
    cvdBtc,
    volumeBtc,
    oiChangeBtc,
    oiEndBtc = null,
    longLiqUsd,
    shortLiqUsd,
    isDeveloping = false,
  } = input

  const refOpen = priceOpen ?? prevPriceClose
  const effectiveHigh =
    priceHigh !== null && Number.isFinite(priceHigh)
      ? priceHigh
      : refOpen !== null && priceClose !== null
        ? Math.max(refOpen, priceClose)
        : priceClose
  const effectiveLow =
    priceLow !== null && Number.isFinite(priceLow)
      ? priceLow
      : refOpen !== null && priceClose !== null
        ? Math.min(refOpen, priceClose)
        : priceClose
  const pricePct =
    refOpen !== null && priceClose !== null && refOpen > 0
      ? ((priceClose - refOpen) / refOpen) * 100
      : null

  const cvdStep =
    cvdBtc !== null && prevCvdBtc !== null
      ? cvdBtc - prevCvdBtc
      : deltaBtc

  const effectiveFlow = deltaBtc ?? cvdStep

  const pressureDirection: StoryBucketPoint['pressureDirection'] =
    deltaBtc === null
      ? 'missing'
      : Math.abs(deltaBtc) < 1e-6
        ? 'flat'
        : deltaBtc > 0
          ? 'buy'
          : 'sell'

  const pressureHeightPct =
    deltaBtc === null || maxAbsDelta <= 0
      ? 0
      : Math.abs(deltaBtc) < 1e-6
        ? 8
        : Math.round(16 + (Math.abs(deltaBtc) / maxAbsDelta) * 80)

  let oiState: StoryOiState = 'missing'
  if (oiChangeBtc !== null) {
    const threshold = oiEndBtc !== null && oiEndBtc > 0 ? oiEndBtc * 0.0001 : 0.5
    if (oiChangeBtc > threshold) oiState = 'opening'
    else if (oiChangeBtc < -threshold) oiState = 'closing'
    else oiState = 'steady'
  }

  const totalLiqUsd = longLiqUsd + shortLiqUsd
  const isLargeLiq = totalLiqUsd >= LIQUIDATION_LARGE_USD

  let divergence: StoryDivergenceKind = null
  let absorption: StoryAbsorptionKind = null
  let phaseId: StoryPhaseId = 'waiting'
  let phaseLabel = 'Waiting for data'
  let phaseTone: StoryBucketPoint['phaseTone'] = 'neutral'
  let summary = 'Waiting for price and trade flow in this bucket.'

  if (priceClose !== null && effectiveFlow !== null) {
    const imbalance =
      volumeBtc !== null && volumeBtc > 0 ? effectiveFlow / volumeBtc : effectiveFlow !== 0 ? Math.sign(effectiveFlow) * 0.3 : 0

    const isHollowRise =
      pricePct !== null &&
      pricePct >= DIVERGENCE_PRICE_PCT_THRESHOLD &&
      effectiveFlow < -0.05 &&
      imbalance <= -0.1
    const isHollowDrop =
      pricePct !== null &&
      pricePct <= -DIVERGENCE_PRICE_PCT_THRESHOLD &&
      effectiveFlow > 0.05 &&
      imbalance >= 0.1

    const isAbsorption =
      pricePct !== null &&
      Math.abs(pricePct) <= ABSORPTION_FLAT_PCT_THRESHOLD &&
      Math.abs(effectiveFlow) >= 0.1 &&
      Math.abs(imbalance) >= ABSORPTION_IMBALANCE_RATIO

    if (isHollowRise) {
      divergence = 'bearish'
      phaseId = 'bearish-divergence'
      phaseLabel = 'Hollow rise · Divergence'
      phaseTone = 'amber'
      summary = `Price rose (${formatPct(pricePct)}), but net market orders were negative (${formatSignedBtcCompact(effectiveFlow)}). Price is advancing without aggressive buyer support.`
    } else if (isHollowDrop) {
      divergence = 'bullish'
      phaseId = 'bullish-divergence'
      phaseLabel = 'Hollow drop · Divergence'
      phaseTone = 'amber'
      summary = `Price fell (${formatPct(pricePct)}), but net market orders were positive (${formatSignedBtcCompact(effectiveFlow)}). Aggressive buyers are stepping into the dip.`
    } else if (isAbsorption) {
      if (effectiveFlow > 0) {
        absorption = 'sell-wall'
        phaseId = 'sell-absorption'
        phaseLabel = 'Progress stalls · Possible absorption'
        phaseTone = 'amber'
        summary = `Buyers pushed (${formatSignedBtcCompact(effectiveFlow)}), but price held flat (${formatPct(pricePct)}). Passive limit sellers may be absorbing the buying pressure.`
      } else {
        absorption = 'buy-wall'
        phaseId = 'buy-absorption'
        phaseLabel = 'Drop stalls · Possible absorption'
        phaseTone = 'blue'
        summary = `Sellers pushed (${formatSignedBtcCompact(effectiveFlow)}), but price held flat (${formatPct(pricePct)}). Passive limit buyers may be absorbing the selling pressure.`
      }
    } else if (pricePct !== null && pricePct > PRICE_MOVE_PCT_THRESHOLD && effectiveFlow > 0) {
      phaseId = 'buyers-advancing'
      phaseLabel = 'Buyers advancing'
      phaseTone = 'teal'
      summary = `Buyers pushed (${formatSignedBtcCompact(effectiveFlow)}) and price responded higher (${formatPct(pricePct)}).`
    } else if (pricePct !== null && pricePct < -PRICE_MOVE_PCT_THRESHOLD && effectiveFlow < 0) {
      phaseId = 'sellers-pressing'
      phaseLabel = 'Sellers pressing'
      phaseTone = 'rose'
      summary = `Sellers pressed (${formatSignedBtcCompact(effectiveFlow)}) and price moved lower (${formatPct(pricePct)}).`
    } else if (effectiveFlow > 0.05) {
      phaseId = 'buyers-pushing'
      phaseLabel = 'Buying builds'
      phaseTone = 'teal'
      summary = `Net market buying (${formatSignedBtcCompact(effectiveFlow)}) with modest price movement${pricePct !== null ? ` (${formatPct(pricePct)})` : ''}.`
    } else if (effectiveFlow < -0.05) {
      phaseId = 'sellers-pushing'
      phaseLabel = 'Selling builds'
      phaseTone = 'rose'
      summary = `Net market selling (${formatSignedBtcCompact(effectiveFlow)}) with modest price movement${pricePct !== null ? ` (${formatPct(pricePct)})` : ''}.`
    } else {
      phaseId = 'balanced'
      phaseLabel = 'Balanced'
      phaseTone = 'neutral'
      summary = `Two-sided market flow (${formatSignedBtcCompact(effectiveFlow)}) with price steady.`
    }
  } else if (priceClose !== null) {
    phaseId = 'balanced'
    phaseLabel = 'Price only · Awaiting flow'
    phaseTone = 'neutral'
    summary = `Price closed at ${priceClose.toLocaleString('en-US', { maximumFractionDigits: 0 })} USDT. Trade delta coverage is not available for this bucket.`
  }

  return {
    start,
    end,
    priceOpen: refOpen,
    priceClose,
    priceHigh: effectiveHigh,
    priceLow: effectiveLow,
    pricePct,
    deltaBtc,
    cvdBtc,
    volumeBtc,
    pressureHeightPct,
    pressureDirection,
    oiChangeBtc,
    oiEndBtc,
    oiState,
    longLiqUsd,
    shortLiqUsd,
    totalLiqUsd,
    isLargeLiq,
    divergence,
    absorption,
    phaseId,
    phaseLabel,
    phaseTone,
    summary,
    isDeveloping,
  }
}

function calcVolumeWeightedRsi(
  points: readonly { close: number; volume: number | null }[],
  period = 14,
): number | null {
  if (points.length < 4) return null
  const window = points.slice(-(period + 1))
  let posFlow = 0
  let negFlow = 0
  let hasVol = false
  for (let i = 1; i < window.length; i++) {
    const vol = window[i].volume
    if (vol === null || !(vol > 0)) continue
    hasVol = true
    const diff = window[i].close - window[i - 1].close
    if (diff > 0) posFlow += diff * vol
    else if (diff < 0) negFlow += -diff * vol
  }
  if (!hasVol || (posFlow === 0 && negFlow === 0)) return null
  if (negFlow === 0) return 100
  return Number((100 - 100 / (1 + posFlow / negFlow)).toFixed(1))
}

function buildSmartRsiEvaluation(
  priceRsi: number,
  volumeRsi: number | null,
  latestDeltaBtc: number | null,
): SmartRsiEvaluation {
  const value = volumeRsi !== null ? Number((priceRsi * 0.7 + volumeRsi * 0.3).toFixed(1)) : priceRsi

  if (value >= 70) {
    const flowStalling = latestDeltaBtc !== null && latestDeltaBtc <= 0
    if (flowStalling) {
      return {
        value,
        priceRsi,
        volumeRsi,
        zone: 'overbought',
        label: 'Overbought · Flow Stalling',
        shortLabel: 'Overbought (Exhausting)',
        tone: 'rose',
        flowConfirmed: false,
        summary: `Smart RSI is ${value.toFixed(0)} (≥ 70 overbought) while net taker buying has stalled — upward momentum may be exhausting.`,
      }
    }
    return {
      value,
      priceRsi,
      volumeRsi,
      zone: 'overbought',
      label: 'Overbought · Strong Drive',
      shortLabel: 'Overbought (Hot)',
      tone: 'amber',
      flowConfirmed: true,
      summary: `Smart RSI is ${value.toFixed(0)} (≥ 70 overbought) with taker buyers still pressing — strong momentum, though late entries are stretched.`,
    }
  }

  if (value <= 30) {
    const buyersAbsorbing = latestDeltaBtc !== null && latestDeltaBtc >= 0
    if (buyersAbsorbing) {
      return {
        value,
        priceRsi,
        volumeRsi,
        zone: 'oversold',
        label: 'Oversold · Buyers Stepping In',
        shortLabel: 'Oversold (Absorbing)',
        tone: 'teal',
        flowConfirmed: false,
        summary: `Smart RSI is ${value.toFixed(0)} (≤ 30 oversold) while taker buyers step in — selling pressure looks exhausted.`,
      }
    }
    return {
      value,
      priceRsi,
      volumeRsi,
      zone: 'oversold',
      label: 'Oversold · Heavy Selling',
      shortLabel: 'Oversold (Pressing)',
      tone: 'amber',
      flowConfirmed: true,
      summary: `Smart RSI is ${value.toFixed(0)} (≤ 30 oversold) with sellers still aggressive — stretched, but downward pressure has not eased yet.`,
    }
  }

  if (value >= 58) {
    return {
      value,
      priceRsi,
      volumeRsi,
      zone: 'bullish',
      label: 'Bullish Momentum',
      shortLabel: 'Bullish',
      tone: 'teal',
      flowConfirmed: latestDeltaBtc === null || latestDeltaBtc >= 0,
      summary: `Smart RSI is ${value.toFixed(0)} — positive upward momentum with room before reaching the 70 overbought zone.`,
    }
  }

  if (value <= 42) {
    return {
      value,
      priceRsi,
      volumeRsi,
      zone: 'bearish',
      label: 'Bearish Momentum',
      shortLabel: 'Bearish',
      tone: 'rose',
      flowConfirmed: latestDeltaBtc === null || latestDeltaBtc <= 0,
      summary: `Smart RSI is ${value.toFixed(0)} — downward momentum with room before reaching the 30 oversold zone.`,
    }
  }

  return {
    value,
    priceRsi,
    volumeRsi,
    zone: 'neutral',
    label: 'Balanced Momentum',
    shortLabel: 'Neutral',
    tone: 'neutral',
    flowConfirmed: true,
    summary: `Smart RSI is ${value.toFixed(0)} — balanced near the midpoint, neither overbought nor oversold.`,
  }
}

export function evaluateMarketStory(input: {
  buckets: readonly RawStoryBucketInput[]
  priorCloses?: readonly number[]
  vwap?: number | null
  timeframeLabel: string
}): MarketStoryEvaluation {
  const { buckets: rawBuckets, priorCloses = [], vwap = null, timeframeLabel } = input

  const maxAbsDelta = rawBuckets.reduce((max, b) => {
    const abs = b.deltaBtc !== null ? Math.abs(b.deltaBtc) : 0
    return abs > max ? abs : max
  }, 0)

  const classified: Omit<
    StoryBucketPoint,
    'index' | 'priceY' | 'rsi' | 'rsiZone' | 'structureBreak' | 'structureLevel' | 'liquiditySweep'
  >[] = []
  for (let i = 0; i < rawBuckets.length; i++) {
    const prevClose =
      i > 0
        ? classified[i - 1].priceClose
        : priorCloses.length > 0
          ? priorCloses[priorCloses.length - 1]
          : null
    const prevCvd = i > 0 ? classified[i - 1].cvdBtc : null
    classified.push(classifyBucket(rawBuckets[i], prevClose, prevCvd, maxAbsDelta))
  }

  const validPrices: number[] = []
  for (const b of classified) {
    if (b.priceClose !== null && Number.isFinite(b.priceClose)) validPrices.push(b.priceClose)
    if (b.priceHigh !== null && Number.isFinite(b.priceHigh)) validPrices.push(b.priceHigh)
    if (b.priceLow !== null && Number.isFinite(b.priceLow)) validPrices.push(b.priceLow)
  }

  const allScalePrices =
    vwap !== null && Number.isFinite(vwap) && validPrices.length > 0
      ? [...validPrices, vwap]
      : validPrices

  const priceMin = allScalePrices.length > 0 ? Math.min(...allScalePrices) : null
  const priceMax = allScalePrices.length > 0 ? Math.max(...allScalePrices) : null

  const mapPriceToY = (p: number | null): number | null => {
    if (p === null || priceMin === null || priceMax === null) return null
    const span = priceMax - priceMin
    if (span < 1e-6) return 50
    // SVG y: 14 is top padding, 86 is bottom padding
    const clamped = Math.min(Math.max(p, priceMin), priceMax)
    return Number((86 - ((clamped - priceMin) / span) * 72).toFixed(2))
  }

  const seedPoints: { close: number; volume: number | null }[] = priorCloses
    .filter(c => Number.isFinite(c) && c > 0)
    .map(c => ({ close: c, volume: null }))
  const runningPoints: { close: number; volume: number | null }[] = [...seedPoints]
  let latestPriceRsi: number | null = null
  let latestVolumeRsi: number | null = null
  let latestRsiDelta: number | null = null

  // LuxAlgo-style Market Structure & Liquidity Sweep tracking
  const priorBarRanges: { high: number; low: number; close: number }[] = priorCloses
    .filter(c => Number.isFinite(c) && c > 0)
    .slice(-6)
    .map(c => ({ high: c, low: c, close: c }))

  let structureBias: 'bullish' | 'bearish' | 'neutral' = 'neutral'
  if (priorBarRanges.length >= 2) {
    const firstPrior = priorBarRanges[0].close
    const lastPrior = priorBarRanges[priorBarRanges.length - 1].close
    const priorDiffPct = ((lastPrior - firstPrior) / firstPrior) * 100
    if (priorDiffPct >= STRUCTURE_BREAK_PCT_THRESHOLD) structureBias = 'bullish'
    else if (priorDiffPct <= -STRUCTURE_BREAK_PCT_THRESHOLD) structureBias = 'bearish'
  }

  let lastStructureEvent = null as StoryStructureEvent
  let lastStructureLevel = null as number | null
  let lastStructureBucketIdx = null as number | null
  let recentSweep = null as MarketStructureEvaluation['recentSweep']

  const buckets: StoryBucketPoint[] = classified.map((b, index) => {
    let rsi: number | null = null
    let rsiZone: StoryRsiZone = 'neutral'
    let structureBreak: StoryStructureEvent = null
    let structureLevel: number | null = null
    let liquiditySweep: StoryLiquiditySweep = null

    if (b.priceClose !== null && Number.isFinite(b.priceClose) && b.priceClose > 0) {
      runningPoints.push({ close: b.priceClose, volume: b.volumeBtc })
      const pRsi = calcRsi(runningPoints.map(p => p.close), 14)
      const vRsi = calcVolumeWeightedRsi(runningPoints, 14)
      if (pRsi !== null) {
        rsi = vRsi !== null ? Number((pRsi * 0.7 + vRsi * 0.3).toFixed(1)) : pRsi
        rsiZone = rsi >= 70 ? 'overbought' : rsi <= 30 ? 'oversold' : 'neutral'
        latestPriceRsi = pRsi
        latestVolumeRsi = vRsi
        latestRsiDelta = b.deltaBtc
      }

      const high = b.priceHigh ?? b.priceClose
      const low = b.priceLow ?? b.priceClose
      const lookbackBars = priorBarRanges.slice(-6)

      // Only confirm structure breaks (BOS/CHoCH) and liquidity sweeps on closed buckets
      if (!b.isDeveloping && lookbackBars.length >= 2) {
        if (structureBias === 'neutral') {
          const firstLookback = lookbackBars[0]
          const lastLookback = lookbackBars[lookbackBars.length - 1]
          const startRef = firstLookback.high > firstLookback.low ? (firstLookback.high + firstLookback.low) / 2 : firstLookback.close
          const movePct = startRef > 0 ? ((lastLookback.close - startRef) / startRef) * 100 : 0
          if (movePct >= STRUCTURE_BREAK_PCT_THRESHOLD) structureBias = 'bullish'
          else if (movePct <= -STRUCTURE_BREAK_PCT_THRESHOLD) structureBias = 'bearish'
        }

        const refHigh = Math.max(...lookbackBars.map(r => r.high))
        const refLow = Math.min(...lookbackBars.map(r => r.low))
        const breakUpThreshold = refHigh * (1 + STRUCTURE_BREAK_PCT_THRESHOLD / 100)
        const breakDownThreshold = refLow * (1 - STRUCTURE_BREAK_PCT_THRESHOLD / 100)

        // 1. Check Liquidity Sweep (wick beyond prior swing high/low, but closed back inside)
        if (high >= breakUpThreshold && b.priceClose <= refHigh) {
          liquiditySweep = 'bearish-sweep'
          structureLevel = refHigh
          recentSweep = {
            kind: 'bearish-sweep',
            level: refHigh,
            levelY: mapPriceToY(refHigh),
            wickExtreme: high,
            bucketIndex: index,
            label: `Sweep High · ${formatUsdLevel(refHigh)}`,
            summary: `Confirmed buy-side liquidity sweep above ${formatUsdLevel(refHigh)} (wicked to ${formatUsdLevel(high)} then closed back at ${formatUsdLevel(b.priceClose)}). Breakout buyers were trapped.`,
          }
        } else if (low <= breakDownThreshold && b.priceClose >= refLow) {
          liquiditySweep = 'bullish-sweep'
          structureLevel = refLow
          recentSweep = {
            kind: 'bullish-sweep',
            level: refLow,
            levelY: mapPriceToY(refLow),
            wickExtreme: low,
            bucketIndex: index,
            label: `Sweep Low · ${formatUsdLevel(refLow)}`,
            summary: `Confirmed sell-side liquidity sweep below ${formatUsdLevel(refLow)} (wicked to ${formatUsdLevel(low)} then closed back at ${formatUsdLevel(b.priceClose)}). Late sellers/stops were flushed.`,
          }
        }

        // 2. Check Market Structure Break (confirmed candle close beyond prior swing high/low)
        if (b.priceClose >= breakUpThreshold) {
          structureBreak = structureBias === 'bearish' ? 'bullish-choch' : 'bullish-bos'
          structureLevel = refHigh
          structureBias = 'bullish'
          lastStructureEvent = structureBreak
          lastStructureLevel = refHigh
          lastStructureBucketIdx = index
        } else if (b.priceClose <= breakDownThreshold) {
          structureBreak = structureBias === 'bullish' ? 'bearish-choch' : 'bearish-bos'
          structureLevel = refLow
          structureBias = 'bearish'
          lastStructureEvent = structureBreak
          lastStructureLevel = refLow
          lastStructureBucketIdx = index
        }
      }

      if (!b.isDeveloping) {
        priorBarRanges.push({ high, low, close: b.priceClose })
      }
    }

    return {
      ...b,
      index,
      priceY: mapPriceToY(b.priceClose),
      rsi,
      rsiZone,
      structureBreak,
      structureLevel,
      liquiditySweep,
    }
  })

  // 3. Identify active (unmitigated) Volumetric Order Block zone from closed buckets
  const closedWithPrice = buckets.filter(b => !b.isDeveloping && b.priceClose !== null)
  const latestClosedPrice =
    closedWithPrice.length > 0 ? closedWithPrice[closedWithPrice.length - 1].priceClose : null
  let orderBlock: OrderBlockZone | null = null
  if (latestClosedPrice !== null && priceMin !== null && priceMax !== null) {
    const minZoneSpan = Math.max((priceMax - priceMin) * 0.08, latestClosedPrice * 0.0004)
    for (let i = buckets.length - 1; i >= 0; i--) {
      const b = buckets[i]
      if (b.isDeveloping || b.priceClose === null) continue
      const bHigh = b.priceHigh ?? Math.max(b.priceOpen ?? b.priceClose, b.priceClose)
      const bLow = b.priceLow ?? Math.min(b.priceOpen ?? b.priceClose, b.priceClose)

      const isBullishObCandidate =
        b.absorption === 'buy-wall' ||
        b.liquiditySweep === 'bullish-sweep' ||
        (i < buckets.length - 1 &&
          (buckets[i + 1].structureBreak === 'bullish-bos' || buckets[i + 1].structureBreak === 'bullish-choch'))
      const isBearishObCandidate =
        b.absorption === 'sell-wall' ||
        b.liquiditySweep === 'bearish-sweep' ||
        (i < buckets.length - 1 &&
          (buckets[i + 1].structureBreak === 'bearish-bos' || buckets[i + 1].structureBreak === 'bearish-choch'))

      if (isBullishObCandidate && latestClosedPrice >= bLow) {
        const bottom = bLow
        const top = Math.max(bHigh, bLow + minZoneSpan)
        orderBlock = {
          kind: 'bullish',
          top,
          bottom,
          topY: mapPriceToY(top) ?? 70,
          bottomY: mapPriceToY(bottom) ?? 82,
          bucketIndex: i,
          volumeBtc: b.volumeBtc,
          deltaBtc: b.deltaBtc,
          label: `Bullish OB ${formatUsdLevel(bottom)}–${formatUsdLevel(top)}`,
        }
        break
      }
      if (isBearishObCandidate && latestClosedPrice <= bHigh) {
        const top = bHigh
        const bottom = Math.min(bLow, bHigh - minZoneSpan)
        orderBlock = {
          kind: 'bearish',
          top,
          bottom,
          topY: mapPriceToY(top) ?? 18,
          bottomY: mapPriceToY(bottom) ?? 30,
          bucketIndex: i,
          volumeBtc: b.volumeBtc,
          deltaBtc: b.deltaBtc,
          label: `Bearish OB ${formatUsdLevel(bottom)}–${formatUsdLevel(top)}`,
        }
        break
      }
    }
  }

  const eventLabelMap: Record<NonNullable<StoryStructureEvent>, string> = {
    'bullish-bos': 'Bullish BOS',
    'bearish-bos': 'Bearish BOS',
    'bullish-choch': 'Bullish CHoCH',
    'bearish-choch': 'Bearish CHoCH',
  }
  const lastEventLabel = lastStructureEvent ? eventLabelMap[lastStructureEvent] : null

  const structure: MarketStructureEvaluation = (() => {
    if (recentSweep && (lastStructureBucketIdx === null || recentSweep.bucketIndex >= lastStructureBucketIdx)) {
      return {
        bias: structureBias,
        lastEvent: lastStructureEvent,
        lastEventLabel,
        lastEventLevel: lastStructureLevel,
        lastEventLevelY: mapPriceToY(lastStructureLevel),
        lastEventBucketIndex: lastStructureBucketIdx,
        recentSweep,
        orderBlock,
        shortLabel: recentSweep.kind === 'bullish-sweep' ? '⚡ Bullish Sweep' : '⚡ Bearish Sweep',
        tone: recentSweep.kind === 'bullish-sweep' ? 'teal' : 'rose',
        summary: recentSweep.summary,
      }
    }
    if (lastStructureEvent && lastStructureLevel !== null) {
      const isBull = lastStructureEvent === 'bullish-bos' || lastStructureEvent === 'bullish-choch'
      const isChoch = lastStructureEvent === 'bullish-choch' || lastStructureEvent === 'bearish-choch'
      return {
        bias: structureBias,
        lastEvent: lastStructureEvent,
        lastEventLabel,
        lastEventLevel: lastStructureLevel,
        lastEventLevelY: mapPriceToY(lastStructureLevel),
        lastEventBucketIndex: lastStructureBucketIdx,
        recentSweep,
        orderBlock,
        shortLabel: lastEventLabel!,
        tone: isChoch ? 'amber' : isBull ? 'teal' : 'rose',
        summary: isChoch
          ? `${lastEventLabel} at ${formatUsdLevel(lastStructureLevel)} — price broke counter-trend swing structure, signaling a potential character shift.`
          : `${lastEventLabel} at ${formatUsdLevel(lastStructureLevel)} — price closed beyond the prior swing ${isBull ? 'high' : 'low'}, confirming trend continuation.`,
      }
    }
    if (orderBlock) {
      return {
        bias: structureBias,
        lastEvent: null,
        lastEventLabel: null,
        lastEventLevel: null,
        lastEventLevelY: null,
        lastEventBucketIndex: null,
        recentSweep,
        orderBlock,
        shortLabel: orderBlock.kind === 'bullish' ? 'Bullish OB Support' : 'Bearish OB Supply',
        tone: orderBlock.kind === 'bullish' ? 'teal' : 'rose',
        summary: `${orderBlock.label} active — volumetric absorption zone acting as nearby ${orderBlock.kind === 'bullish' ? 'demand support' : 'supply resistance'}.`,
      }
    }
    return {
      bias: structureBias,
      lastEvent: null,
      lastEventLabel: null,
      lastEventLevel: null,
      lastEventLevelY: null,
      lastEventBucketIndex: null,
      recentSweep: null,
      orderBlock: null,
      shortLabel: validPrices.length > 0 ? 'In Range' : 'Warming',
      tone: 'neutral',
      summary:
        validPrices.length > 0
          ? 'Price is trading inside its recent swing range with no structural break or liquidity sweep.'
          : 'Waiting for price buckets to map swing structure, liquidity sweeps, and order blocks.',
    }
  })()

  const smartRsi =
    latestPriceRsi !== null
      ? buildSmartRsiEvaluation(latestPriceRsi, latestVolumeRsi, latestRsiDelta)
      : null

  // Build collapsed chapter sequence from non-waiting buckets
  const chapters: StoryChapter[] = []
  for (const b of buckets) {
    if (b.phaseId === 'waiting') continue
    const last = chapters[chapters.length - 1]
    if (last && last.phaseId === b.phaseId) {
      last.endBucket = b.index
      last.endTime = b.end
      last.count += 1
      last.isDeveloping = b.isDeveloping
    } else {
      chapters.push({
        id: `${b.phaseId}-${b.index}`,
        phaseId: b.phaseId,
        label: b.phaseLabel,
        tone: b.phaseTone,
        startBucket: b.index,
        endBucket: b.index,
        startTime: b.start,
        endTime: b.end,
        count: 1,
        isCurrent: false,
        isDeveloping: b.isDeveloping,
      })
    }
  }
  if (chapters.length > 0) {
    chapters[chapters.length - 1].isCurrent = true
  }

  // Evaluate overall window divergence across active buckets with price & CVD/delta
  const activeWithFlow = buckets.filter(b => b.priceClose !== null && b.deltaBtc !== null)
  let windowDivergence: WindowDivergenceAlert | null = null

  if (activeWithFlow.length >= 2) {
    const first = activeWithFlow[0]
    const last = activeWithFlow[activeWithFlow.length - 1]
    const startPx = first.priceOpen ?? first.priceClose!
    const endPx = last.priceClose!
    const windowPricePct = startPx > 0 ? ((endPx - startPx) / startPx) * 100 : 0
    const netDeltaBtc = activeWithFlow.reduce((sum, b) => sum + (b.deltaBtc ?? 0), 0)

    if (windowPricePct >= WINDOW_DIVERGENCE_PCT_THRESHOLD && netDeltaBtc < -0.1) {
      windowDivergence = {
        kind: 'bearish',
        label: 'Bearish Divergence · Hollow Rise',
        headline: 'Price is up across this window, but net market orders are negative.',
        explanation:
          'Price rose while taker sellers outpaced taker buyers. Moves higher without net market buying behind them can be fragile if passive bids step away.',
        evidence: `Window price ${formatPct(windowPricePct)} vs net flow ${formatSignedBtcCompact(netDeltaBtc)} (${timeframeLabel})`,
      }
    } else if (windowPricePct <= -WINDOW_DIVERGENCE_PCT_THRESHOLD && netDeltaBtc > 0.1) {
      windowDivergence = {
        kind: 'bullish',
        label: 'Bullish Divergence · Hollow Drop',
        headline: 'Price is down across this window, but net market orders are positive.',
        explanation:
          'Price drifted lower while taker buyers stepped in with positive net market orders. Selling pressure may be losing steam as buyers absorb the drop.',
        evidence: `Window price ${formatPct(windowPricePct)} vs net flow ${formatSignedBtcCompact(netDeltaBtc)} (${timeframeLabel})`,
      }
    }
  }

  // If no multi-bucket window divergence, check if the latest active bucket itself is a divergence
  const latestActive = [...buckets].reverse().find(b => b.phaseId !== 'waiting')
  if (!windowDivergence && latestActive && latestActive.divergence !== null && latestActive.pricePct !== null && latestActive.deltaBtc !== null) {
    windowDivergence =
      latestActive.divergence === 'bearish'
        ? {
            kind: 'bearish',
            label: 'Bearish Divergence · Latest Bucket',
            headline: 'Price ticked higher while sellers led market orders in the latest bucket.',
            explanation: latestActive.summary,
            evidence: `Latest bucket price ${formatPct(latestActive.pricePct)} · Delta ${formatSignedBtcCompact(latestActive.deltaBtc)}`,
          }
        : {
            kind: 'bullish',
            label: 'Bullish Divergence · Latest Bucket',
            headline: 'Price dipped while buyers led market orders in the latest bucket.',
            explanation: latestActive.summary,
            evidence: `Latest bucket price ${formatPct(latestActive.pricePct)} · Delta ${formatSignedBtcCompact(latestActive.deltaBtc)}`,
          }
  }

  let headline = 'Waiting for live market story'
  let subheadline = 'Listening for OKX trades, open interest, and liquidations to map price against order flow.'
  let tone: StoryBucketPoint['phaseTone'] = 'neutral'

  if (latestActive) {
    tone = windowDivergence ? 'amber' : latestActive.phaseTone
    const oiPhrase =
      latestActive.oiState === 'opening'
        ? ' while open interest expands (positions opening)'
        : latestActive.oiState === 'closing'
          ? ' while open interest contracts (positions closing)'
          : ''

    if (windowDivergence) {
      headline =
        windowDivergence.kind === 'bearish'
          ? 'Price rising against net selling — bearish divergence'
          : 'Price dipping into net buying — bullish divergence'
      subheadline = `${windowDivergence.headline} ${windowDivergence.evidence}.`
    } else if (latestActive.phaseId === 'sell-absorption') {
      headline = 'Buyers pushing — price starting to stall'
      subheadline = `${latestActive.summary}${oiPhrase}.`
    } else if (latestActive.phaseId === 'buy-absorption') {
      headline = 'Sellers pressing — price holding firm'
      subheadline = `${latestActive.summary}${oiPhrase}.`
    } else if (latestActive.phaseId === 'buyers-advancing') {
      headline = `Buyers advancing — price responding higher${oiPhrase}`
      subheadline = latestActive.summary
    } else if (latestActive.phaseId === 'sellers-pressing') {
      headline = `Sellers in control — price pressing lower${oiPhrase}`
      subheadline = latestActive.summary
    } else if (latestActive.phaseId === 'buyers-pushing') {
      headline = `Buying pressure building${oiPhrase}`
      subheadline = latestActive.summary
    } else if (latestActive.phaseId === 'sellers-pushing') {
      headline = `Selling pressure building${oiPhrase}`
      subheadline = latestActive.summary
    } else {
      headline = 'Balanced order flow — neither side forcing a move'
      subheadline = latestActive.summary
    }
  }

  return {
    buckets,
    chapters: chapters.slice(-4),
    headline,
    subheadline,
    tone,
    vwap,
    vwapY: mapPriceToY(vwap),
    priceMin,
    priceMax,
    windowDivergence,
    smartRsi,
    structure,
    hasLiveData: validPrices.length > 0,
  }
}
