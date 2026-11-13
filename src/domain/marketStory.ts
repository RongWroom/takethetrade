import { LIQUIDATION_LARGE_USD } from './marketRules'

export type StoryDivergenceKind = 'bullish' | 'bearish' | null
export type StoryAbsorptionKind = 'buy-wall' | 'sell-wall' | null
export type StoryOiState = 'opening' | 'closing' | 'steady' | 'missing'

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
  hasLiveData: boolean
}

const PRICE_MOVE_PCT_THRESHOLD = 0.025
const DIVERGENCE_PRICE_PCT_THRESHOLD = 0.03
const WINDOW_DIVERGENCE_PCT_THRESHOLD = 0.05
const ABSORPTION_FLAT_PCT_THRESHOLD = 0.02
const ABSORPTION_IMBALANCE_RATIO = 0.25

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
): Omit<StoryBucketPoint, 'index' | 'priceY'> {
  const {
    start,
    end,
    priceOpen,
    priceClose,
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

export function evaluateMarketStory(input: {
  buckets: readonly RawStoryBucketInput[]
  vwap?: number | null
  timeframeLabel: string
}): MarketStoryEvaluation {
  const { buckets: rawBuckets, vwap = null, timeframeLabel } = input

  const maxAbsDelta = rawBuckets.reduce((max, b) => {
    const abs = b.deltaBtc !== null ? Math.abs(b.deltaBtc) : 0
    return abs > max ? abs : max
  }, 0)

  const classified: Omit<StoryBucketPoint, 'index' | 'priceY'>[] = []
  for (let i = 0; i < rawBuckets.length; i++) {
    const prevClose = i > 0 ? classified[i - 1].priceClose : null
    const prevCvd = i > 0 ? classified[i - 1].cvdBtc : null
    classified.push(classifyBucket(rawBuckets[i], prevClose, prevCvd, maxAbsDelta))
  }

  const validPrices = classified
    .map(b => b.priceClose)
    .filter((p): p is number => p !== null && Number.isFinite(p))

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
    return Number((86 - ((p - priceMin) / span) * 72).toFixed(2))
  }

  const buckets: StoryBucketPoint[] = classified.map((b, index) => ({
    ...b,
    index,
    priceY: mapPriceToY(b.priceClose),
  }))

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
    hasLiveData: validPrices.length > 0,
  }
}
