import { btcToSatoshis, type Trade } from './tradeEngine'
import type { OkxCandlePoint, OkxTakerVolumeBucket } from '../data/okx'

export type FootprintStepOption = 'auto' | 5 | 10 | 25 | 50 | 100

export const FOOTPRINT_STEP_OPTIONS: readonly { value: FootprintStepOption; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 10, label: '$10' },
  { value: 25, label: '$25' },
  { value: 50, label: '$50' },
  { value: 100, label: '$100' },
]

export type FootprintTrade = Trade & { price: string }

export type FootprintRow = {
  price: number
  buyBtc: number
  sellBtc: number
  totalBtc: number
  deltaBtc: number
  buyWidthPct: number
  sellWidthPct: number
  isPoc: boolean
  inValueArea: boolean
  isCloseRow: boolean
  imbalance: 'buy' | 'sell' | null
}

type FootprintSource = 'trade-sample' | 'exchange-totals' | 'candle-estimate' | 'missing'

export type FootprintCandle = {
  source?: FootprintSource
  index: number
  start: number
  end: number
  isDeveloping: boolean
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  buyBtc: number
  sellBtc: number
  totalBtc: number
  deltaBtc: number
  deltaPct: number
  maxDeltaBtc: number
  minDeltaBtc: number
  tradeCount: number
  stepUsd: number
  pocPrice: number | null
  pocVolumeBtc: number
  vahPrice: number | null
  valPrice: number | null
  buyImbalanceCount: number
  sellImbalanceCount: number
  rows: FootprintRow[]
  badge: { label: string; tone: 'teal' | 'rose' | 'amber' | 'blue' }
  headline: string
  oneLiner: string
}

export type FootprintEvaluation = {
  candles: FootprintCandle[]
  stepUsd: number
}

const AUTO_STEPS = [5, 10, 25, 50, 100, 250, 500] as const
const SVP_AUTO_STEPS = [5, 10, 25, 50, 100, 250, 500, 1000] as const
const WIDEN_STEPS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000] as const
const IMBALANCE_MIN_BTC = 0.05
const IMBALANCE_RATIO = 3
const MAX_CANDLE_ROWS = 15
const MAX_SVP_ROWS = 22
const DAY_MS = 86_400_000
const CHART_SVP_BAR_COUNT = 24

function parseTradeSats(quantityBtc: string): bigint | null {
  try {
    return btcToSatoshis(quantityBtc)
  } catch {
    return null
  }
}

function chooseStepUsd(ranges: readonly number[], stepOption: FootprintStepOption): number {
  if (stepOption !== 'auto') return stepOption
  const maxRange = ranges.length > 0 ? Math.max(...ranges) : 0
  if (maxRange <= 0) return 10
  for (const step of AUTO_STEPS) {
    if (maxRange / step <= 10) return step
  }
  return AUTO_STEPS[AUTO_STEPS.length - 1]
}

function widenStepForRange(
  minPrice: number,
  maxPrice: number,
  baseStep: number,
  maxRows = MAX_CANDLE_ROWS,
): number {
  const candidates = WIDEN_STEPS.filter(s => s >= baseStep)
  for (const step of candidates) {
    const minIdx = Math.floor(minPrice / step)
    const maxIdx = Math.floor(maxPrice / step)
    if (maxIdx - minIdx + 1 <= maxRows) return step
  }
  return WIDEN_STEPS[WIDEN_STEPS.length - 1]
}

function chooseSvpStepUsd(range: number, stepOption: FootprintStepOption): number {
  if (stepOption !== 'auto') return stepOption
  if (range <= 0) return 10
  for (const step of SVP_AUTO_STEPS) {
    if (range / step <= 16) return step
  }
  return SVP_AUTO_STEPS[SVP_AUTO_STEPS.length - 1]
}

type RawFootprintCell = {
  price: number
  buyBtc: number
  sellBtc: number
  totalBtc: number
  deltaBtc: number
}

function findPocIndex(rawRows: readonly RawFootprintCell[], referenceClose: number): number {
  let pocIdx = 0
  for (let r = 1; r < rawRows.length; r++) {
    const curr = rawRows[r]
    const best = rawRows[pocIdx]
    if (curr.totalBtc > best.totalBtc + 1e-12) {
      pocIdx = r
    } else if (
      Math.abs(curr.totalBtc - best.totalBtc) <= 1e-12 &&
      Math.abs(curr.price - referenceClose) < Math.abs(best.price - referenceClose)
    ) {
      pocIdx = r
    }
  }
  return pocIdx
}

function computeValueArea(
  rawRows: readonly RawFootprintCell[],
  pocIdx: number,
  totalBtc: number,
): { vaIndices: Set<number>; vahPrice: number; valPrice: number } {
  const vaIndices = new Set<number>([pocIdx])
  let vaAccum = rawRows[pocIdx].totalBtc
  const vaTarget = totalBtc * 0.7
  let upIdx = pocIdx - 1
  let downIdx = pocIdx + 1

  while (vaAccum < vaTarget - 1e-12 && (upIdx >= 0 || downIdx < rawRows.length)) {
    const upVol = upIdx >= 0 ? rawRows[upIdx].totalBtc : -1
    const downVol = downIdx < rawRows.length ? rawRows[downIdx].totalBtc : -1
    if (upVol >= downVol) {
      vaIndices.add(upIdx)
      vaAccum += upVol
      upIdx--
    } else {
      vaIndices.add(downIdx)
      vaAccum += downVol
      downIdx++
    }
  }

  let vahPrice = rawRows[pocIdx].price
  let valPrice = rawRows[pocIdx].price
  for (const idx of vaIndices) {
    const p = rawRows[idx].price
    if (p > vahPrice) vahPrice = p
    if (p < valPrice) valPrice = p
  }

  return { vaIndices, vahPrice, valPrice }
}

function formatPriceInt(price: number | null): string {
  if (price === null || !Number.isFinite(price)) return '—'
  return `$${Math.round(price).toLocaleString('en-US')}`
}

function formatSignedBtc(btc: number): string {
  const sign = btc > 0 ? '+' : btc < 0 ? '-' : ''
  return `${sign}${Math.abs(btc).toFixed(2)}`
}

function buildCandleVerdict(params: {
  tradeCount: number
  close: number | null
  pocPrice: number | null
  deltaBtc: number
  deltaPct: number
  maxDeltaBtc: number
  minDeltaBtc: number
  buyImbalanceCount: number
  sellImbalanceCount: number
}): { badge: FootprintCandle['badge']; headline: string; oneLiner: string } {
  const {
    tradeCount,
    close,
    pocPrice,
    deltaBtc,
    deltaPct,
    maxDeltaBtc,
    minDeltaBtc,
    buyImbalanceCount,
    sellImbalanceCount,
  } = params

  if (tradeCount === 0 || pocPrice === null || close === null) {
    return {
      badge: { label: 'Waiting for trades', tone: 'blue' },
      headline: 'Waiting for live trades in this candle',
      oneLiner: 'Price rows will fill in automatically as market buyers and sellers trade here.',
    }
  }

  const pocText = formatPriceInt(pocPrice)

  if (maxDeltaBtc >= 0.25 && deltaBtc < 0 && close <= pocPrice) {
    return {
      badge: { label: 'Trapped buyers', tone: 'rose' },
      headline: 'Buyers pushed first — sellers flipped control',
      oneLiner: `Buyers hit +${maxDeltaBtc.toFixed(2)} ₿ early, then sellers took over and closed below the ${pocText} POC.`,
    }
  }

  if (minDeltaBtc <= -0.25 && deltaBtc > 0 && close >= pocPrice) {
    return {
      badge: { label: 'Trapped sellers', tone: 'teal' },
      headline: 'Sellers dumped first — buyers flipped control',
      oneLiner: `Sellers hit ${minDeltaBtc.toFixed(2)} ₿ early, then buyers absorbed it and closed above the ${pocText} POC.`,
    }
  }

  if (deltaPct >= 15 || (deltaBtc > 0 && buyImbalanceCount > sellImbalanceCount && close >= pocPrice)) {
    const headline =
      close >= pocPrice ? 'Net buying with price at or above POC' : 'More buyer-initiated volume'
    const imbNote =
      buyImbalanceCount > 0
        ? ` with ${buyImbalanceCount} strong buy imbalance${buyImbalanceCount === 1 ? '' : 's'}`
        : ''
    return {
      badge: { label: 'Net buying', tone: 'teal' },
      headline,
      oneLiner: `Market buyers led by ${formatSignedBtc(deltaBtc)} ₿${imbNote} around the ${pocText} POC.`,
    }
  }

  if (deltaPct <= -15 || (deltaBtc < 0 && sellImbalanceCount > buyImbalanceCount && close <= pocPrice)) {
    const headline =
      close <= pocPrice ? 'Net selling with price at or below POC' : 'More seller-initiated volume'
    const imbNote =
      sellImbalanceCount > 0
        ? ` with ${sellImbalanceCount} strong sell imbalance${sellImbalanceCount === 1 ? '' : 's'}`
        : ''
    return {
      badge: { label: 'Net selling', tone: 'rose' },
      headline,
      oneLiner: `Market sellers led by ${formatSignedBtc(deltaBtc)} ₿${imbNote} around the ${pocText} POC.`,
    }
  }

  if (Math.abs(deltaPct) < 15 && (buyImbalanceCount > 0 || sellImbalanceCount > 0)) {
    return {
      badge: { label: 'Near-balanced delta', tone: 'amber' },
      headline: 'Near-balanced delta with price-level imbalances',
      oneLiner: `Net flow near the ${pocText} POC is near zero (${formatSignedBtc(deltaBtc)} ₿).`,
    }
  }

  return {
    badge: { label: 'Near-balanced delta', tone: 'blue' },
    headline: 'Similar buy and sell volume',
    oneLiner: `Bar delta is ${formatSignedBtc(deltaBtc)} ₿. Point of control is ${pocText}.`,
  }
}

function finalizeCandleFromRawRows(params: {
  index: number
  start: number
  end: number
  isDeveloping: boolean
  open: number
  high: number
  low: number
  close: number
  buyBtc: number
  sellBtc: number
  maxDeltaBtc: number
  minDeltaBtc: number
  tradeCount: number
  effectiveStep: number
  rawRows: RawFootprintCell[]
  maxSideBtc: number
  detectImbalances?: boolean
  source?: FootprintSource
}): FootprintCandle {
  const {
    index,
    start,
    end,
    isDeveloping,
    open,
    high,
    low,
    close,
    buyBtc,
    sellBtc,
    maxDeltaBtc,
    minDeltaBtc,
    tradeCount,
    effectiveStep,
    rawRows,
    maxSideBtc,
    detectImbalances = true,
    source = 'trade-sample',
  } = params

  const totalBtc = buyBtc + sellBtc
  const deltaBtc = buyBtc - sellBtc
  const deltaPct = totalBtc > 0 ? (deltaBtc / totalBtc) * 100 : 0
  const pocIdx = findPocIndex(rawRows, close)
  const { vaIndices, vahPrice, valPrice } = computeValueArea(rawRows, pocIdx, totalBtc)
  const closeRowPrice = Math.floor(close / effectiveStep) * effectiveStep

  let buyImbalanceCount = 0
  let sellImbalanceCount = 0

  const rows: FootprintRow[] = rawRows.map((row, r) => {
    const compareSell = rawRows[r + 1]?.sellBtc ?? row.sellBtc
    const compareBuy = rawRows[r - 1]?.buyBtc ?? row.buyBtc

    let imbalance: FootprintRow['imbalance'] = null
    if (detectImbalances) {
      if (row.buyBtc >= IMBALANCE_MIN_BTC && row.buyBtc >= IMBALANCE_RATIO * compareSell) {
        imbalance = 'buy'
        buyImbalanceCount++
      } else if (row.sellBtc >= IMBALANCE_MIN_BTC && row.sellBtc >= IMBALANCE_RATIO * compareBuy) {
        imbalance = 'sell'
        sellImbalanceCount++
      }
    }

    return {
      ...row,
      buyWidthPct: maxSideBtc > 0 && row.buyBtc > 0 ? Math.max(6, Math.round((row.buyBtc / maxSideBtc) * 100)) : 0,
      sellWidthPct: maxSideBtc > 0 && row.sellBtc > 0 ? Math.max(6, Math.round((row.sellBtc / maxSideBtc) * 100)) : 0,
      isPoc: r === pocIdx,
      inValueArea: vaIndices.has(r),
      isCloseRow: row.price === closeRowPrice,
      imbalance,
    }
  })

  const pocPrice = rawRows[pocIdx].price
  const pocVolumeBtc = rawRows[pocIdx].totalBtc
  const verdict = buildCandleVerdict({
    tradeCount,
    close,
    pocPrice,
    deltaBtc,
    deltaPct,
    maxDeltaBtc,
    minDeltaBtc,
    buyImbalanceCount,
    sellImbalanceCount,
  })

  return {
    index,
    start,
    end,
    isDeveloping,
    open,
    high,
    low,
    close,
    buyBtc,
    sellBtc,
    totalBtc,
    deltaBtc,
    deltaPct,
    maxDeltaBtc,
    minDeltaBtc,
    tradeCount,
    stepUsd: effectiveStep,
    pocPrice,
    pocVolumeBtc,
    vahPrice,
    valPrice,
    buyImbalanceCount,
    sellImbalanceCount,
    rows,
    source,
    ...verdict,
  }
}

function buildBackfillCandle(params: {
  index: number
  start: number
  end: number
  isDeveloping: boolean
  baseStepUsd: number
  candle?: OkxCandlePoint
  taker?: OkxTakerVolumeBucket
}): FootprintCandle | null {
  const { index, start, end, isDeveloping, baseStepUsd, candle, taker } = params
  if (!candle && !taker) return null

  const source = taker && (taker.buyBtc > 0 || taker.sellBtc > 0) ? 'exchange-totals' : 'candle-estimate'
  let buyBtc = 0
  let sellBtc = 0
  if (taker && (taker.buyBtc > 0 || taker.sellBtc > 0)) {
    buyBtc = taker.buyBtc
    sellBtc = taker.sellBtc
  } else if (candle && candle.volumeBtc > 0) {
    const vol = taker ? Math.max(taker.volumeBtc, candle.volumeBtc) : candle.volumeBtc
    const range = candle.high - candle.low
    const bodyBias = range > 0 ? (candle.close - candle.open) / range : 0
    const buyRatio = Math.min(0.85, Math.max(0.15, 0.5 + 0.35 * bodyBias))
    buyBtc = vol * buyRatio
    sellBtc = vol - buyBtc
  }

  const totalBtc = buyBtc + sellBtc
  if (totalBtc <= 0) return null

  const deltaBtc = buyBtc - sellBtc
  const deltaPct = (deltaBtc / totalBtc) * 100
  const maxDeltaBtc = Math.max(0, deltaBtc)
  const minDeltaBtc = Math.min(0, deltaBtc)
  const tradeCount = Math.max(1, Math.round(totalBtc * 10))

  if (!candle) {
    const verdict = buildCandleVerdict({
      tradeCount: 0,
      close: null,
      pocPrice: null,
      deltaBtc,
      deltaPct,
      maxDeltaBtc,
      minDeltaBtc,
      buyImbalanceCount: 0,
      sellImbalanceCount: 0,
    })
    return {
      index,
      start,
      end,
      isDeveloping,
      open: null,
      high: null,
      low: null,
      close: null,
      buyBtc,
      sellBtc,
      totalBtc,
      deltaBtc,
      deltaPct,
      maxDeltaBtc,
      minDeltaBtc,
      tradeCount,
      stepUsd: baseStepUsd,
      pocPrice: null,
      pocVolumeBtc: 0,
      vahPrice: null,
      valPrice: null,
      buyImbalanceCount: 0,
      sellImbalanceCount: 0,
      rows: [],
      source,
      ...verdict,
    }
  }

  const safeLow = Math.min(candle.low, candle.open, candle.close)
  const safeHigh = Math.max(candle.high, candle.open, candle.close)
  const effectiveStep = widenStepForRange(safeLow, safeHigh, baseStepUsd)
  const minRowIdx = Math.floor(safeLow / effectiveStep)
  const maxRowIdx = Math.floor(safeHigh / effectiveStep)
  const bodyLow = Math.min(candle.open, candle.close)
  const bodyHigh = Math.max(candle.open, candle.close)
  const bodyMid = (bodyLow + bodyHigh) / 2
  const halfSpan = Math.max(effectiveStep, (safeHigh - safeLow) / 2)

  const weights: { idx: number; weight: number }[] = []
  let weightSum = 0
  for (let idx = maxRowIdx; idx >= minRowIdx; idx--) {
    const rowMid = (idx + 0.5) * effectiveStep
    const inBody = rowMid >= bodyLow - effectiveStep * 0.5 && rowMid <= bodyHigh + effectiveStep * 0.5
    const distNorm = Math.min(1, Math.abs(rowMid - bodyMid) / halfSpan)
    const weight = (inBody ? 1.2 : 0.35) + (1 - distNorm) * 0.8
    weights.push({ idx, weight })
    weightSum += weight
  }

  const rawRows: RawFootprintCell[] = []
  let maxSideBtc = 0
  for (const { idx, weight } of weights) {
    const share = weightSum > 0 ? weight / weightSum : 1 / weights.length
    const rowBuyBtc = buyBtc * share
    const rowSellBtc = sellBtc * share
    if (rowBuyBtc > maxSideBtc) maxSideBtc = rowBuyBtc
    if (rowSellBtc > maxSideBtc) maxSideBtc = rowSellBtc
    rawRows.push({
      price: idx * effectiveStep,
      buyBtc: rowBuyBtc,
      sellBtc: rowSellBtc,
      totalBtc: rowBuyBtc + rowSellBtc,
      deltaBtc: rowBuyBtc - rowSellBtc,
    })
  }

  return finalizeCandleFromRawRows({
    index,
    start,
    end,
    isDeveloping,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    buyBtc,
    sellBtc,
    maxDeltaBtc,
    minDeltaBtc,
    tradeCount,
    effectiveStep,
    rawRows,
    maxSideBtc,
    detectImbalances: false,
    source,
  })
}

export function evaluateFootprint(params: {
  trades: readonly FootprintTrade[]
  now: number
  bucketMs: number
  stepOption?: FootprintStepOption
  candleCount?: number
  backfill?: {
    candles?: readonly OkxCandlePoint[]
    takerBuckets?: readonly OkxTakerVolumeBucket[]
  }
}): FootprintEvaluation {
  const { trades, now, bucketMs, stepOption = 'auto', candleCount = 6, backfill } = params
  const safeBucketMs = bucketMs > 0 ? bucketMs : 60_000
  const currentStart = Math.floor(now / safeBucketMs) * safeBucketMs
  const firstStart = currentStart - (candleCount - 1) * safeBucketMs

  const candleMap = new Map<number, OkxCandlePoint>()
  for (const candle of backfill?.candles ?? []) {
    candleMap.set(candle.time, candle)
  }
  const takerMap = new Map<number, OkxTakerVolumeBucket>()
  for (const bucket of backfill?.takerBuckets ?? []) {
    takerMap.set(bucket.time, bucket)
  }

  type ParsedTrade = { time: number; price: number; side: 'buy' | 'sell'; sats: bigint }
  const bucketed: ParsedTrade[][] = Array.from({ length: candleCount }, () => [])

  for (const t of trades) {
    if (t.time < firstStart || t.time >= currentStart + safeBucketMs) continue
    const price = Number(t.price)
    if (!Number.isFinite(price) || price <= 0) continue
    const sats = parseTradeSats(t.quantityBtc)
    if (sats === null) continue
    const idx = Math.floor((t.time - firstStart) / safeBucketMs)
    if (idx >= 0 && idx < candleCount) {
      bucketed[idx].push({ time: t.time, price, side: t.side, sats })
    }
  }

  const bucketRanges: number[] = []
  for (let index = 0; index < bucketed.length; index++) {
    const list = bucketed[index]
    if (list.length === 0) {
      const start = firstStart + index * safeBucketMs
      const candle = candleMap.get(start)
      if (candle && candle.high > candle.low) {
        bucketRanges.push(candle.high - candle.low)
      }
      continue
    }
    list.sort((a, b) => a.time - b.time)
    let minP = Infinity
    let maxP = -Infinity
    for (const item of list) {
      if (item.price < minP) minP = item.price
      if (item.price > maxP) maxP = item.price
    }
    bucketRanges.push(maxP - minP)
  }

  const baseStepUsd = chooseStepUsd(bucketRanges, stepOption)

  const candles: FootprintCandle[] = bucketed.map((list, index) => {
    const start = firstStart + index * safeBucketMs
    const end = start + safeBucketMs
    const isDeveloping = index === candleCount - 1

    if (list.length === 0) {
      const backfilled = buildBackfillCandle({
        index,
        start,
        end,
        isDeveloping,
        baseStepUsd,
        candle: candleMap.get(start),
        taker: takerMap.get(start),
      })
      if (backfilled) return backfilled

      const verdict = buildCandleVerdict({
        tradeCount: 0,
        close: null,
        pocPrice: null,
        deltaBtc: 0,
        deltaPct: 0,
        maxDeltaBtc: 0,
        minDeltaBtc: 0,
        buyImbalanceCount: 0,
        sellImbalanceCount: 0,
      })
      return {
        index,
        start,
        end,
        isDeveloping,
        open: null,
        high: null,
        low: null,
        close: null,
        buyBtc: 0,
        sellBtc: 0,
        totalBtc: 0,
        deltaBtc: 0,
        deltaPct: 0,
        maxDeltaBtc: 0,
        minDeltaBtc: 0,
        tradeCount: 0,
        stepUsd: baseStepUsd,
        pocPrice: null,
        pocVolumeBtc: 0,
        vahPrice: null,
        valPrice: null,
        buyImbalanceCount: 0,
        sellImbalanceCount: 0,
        rows: [],
        ...verdict,
      }
    }

    const open = list[0].price
    const close = list[list.length - 1].price
    let high = -Infinity
    let low = Infinity
    let buySats = 0n
    let sellSats = 0n
    let runningDeltaSats = 0n
    let maxDeltaSats = 0n
    let minDeltaSats = 0n

    for (const item of list) {
      if (item.price > high) high = item.price
      if (item.price < low) low = item.price
      if (item.side === 'buy') {
        buySats += item.sats
        runningDeltaSats += item.sats
      } else {
        sellSats += item.sats
        runningDeltaSats -= item.sats
      }
      if (runningDeltaSats > maxDeltaSats) maxDeltaSats = runningDeltaSats
      if (runningDeltaSats < minDeltaSats) minDeltaSats = runningDeltaSats
    }

    const effectiveStep = widenStepForRange(low, high, baseStepUsd)
    const minRowIdx = Math.floor(low / effectiveStep)
    const maxRowIdx = Math.floor(high / effectiveStep)

    const cellMap = new Map<number, { buySats: bigint; sellSats: bigint }>()
    for (const item of list) {
      const rowIdx = Math.floor(item.price / effectiveStep)
      const existing = cellMap.get(rowIdx) ?? { buySats: 0n, sellSats: 0n }
      if (item.side === 'buy') existing.buySats += item.sats
      else existing.sellSats += item.sats
      cellMap.set(rowIdx, existing)
    }

    const rawRows: RawFootprintCell[] = []

    let maxSideBtc = 0
    for (let idx = maxRowIdx; idx >= minRowIdx; idx--) {
      const cell = cellMap.get(idx)
      const rowBuyBtc = cell ? Number(cell.buySats) / 1e8 : 0
      const rowSellBtc = cell ? Number(cell.sellSats) / 1e8 : 0
      const totalBtc = rowBuyBtc + rowSellBtc
      const deltaBtc = rowBuyBtc - rowSellBtc
      if (rowBuyBtc > maxSideBtc) maxSideBtc = rowBuyBtc
      if (rowSellBtc > maxSideBtc) maxSideBtc = rowSellBtc
      rawRows.push({
        price: idx * effectiveStep,
        buyBtc: rowBuyBtc,
        sellBtc: rowSellBtc,
        totalBtc,
        deltaBtc,
      })
    }

    const buyBtc = Number(buySats) / 1e8
    const sellBtc = Number(sellSats) / 1e8
    const maxDeltaBtc = Number(maxDeltaSats) / 1e8
    const minDeltaBtc = Number(minDeltaSats) / 1e8

    return finalizeCandleFromRawRows({
      index,
      start,
      end,
      isDeveloping,
      open,
      high,
      low,
      close,
      buyBtc,
      sellBtc,
      maxDeltaBtc,
      minDeltaBtc,
      tradeCount: list.length,
      effectiveStep,
      rawRows,
      maxSideBtc,
      detectImbalances: true,
    })
  })

  return { candles, stepUsd: baseStepUsd }
}

const WHALE_MIN_SATS = 100_000_000n
const MID_MIN_SATS = 10_000_000n

export type TradeSizeTierId = 'whale' | 'mid' | 'retail'
export type TradeSizeScope = 'window' | 'candle'

export type TradeSizeTierBucket = {
  id: TradeSizeTierId
  icon: string
  label: string
  rangeHint: string
  buyBtc: number
  sellBtc: number
  totalBtc: number
  deltaBtc: number
  buySharePct: number
  sellSharePct: number
  volumeSharePct: number
  tradeCount: number
  bias: 'buying' | 'selling' | 'balanced' | 'idle'
}

export type LargestTradePrint = {
  side: 'buy' | 'sell'
  btc: number
  price: number
  notionalUsd: number
  time: number
}

export type TradeSizeEvaluation = {
  tiers: [TradeSizeTierBucket, TradeSizeTierBucket, TradeSizeTierBucket]
  whale: TradeSizeTierBucket
  mid: TradeSizeTierBucket
  retail: TradeSizeTierBucket
  totalBtc: number
  totalTradeCount: number
  largestTrade: LargestTradePrint | null
  badge: { label: string; tone: 'teal' | 'rose' | 'amber' | 'blue' }
  headline: string
  oneLiner: string
}

export function evaluateTradeSizeFlow(params: {
  trades: readonly FootprintTrade[]
  start: number
  end: number
}): TradeSizeEvaluation {
  const { trades, start, end } = params

  const accum: Record<
    TradeSizeTierId,
    {
      id: TradeSizeTierId
      icon: string
      label: string
      rangeHint: string
      buySats: bigint
      sellSats: bigint
      tradeCount: number
    }
  > = {
    whale: {
      id: 'whale',
      icon: '🐋',
      label: 'Whales (≥ 1 ₿)',
      rangeHint: '1.00 ₿+ per trade',
      buySats: 0n,
      sellSats: 0n,
      tradeCount: 0,
    },
    mid: {
      id: 'mid',
      icon: '🦈',
      label: 'Mid-Size (0.1–1 ₿)',
      rangeHint: '0.10 – 0.99 ₿ per trade',
      buySats: 0n,
      sellSats: 0n,
      tradeCount: 0,
    },
    retail: {
      id: 'retail',
      icon: '🐟',
      label: 'Small Orders (< 0.1 ₿)',
      rangeHint: 'Under 0.10 ₿ per trade',
      buySats: 0n,
      sellSats: 0n,
      tradeCount: 0,
    },
  }

  let totalSats = 0n
  let totalTradeCount = 0
  let bestSats = 0n
  let largestTrade: LargestTradePrint | null = null

  for (const t of trades) {
    if (t.time < start || t.time >= end) continue
    const price = Number(t.price)
    if (!Number.isFinite(price) || price <= 0) continue
    const sats = parseTradeSats(t.quantityBtc)
    if (sats === null) continue

    const tierId: TradeSizeTierId =
      sats >= WHALE_MIN_SATS ? 'whale' : sats >= MID_MIN_SATS ? 'mid' : 'retail'
    const bucket = accum[tierId]
    if (t.side === 'buy') bucket.buySats += sats
    else bucket.sellSats += sats
    bucket.tradeCount++
    totalSats += sats
    totalTradeCount++

    if (sats > bestSats || (sats === bestSats && largestTrade && t.time >= largestTrade.time)) {
      bestSats = sats
      const btc = Number(sats) / 1e8
      largestTrade = {
        side: t.side,
        btc,
        price,
        notionalUsd: btc * price,
        time: t.time,
      }
    }
  }

  const grandTotalBtc = Number(totalSats) / 1e8

  const finalize = (raw: (typeof accum)['whale']): TradeSizeTierBucket => {
    const buyBtc = Number(raw.buySats) / 1e8
    const sellBtc = Number(raw.sellSats) / 1e8
    const totalBtc = buyBtc + sellBtc
    const deltaBtc = buyBtc - sellBtc
    const buySharePct = totalBtc > 0 ? Math.round((buyBtc / totalBtc) * 100) : 0
    const sellSharePct = totalBtc > 0 ? 100 - buySharePct : 0
    const volumeSharePct = grandTotalBtc > 0 ? Math.round((totalBtc / grandTotalBtc) * 100) : 0
    const bias: TradeSizeTierBucket['bias'] =
      raw.tradeCount === 0
        ? 'idle'
        : deltaBtc > totalBtc * 0.08
          ? 'buying'
          : deltaBtc < -totalBtc * 0.08
            ? 'selling'
            : 'balanced'

    return {
      id: raw.id,
      icon: raw.icon,
      label: raw.label,
      rangeHint: raw.rangeHint,
      buyBtc,
      sellBtc,
      totalBtc,
      deltaBtc,
      buySharePct,
      sellSharePct,
      volumeSharePct,
      tradeCount: raw.tradeCount,
      bias,
    }
  }

  const whale = finalize(accum.whale)
  const mid = finalize(accum.mid)
  const retail = finalize(accum.retail)

  let badge: TradeSizeEvaluation['badge']
  let headline: string
  let oneLiner: string

  if (totalTradeCount === 0) {
    badge = { label: 'Waiting for trades', tone: 'blue' }
    headline = 'Waiting for live orders to split Whales vs. Retail'
    oneLiner =
      'Incoming trades are sorted by size so you can see if big players and small traders agree.'
  } else if (whale.deltaBtc > 0 && retail.deltaBtc < 0) {
    badge = { label: 'Whales absorbing retail', tone: 'teal' }
    headline = 'Whales are buying while small traders sell'
    oneLiner = `Large orders (≥ 1 ₿) are net ${formatSignedBtc(whale.deltaBtc)} ₿ buying, soaking up ${formatSignedBtc(retail.deltaBtc)} ₿ of small-order selling.`
  } else if (whale.deltaBtc < 0 && retail.deltaBtc > 0) {
    badge = { label: 'Whales selling into retail', tone: 'rose' }
    headline = 'Whales are selling into small-trader buying'
    oneLiner = `Small orders are net ${formatSignedBtc(retail.deltaBtc)} ₿ buying, but large orders (≥ 1 ₿) are net ${formatSignedBtc(whale.deltaBtc)} ₿ selling.`
  } else if (whale.deltaBtc > 0 && retail.deltaBtc >= 0) {
    badge = { label: 'Aligned buying', tone: 'teal' }
    headline = 'Whales and smaller traders are buying together'
    oneLiner = `Large orders lead at ${formatSignedBtc(whale.deltaBtc)} ₿ net buying alongside supportive smaller flow.`
  } else if (whale.deltaBtc < 0 && retail.deltaBtc <= 0) {
    badge = { label: 'Aligned selling', tone: 'rose' }
    headline = 'Whales and smaller traders are selling together'
    oneLiner = `Large orders lead at ${formatSignedBtc(whale.deltaBtc)} ₿ net selling alongside smaller sell orders.`
  } else if (whale.tradeCount === 0) {
    badge = { label: 'No 1 ₿+ whales yet', tone: 'amber' }
    headline = 'Smaller orders driving flow — no 1 ₿+ whale print yet'
    oneLiner = `Mid-size (${formatSignedBtc(mid.deltaBtc)} ₿) and small orders (${formatSignedBtc(retail.deltaBtc)} ₿) are setting the pace so far.`
  } else {
    badge = { label: 'Balanced size flow', tone: 'blue' }
    headline = 'Order sizes are balanced between buyers and sellers'
    oneLiner = 'Neither whales nor small traders have taken a lopsided edge in this window.'
  }

  return {
    tiers: [whale, mid, retail],
    whale,
    mid,
    retail,
    totalBtc: grandTotalBtc,
    totalTradeCount,
    largestTrade,
    badge,
    headline,
    oneLiner,
  }
}

export type SvpRangeId = '24h' | 'today' | 'prevDay' | '3d' | '7d' | 'chart'

export const SVP_RANGE_OPTIONS: readonly {
  id: SvpRangeId
  label: string
  shortLabel: string
  description: string
}[] = [
  { id: '24h', label: 'Rolling 24h', shortLabel: '24h', description: 'Last 24 hours (15m profile + live)' },
  { id: 'today', label: 'Today (UTC)', shortLabel: 'Today', description: 'Current UTC day since 00:00 UTC' },
  { id: 'prevDay', label: 'Prev Day (UTC)', shortLabel: 'Prev Day', description: 'Yesterday’s completed UTC session' },
  { id: '3d', label: '3-Day Swing', shortLabel: '3D', description: 'Last 72 hours (1H profile + live)' },
  { id: '7d', label: '7-Day Weekly', shortLabel: '7D', description: 'Last 7 days (1H profile + live)' },
  { id: 'chart', label: 'Chart TF', shortLabel: 'Chart TF', description: 'Matches top timeframe bar' },
]

export type PrevDayValueLevels = {
  dateLabel: string
  pocPrice: number
  vahPrice: number
  valPrice: number
  high: number
  low: number
  totalBtc: number
  candleCount: number
  pricePosition: 'above-pvah' | 'inside-pva' | 'below-pval' | 'unknown'
  contextNote: string
}

export type NakedPocMagnet = {
  candleIndex: number
  candleStart: number
  price: number
  rowPrice: number
  onLadder: boolean
  kind: 'daily' | 'weekly' | 'monthly' | 'candle'
  originLabel: string
  volumeBtc: number
  directionFromClose: 'above' | 'below' | 'at'
  distanceUsd: number
  distancePct: number | null
}

export type SessionProfileRow = {
  price: number
  buyBtc: number
  sellBtc: number
  totalBtc: number
  deltaBtc: number
  totalWidthPct: number
  buySharePct: number
  sellSharePct: number
  isSessionPoc: boolean
  isVah: boolean
  isVal: boolean
  inValueArea: boolean
  isLatestRow: boolean
  isNakedPoc: boolean
  nakedPocCount: number
  nakedPocLabels: string[]
  isPrevDayPoc: boolean
  isPrevDayVah: boolean
  isPrevDayVal: boolean
}

export type SessionProfileEvaluation = {
  rangeId: SvpRangeId
  rangeLabel: string
  sourceLabel: string
  candleCount: number
  stepUsd: number
  totalBtc: number
  deltaBtc: number
  tradeCount: number
  latestPrice: number | null
  sessionPocPrice: number | null
  sessionPocVolumeBtc: number
  sessionVahPrice: number | null
  sessionValPrice: number | null
  valueStatus: 'above' | 'below' | 'inside' | 'waiting'
  prevDayLevels: PrevDayValueLevels | null
  nakedPocMode: 'daily' | 'candle'
  nakedPocs: NakedPocMagnet[]
  rows: SessionProfileRow[]
  badge: { label: string; tone: 'teal' | 'rose' | 'amber' | 'blue' }
  headline: string
  oneLiner: string
}

type CandleProfileSource = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volumeBtc: number
  buyBtc?: number
  sellBtc?: number
}

function distributeCandleToCells(params: {
  candle: CandleProfileSource
  taker?: OkxTakerVolumeBucket
  effectiveStep: number
  cellMap: Map<number, { buyBtc: number; sellBtc: number }>
}): number {
  const { candle, taker, effectiveStep, cellMap } = params
  let buyBtc = 0
  let sellBtc = 0

  if (candle.buyBtc !== undefined && candle.sellBtc !== undefined) {
    buyBtc = candle.buyBtc
    sellBtc = candle.sellBtc
  } else if (taker && taker.volumeBtc > 0) {
    if (candle.volumeBtc > 0) {
      const buyShare = Math.min(1, Math.max(0, taker.buyBtc / taker.volumeBtc))
      buyBtc = candle.volumeBtc * buyShare
      sellBtc = candle.volumeBtc - buyBtc
    } else {
      buyBtc = taker.buyBtc
      sellBtc = taker.sellBtc
    }
  } else if (candle.volumeBtc > 0) {
    const range = candle.high - candle.low
    const bodyBias = range > 0 ? (candle.close - candle.open) / range : 0
    const buyRatio = Math.min(0.85, Math.max(0.15, 0.5 + 0.35 * bodyBias))
    buyBtc = candle.volumeBtc * buyRatio
    sellBtc = candle.volumeBtc - buyBtc
  }

  const totalBtc = buyBtc + sellBtc
  if (totalBtc <= 0) return 0

  const safeLow = Math.min(candle.low, candle.open, candle.close)
  const safeHigh = Math.max(candle.high, candle.open, candle.close)
  const bodyLow = Math.min(candle.open, candle.close)
  const bodyHigh = Math.max(candle.open, candle.close)
  const cMinIdx = Math.floor(safeLow / effectiveStep)
  const cMaxIdx = Math.floor(safeHigh / effectiveStep)

  if (safeHigh <= safeLow || cMinIdx === cMaxIdx) {
    const existing = cellMap.get(cMinIdx) ?? { buyBtc: 0, sellBtc: 0 }
    existing.buyBtc += buyBtc
    existing.sellBtc += sellBtc
    cellMap.set(cMinIdx, existing)
    return totalBtc
  }

  const weights: { idx: number; weight: number }[] = []
  let weightSum = 0
  for (let idx = cMaxIdx; idx >= cMinIdx; idx--) {
    const rowLow = idx * effectiveStep
    const rowHigh = (idx + 1) * effectiveStep
    const wickOverlap = Math.max(0, Math.min(safeHigh, rowHigh) - Math.max(safeLow, rowLow))
    const bodyOverlap = Math.max(0, Math.min(bodyHigh, rowHigh) - Math.max(bodyLow, rowLow))
    const weight = bodyOverlap * 1.5 + wickOverlap * 0.5
    weights.push({ idx, weight })
    weightSum += weight
  }

  for (const { idx, weight } of weights) {
    const share = weightSum > 0 ? weight / weightSum : 1 / weights.length
    if (share <= 0) continue
    const existing = cellMap.get(idx) ?? { buyBtc: 0, sellBtc: 0 }
    existing.buyBtc += buyBtc * share
    existing.sellBtc += sellBtc * share
    cellMap.set(idx, existing)
  }

  return totalBtc
}

function buildRawProfileGrid(params: {
  cellMap: Map<number, { buyBtc: number; sellBtc: number }>
  minRowIdx: number
  maxRowIdx: number
  effectiveStep: number
  referenceClose: number
}): {
  rawRows: RawFootprintCell[]
  maxRowTotalBtc: number
  totalBtc: number
  deltaBtc: number
  pocIdx: number
  vaIndices: Set<number>
  pocPrice: number
  pocVolumeBtc: number
  vahPrice: number
  valPrice: number
} {
  const { cellMap, minRowIdx, maxRowIdx, effectiveStep, referenceClose } = params
  const rawRows: RawFootprintCell[] = []
  let maxRowTotalBtc = 0
  let totalBuyBtc = 0
  let totalSellBtc = 0

  for (let idx = maxRowIdx; idx >= minRowIdx; idx--) {
    const cell = cellMap.get(idx)
    const rowBuyBtc = cell?.buyBtc ?? 0
    const rowSellBtc = cell?.sellBtc ?? 0
    const rowTotalBtc = rowBuyBtc + rowSellBtc
    const rowDeltaBtc = rowBuyBtc - rowSellBtc
    totalBuyBtc += rowBuyBtc
    totalSellBtc += rowSellBtc
    if (rowTotalBtc > maxRowTotalBtc) maxRowTotalBtc = rowTotalBtc
    rawRows.push({
      price: idx * effectiveStep,
      buyBtc: rowBuyBtc,
      sellBtc: rowSellBtc,
      totalBtc: rowTotalBtc,
      deltaBtc: rowDeltaBtc,
    })
  }

  const totalBtc = totalBuyBtc + totalSellBtc
  const deltaBtc = totalBuyBtc - totalSellBtc
  const pocIdx = findPocIndex(rawRows, referenceClose)
  const { vaIndices, vahPrice, valPrice } = computeValueArea(rawRows, pocIdx, totalBtc)

  return {
    rawRows,
    maxRowTotalBtc,
    totalBtc,
    deltaBtc,
    pocIdx,
    vaIndices,
    pocPrice: rawRows[pocIdx].price,
    pocVolumeBtc: rawRows[pocIdx].totalBtc,
    vahPrice,
    valPrice,
  }
}

type UtcDayProfileResult = {
  pocPrice: number
  pocVolumeBtc: number
  vahPrice: number
  valPrice: number
  high: number
  low: number
  totalBtc: number
  stepUsd: number
  candleCount: number
  dateLabel: string
}

export function computeUtcDayProfile(params: {
  dayCandles: readonly OkxCandlePoint[]
  takerMap: ReadonlyMap<number, OkxTakerVolumeBucket>
  dayStart: number
}): UtcDayProfileResult | null {
  const { dayCandles, takerMap, dayStart } = params
  if (dayCandles.length === 0) return null

  const sorted = [...dayCandles].sort((a, b) => a.time - b.time)
  let minPrice = Infinity
  let maxPrice = -Infinity
  for (const c of sorted) {
    const lo = Math.min(c.low, c.open, c.close)
    const hi = Math.max(c.high, c.open, c.close)
    if (lo < minPrice) minPrice = lo
    if (hi > maxPrice) maxPrice = hi
  }
  if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice) || minPrice <= 0) return null

  const baseStep = chooseSvpStepUsd(maxPrice - minPrice, 'auto')
  const effectiveStep = widenStepForRange(minPrice, maxPrice, baseStep, MAX_SVP_ROWS)
  const minRowIdx = Math.floor(minPrice / effectiveStep)
  const maxRowIdx = Math.floor(maxPrice / effectiveStep)

  const cellMap = new Map<number, { buyBtc: number; sellBtc: number }>()
  for (const c of sorted) {
    distributeCandleToCells({
      candle: c,
      taker: takerMap.get(c.time),
      effectiveStep,
      cellMap,
    })
  }

  const referenceClose = sorted[sorted.length - 1].close
  const grid = buildRawProfileGrid({
    cellMap,
    minRowIdx,
    maxRowIdx,
    effectiveStep,
    referenceClose,
  })
  if (grid.totalBtc <= 0) return null

  const dateLabel = `${new Date(dayStart).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })} UTC`

  return {
    pocPrice: grid.pocPrice,
    pocVolumeBtc: grid.pocVolumeBtc,
    vahPrice: grid.vahPrice,
    valPrice: grid.valPrice,
    high: maxPrice,
    low: minPrice,
    totalBtc: grid.totalBtc,
    stepUsd: effectiveStep,
    candleCount: sorted.length,
    dateLabel,
  }
}

export function evaluatePrevDayReference(params: {
  candles15m?: readonly OkxCandlePoint[]
  taker15m?: readonly OkxTakerVolumeBucket[]
  now: number
  latestPrice?: number | null
}): PrevDayValueLevels | null {
  const { candles15m = [], taker15m = [], now, latestPrice = null } = params
  const todayUtcStart = Math.floor(now / DAY_MS) * DAY_MS
  const prevDayUtcStart = todayUtcStart - DAY_MS
  const prevCandles = candles15m.filter(c => c.time >= prevDayUtcStart && c.time < todayUtcStart)
  if (prevCandles.length === 0) return null

  const takerMap = new Map<number, OkxTakerVolumeBucket>()
  for (const tb of taker15m) takerMap.set(tb.time, tb)

  const profile = computeUtcDayProfile({
    dayCandles: prevCandles,
    takerMap,
    dayStart: prevDayUtcStart,
  })
  if (!profile) return null

  let pricePosition: PrevDayValueLevels['pricePosition'] = 'unknown'
  if (latestPrice !== null && Number.isFinite(latestPrice) && latestPrice > 0) {
    const latestRowPrice = Math.floor(latestPrice / profile.stepUsd) * profile.stepUsd
    if (latestRowPrice > profile.vahPrice) pricePosition = 'above-pvah'
    else if (latestRowPrice < profile.valPrice) pricePosition = 'below-pval'
    else pricePosition = 'inside-pva'
  }

  const contextNote =
    pricePosition === 'above-pvah'
      ? `Price is holding above yesterday’s Value Area (${formatPriceInt(profile.vahPrice)} pVAH) — bullish acceptance; pVAH and ${formatPriceInt(profile.pocPrice)} pPOC act as pullback support.`
      : pricePosition === 'below-pval'
        ? `Price is trading below yesterday’s Value Area (${formatPriceInt(profile.valPrice)} pVAL) — bearish pressure; pVAL and ${formatPriceInt(profile.pocPrice)} pPOC act as overhead resistance.`
        : pricePosition === 'inside-pva'
          ? `Price is inside yesterday’s 70% Value Area (${formatPriceInt(profile.valPrice)}–${formatPriceInt(profile.vahPrice)}) — rotational range around ${formatPriceInt(profile.pocPrice)} pPOC.`
          : `Yesterday’s 70% Value Area spanned ${formatPriceInt(profile.valPrice)}–${formatPriceInt(profile.vahPrice)} around ${formatPriceInt(profile.pocPrice)} pPOC.`

  return {
    dateLabel: profile.dateLabel,
    pocPrice: profile.pocPrice,
    vahPrice: profile.vahPrice,
    valPrice: profile.valPrice,
    high: profile.high,
    low: profile.low,
    totalBtc: profile.totalBtc,
    candleCount: profile.candleCount,
    pricePosition,
    contextNote,
  }
}

export function evaluateDailyNakedPocs(params: {
  candles15m?: readonly OkxCandlePoint[]
  taker15m?: readonly OkxTakerVolumeBucket[]
  candles1h?: readonly OkxCandlePoint[]
  taker1h?: readonly OkxTakerVolumeBucket[]
  liveTrades?: readonly { time: number; price: number }[]
  now: number
  latestPrice: number
  ladderStepUsd: number
  ladderMinRowPrice: number
  ladderMaxRowPrice: number
}): NakedPocMagnet[] {
  const {
    candles15m = [],
    taker15m = [],
    candles1h = [],
    taker1h = [],
    liveTrades = [],
    now,
    latestPrice,
    ladderStepUsd,
    ladderMinRowPrice,
    ladderMaxRowPrice,
  } = params

  const todayUtcStart = Math.floor(now / DAY_MS) * DAY_MS
  const prevDayUtcStart = todayUtcStart - DAY_MS

  const day1hMap = new Map<number, OkxCandlePoint[]>()
  let oldest1hDay = Infinity
  for (const c of candles1h) {
    const dayStart = Math.floor(c.time / DAY_MS) * DAY_MS
    if (dayStart < oldest1hDay) oldest1hDay = dayStart
    if (dayStart >= todayUtcStart) continue
    const list = day1hMap.get(dayStart)
    if (list) list.push(c)
    else day1hMap.set(dayStart, [c])
  }

  const prevDay15mCandles = candles15m.filter(
    c => c.time >= prevDayUtcStart && c.time < todayUtcStart,
  )

  const candidateDays = new Set<number>(day1hMap.keys())
  if (prevDay15mCandles.length > 0) candidateDays.add(prevDayUtcStart)

  // Drop truncated leading partial UTC day from long 1H history when < 12 bars exist
  if (candles1h.length >= 48 && Number.isFinite(oldest1hDay) && oldest1hDay < todayUtcStart) {
    const oldestCount = day1hMap.get(oldest1hDay)?.length ?? 0
    const coveredByPrev15m = oldest1hDay === prevDayUtcStart && prevDay15mCandles.length > 0
    if (oldestCount < 12 && !coveredByPrev15m) {
      candidateDays.delete(oldest1hDay)
    }
  }

  const sortedDays = Array.from(candidateDays).sort((a, b) => a - b)
  if (sortedDays.length === 0) return []

  const taker15mMap = new Map<number, OkxTakerVolumeBucket>()
  for (const tb of taker15m) taker15mMap.set(tb.time, tb)
  const taker1hMap = new Map<number, OkxTakerVolumeBucket>()
  for (const tb of taker1h) taker1hMap.set(tb.time, tb)

  const allSubsequentCandles = [...candles1h, ...candles15m]
  const magnets: NakedPocMagnet[] = []

  sortedDays.forEach((dayStart, idx) => {
    const usePrev15m = dayStart === prevDayUtcStart && prevDay15mCandles.length > 0
    const dayCandles = usePrev15m ? prevDay15mCandles : (day1hMap.get(dayStart) ?? [])
    const takerMap = usePrev15m ? taker15mMap : taker1hMap

    const dayProfile = computeUtcDayProfile({ dayCandles, takerMap, dayStart })
    if (!dayProfile) return

    const dayEnd = dayStart + DAY_MS
    const pocLow = dayProfile.pocPrice
    const pocHigh = dayProfile.pocPrice + dayProfile.stepUsd

    let tested = false
    for (const later of allSubsequentCandles) {
      if (later.time < dayEnd) continue
      const lo = Math.min(later.low, later.open, later.close)
      const hi = Math.max(later.high, later.open, later.close)
      if (lo < pocHigh && hi >= pocLow) {
        tested = true
        break
      }
    }

    if (!tested) {
      for (const t of liveTrades) {
        if (t.time < dayEnd) continue
        if (t.price >= pocLow && t.price < pocHigh) {
          tested = true
          break
        }
      }
    }

    if (tested) return

    const rowPrice = Math.floor(dayProfile.pocPrice / ladderStepUsd) * ladderStepUsd
    const distanceUsd = Math.round(dayProfile.pocPrice - latestPrice)
    const distancePct =
      latestPrice > 0 ? Number((((dayProfile.pocPrice - latestPrice) / latestPrice) * 100).toFixed(2)) : null

    magnets.push({
      candleIndex: idx,
      candleStart: dayStart,
      price: dayProfile.pocPrice,
      rowPrice,
      onLadder: rowPrice >= ladderMinRowPrice && rowPrice <= ladderMaxRowPrice,
      kind: 'daily',
      originLabel: `${dayProfile.dateLabel.replace(' UTC', '')} dPOC`,
      volumeBtc: dayProfile.pocVolumeBtc,
      directionFromClose:
        dayProfile.pocPrice > latestPrice ? 'above' : dayProfile.pocPrice < latestPrice ? 'below' : 'at',
      distanceUsd,
      distancePct,
    })
  })

  return magnets.sort(
    (a, b) => Math.abs(a.distanceUsd) - Math.abs(b.distanceUsd) || b.candleStart - a.candleStart,
  )
}

export function evaluateSessionProfile(params: {
  trades: readonly FootprintTrade[]
  candles: readonly FootprintCandle[]
  stepOption?: FootprintStepOption
  rangeId?: SvpRangeId
  now?: number
  timeframeShort?: string
  bucketMs?: number
  backfill?: {
    candles?: readonly OkxCandlePoint[]
    takerBuckets?: readonly OkxTakerVolumeBucket[]
  }
  hasCalendarHistory?: boolean
  calendarMagnets?: readonly { price: number; period: 'daily' | 'weekly' | 'monthly'; date: number; label: string; volumeBtc: number }[]
  svpHistory?: {
    candles15m?: readonly OkxCandlePoint[]
    taker15m?: readonly OkxTakerVolumeBucket[]
    candles1h?: readonly OkxCandlePoint[]
    taker1h?: readonly OkxTakerVolumeBucket[]
  }
}): SessionProfileEvaluation {
  const {
    trades,
    candles,
    stepOption = 'auto',
    rangeId = 'chart',
    now: nowParam,
    timeframeShort,
    bucketMs: bucketMsParam,
    backfill,
    svpHistory,
    calendarMagnets,
    hasCalendarHistory = false,
  } = params
  const defaultStep = stepOption === 'auto' ? 10 : stepOption
  const effectiveNow =
    nowParam ?? (candles.length > 0 ? candles[candles.length - 1].end : Date.now())

  type ParsedTrade = { time: number; price: number; side: 'buy' | 'sell'; sats: bigint }
  const allValidTrades: ParsedTrade[] = []
  let earliestLiveTime = Infinity
  let latestLiveTime = -Infinity
  let latestLivePrice: number | null = null

  for (const t of trades) {
    const price = Number(t.price)
    if (!Number.isFinite(price) || price <= 0) continue
    const sats = parseTradeSats(t.quantityBtc)
    if (sats === null) continue
    allValidTrades.push({ time: t.time, price, side: t.side, sats })
    if (t.time < earliestLiveTime) earliestLiveTime = t.time
    if (t.time >= latestLiveTime) {
      latestLiveTime = t.time
      latestLivePrice = price
    }
  }

  const prevDayLevels = evaluatePrevDayReference({
    candles15m: svpHistory?.candles15m,
    taker15m: svpHistory?.taker15m,
    now: effectiveNow,
    latestPrice: latestLivePrice,
  })

  const todayUtcStart = Math.floor(effectiveNow / DAY_MS) * DAY_MS
  const prevDayUtcStart = todayUtcStart - DAY_MS
  const hasPriorDailyHistory =
    (svpHistory?.candles1h?.some(c => c.time < todayUtcStart) ?? false) ||
    (svpHistory?.candles15m?.some(c => c.time < todayUtcStart) ?? false)
  const nakedPocMode: 'daily' | 'candle' =
    calendarMagnets !== undefined || (rangeId !== 'chart' && hasPriorDailyHistory) ? 'daily' : 'candle'

  let rangeStart = 0
  let rangeEnd = effectiveNow + 1
  let barMs = 900_000
  let allowLiveOverlay = true
  let rangeLabel = '24h'
  let candidateCandles: CandleProfileSource[] = []
  let takerList: readonly OkxTakerVolumeBucket[] = []

  if (rangeId === '24h') {
    rangeStart = effectiveNow - DAY_MS
    rangeEnd = effectiveNow + 1
    barMs = 900_000
    rangeLabel = '24h'
    candidateCandles = (svpHistory?.candles15m ?? []).filter(
      c => c.time + barMs > rangeStart && c.time < rangeEnd,
    )
    takerList = svpHistory?.taker15m ?? []
  } else if (rangeId === 'today') {
    rangeStart = todayUtcStart
    rangeEnd = effectiveNow + 1
    barMs = 900_000
    rangeLabel = 'Today (UTC)'
    candidateCandles = (svpHistory?.candles15m ?? []).filter(
      c => c.time >= rangeStart && c.time < rangeEnd,
    )
    takerList = svpHistory?.taker15m ?? []
  } else if (rangeId === 'prevDay') {
    rangeStart = prevDayUtcStart
    rangeEnd = todayUtcStart
    barMs = 900_000
    allowLiveOverlay = false
    rangeLabel = 'Prev Day'
    candidateCandles = (svpHistory?.candles15m ?? []).filter(
      c => c.time >= rangeStart && c.time < rangeEnd,
    )
    takerList = svpHistory?.taker15m ?? []
  } else if (rangeId === '3d') {
    rangeStart = effectiveNow - 3 * DAY_MS
    rangeEnd = effectiveNow + 1
    barMs = 3_600_000
    rangeLabel = '3-Day'
    candidateCandles = (svpHistory?.candles1h ?? []).filter(
      c => c.time + barMs > rangeStart && c.time < rangeEnd,
    )
    takerList = svpHistory?.taker1h ?? []
  } else if (rangeId === '7d') {
    rangeStart = effectiveNow - 7 * DAY_MS
    rangeEnd = effectiveNow + 1
    barMs = 3_600_000
    rangeLabel = '7-Day'
    candidateCandles = (svpHistory?.candles1h ?? []).filter(
      c => c.time + barMs > rangeStart && c.time < rangeEnd,
    )
    takerList = svpHistory?.taker1h ?? []
  } else {
    // 'chart': match top timeframe bar using up to 24 backfilled bars + live trades
    const inferredBarMs =
      candles.length > 0 ? Math.max(60_000, candles[0].end - candles[0].start) : 60_000
    barMs = bucketMsParam && bucketMsParam > 0 ? bucketMsParam : inferredBarMs
    rangeLabel = timeframeShort ? `${timeframeShort.toUpperCase()} Chart` : '6-bar'
    const currentBucketStart = Math.floor(effectiveNow / barMs) * barMs
    const currentBucketEnd = currentBucketStart + barMs
    const chartCandles = (backfill?.candles ?? [])
      .filter(c => c.time < currentBucketEnd)
      .slice(-CHART_SVP_BAR_COUNT)

    if (chartCandles.length > 0) {
      const candleFirst = chartCandles[0].time
      const fpFirst = candles.length > 0 ? candles[0].start : candleFirst
      rangeStart = Math.min(candleFirst, fpFirst)
      rangeEnd = Math.max(
        currentBucketEnd,
        candles.length > 0 ? candles[candles.length - 1].end : currentBucketEnd,
      )
      candidateCandles = chartCandles
      takerList = backfill?.takerBuckets ?? []
    } else if (candles.length > 0) {
      rangeStart = candles[0].start
      rangeEnd = candles[candles.length - 1].end
      // Include any already-backfilled FootprintCandle slots that have no raw trades in `trades`
      for (const c of candles) {
        if (
          c.tradeCount > 0 &&
          c.open !== null &&
          c.high !== null &&
          c.low !== null &&
          c.close !== null &&
          c.totalBtc > 0
        ) {
          const hasRawForSlot = allValidTrades.some(t => t.time >= c.start && t.time < c.end)
          if (!hasRawForSlot) {
            candidateCandles.push({
              time: c.start,
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
              volumeBtc: c.totalBtc,
              buyBtc: c.buyBtc,
              sellBtc: c.sellBtc,
            })
          }
        }
      }
    } else {
      rangeStart = currentBucketStart
      rangeEnd = currentBucketEnd
    }
  }

  candidateCandles = [...candidateCandles].sort((a, b) => a.time - b.time)
  const takerMap = new Map<number, OkxTakerVolumeBucket>()
  for (const tb of takerList) takerMap.set(tb.time, tb)

  const windowLiveTrades = allowLiveOverlay
    ? allValidTrades.filter(t => t.time >= rangeStart && t.time < rangeEnd)
    : []

  const liveBySlot = new Map<number, ParsedTrade[]>()
  for (const t of windowLiveTrades) {
    const slotStart = barMs > 0 ? Math.floor(t.time / barMs) * barMs : 0
    const list = liveBySlot.get(slotStart)
    if (list) list.push(t)
    else liveBySlot.set(slotStart, [t])
  }

  const candlesToDistribute: CandleProfileSource[] = []
  const candleCoveredSlots = new Set<number>()

  for (const c of candidateCandles) {
    const slotTrades = barMs > 0 ? liveBySlot.get(c.time) : undefined
    let slotLiveBtc = 0
    if (slotTrades) {
      for (const t of slotTrades) slotLiveBtc += Number(t.sats) / 1e8
    }
    const useExactLiveForSlot =
      allowLiveOverlay &&
      slotTrades !== undefined &&
      slotTrades.length > 0 &&
      (earliestLiveTime <= c.time || (c.volumeBtc > 0 && slotLiveBtc >= c.volumeBtc * 0.9))

    if (!useExactLiveForSlot) {
      candlesToDistribute.push(c)
      candleCoveredSlots.add(c.time)
    }
  }

  const liveTradesToUse: ParsedTrade[] = []
  for (const [slotStart, list] of liveBySlot.entries()) {
    if (!candleCoveredSlots.has(slotStart)) {
      liveTradesToUse.push(...list)
    }
  }
  liveTradesToUse.sort((a, b) => a.time - b.time)

  const emptySourceLabel =
    rangeId === '24h' || rangeId === 'today' || rangeId === 'prevDay'
      ? '15m candles'
      : rangeId === '3d' || rangeId === '7d'
        ? '1H candles'
        : 'Live ticks only'

  if (candlesToDistribute.length === 0 && liveTradesToUse.length === 0) {
    return {
      rangeId,
      rangeLabel,
      sourceLabel: emptySourceLabel,
      candleCount: 0,
      stepUsd: defaultStep,
      totalBtc: 0,
      deltaBtc: 0,
      tradeCount: 0,
      latestPrice: latestLivePrice,
      sessionPocPrice: null,
      sessionPocVolumeBtc: 0,
      sessionVahPrice: null,
      sessionValPrice: null,
      valueStatus: 'waiting',
      prevDayLevels,
      nakedPocMode,
      nakedPocs: [],
      rows: [],
      badge: { label: 'Waiting for trades', tone: 'blue' },
      headline: `Waiting for trades to build ${rangeLabel} Profile`,
      oneLiner: 'Candles and live trades across this range will stack into one Value Area and POC.',
    }
  }

  let minPrice = Infinity
  let maxPrice = -Infinity
  for (const c of candlesToDistribute) {
    const lo = Math.min(c.low, c.open, c.close)
    const hi = Math.max(c.high, c.open, c.close)
    if (lo < minPrice) minPrice = lo
    if (hi > maxPrice) maxPrice = hi
  }
  for (const t of liveTradesToUse) {
    if (t.price < minPrice) minPrice = t.price
    if (t.price > maxPrice) maxPrice = t.price
  }

  const latestCandleClose =
    candidateCandles.length > 0 ? candidateCandles[candidateCandles.length - 1].close : null
  const latestPrice = latestLivePrice ?? latestCandleClose

  if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice) || latestPrice === null) {
    return {
      rangeId,
      rangeLabel,
      sourceLabel: emptySourceLabel,
      candleCount: 0,
      stepUsd: defaultStep,
      totalBtc: 0,
      deltaBtc: 0,
      tradeCount: 0,
      latestPrice,
      sessionPocPrice: null,
      sessionPocVolumeBtc: 0,
      sessionVahPrice: null,
      sessionValPrice: null,
      valueStatus: 'waiting',
      prevDayLevels,
      nakedPocMode,
      nakedPocs: [],
      rows: [],
      badge: { label: 'Waiting for trades', tone: 'blue' },
      headline: `Waiting for trades to build ${rangeLabel} Profile`,
      oneLiner: 'Candles and live trades across this range will stack into one Value Area and POC.',
    }
  }

  const baseStep = chooseSvpStepUsd(maxPrice - minPrice, stepOption)
  const effectiveStep = widenStepForRange(minPrice, maxPrice, baseStep, MAX_SVP_ROWS)
  const minRowIdx = Math.floor(minPrice / effectiveStep)
  const maxRowIdx = Math.floor(maxPrice / effectiveStep)

  const cellMap = new Map<number, { buyBtc: number; sellBtc: number }>()
  for (const c of candlesToDistribute) {
    distributeCandleToCells({
      candle: c,
      taker: takerMap.get(c.time),
      effectiveStep,
      cellMap,
    })
  }

  for (const item of liveTradesToUse) {
    const rowIdx = Math.floor(item.price / effectiveStep)
    const existing = cellMap.get(rowIdx) ?? { buyBtc: 0, sellBtc: 0 }
    const btc = Number(item.sats) / 1e8
    if (item.side === 'buy') existing.buyBtc += btc
    else existing.sellBtc += btc
    cellMap.set(rowIdx, existing)
  }

  const referenceClose =
    rangeId === 'prevDay' && latestCandleClose !== null ? latestCandleClose : latestPrice
  const grid = buildRawProfileGrid({
    cellMap,
    minRowIdx,
    maxRowIdx,
    effectiveStep,
    referenceClose,
  })

  if (grid.totalBtc <= 0) {
    return {
      rangeId,
      rangeLabel,
      sourceLabel: emptySourceLabel,
      candleCount: 0,
      stepUsd: effectiveStep,
      totalBtc: 0,
      deltaBtc: 0,
      tradeCount: 0,
      latestPrice,
      sessionPocPrice: null,
      sessionPocVolumeBtc: 0,
      sessionVahPrice: null,
      sessionValPrice: null,
      valueStatus: 'waiting',
      prevDayLevels,
      nakedPocMode,
      nakedPocs: [],
      rows: [],
      badge: { label: 'Waiting for trades', tone: 'blue' },
      headline: `Waiting for trades to build ${rangeLabel} Profile`,
      oneLiner: 'Candles and live trades across this range will stack into one Value Area and POC.',
    }
  }

  const latestRowPrice = Math.floor(latestPrice / effectiveStep) * effectiveStep
  const ladderMinRowPrice = minRowIdx * effectiveStep
  const ladderMaxRowPrice = maxRowIdx * effectiveStep

  let nakedPocs: NakedPocMagnet[] = []
  if (calendarMagnets?.length) {
    nakedPocs = calendarMagnets.map<NakedPocMagnet>((level, candleIndex) => {
      const rowPrice = Math.floor(level.price / effectiveStep) * effectiveStep
      return {
        candleIndex, candleStart: level.date, price: level.price, rowPrice,
        onLadder: rowPrice >= ladderMinRowPrice && rowPrice <= ladderMaxRowPrice,
        kind: level.period,
        originLabel: `${level.label} · ${new Date(level.date).toISOString().slice(0, 10)}`,
        volumeBtc: level.volumeBtc,
        directionFromClose: level.price > latestPrice ? 'above' : level.price < latestPrice ? 'below' : 'at',
        distanceUsd: Math.round(level.price - latestPrice),
        distancePct: latestPrice > 0 ? (level.price - latestPrice) / latestPrice * 100 : null,
      }
    }).sort((a, b) => Math.abs(a.price - latestPrice) - Math.abs(b.price - latestPrice))
  } else if (nakedPocMode === 'daily' && !hasCalendarHistory) {
    nakedPocs = evaluateDailyNakedPocs({
      candles15m: svpHistory?.candles15m,
      taker15m: svpHistory?.taker15m,
      candles1h: svpHistory?.candles1h,
      taker1h: svpHistory?.taker1h,
      liveTrades: allValidTrades,
      now: effectiveNow,
      latestPrice,
      ladderStepUsd: effectiveStep,
      ladderMinRowPrice,
      ladderMaxRowPrice,
    })
  } else if (nakedPocMode === 'candle') {
    // Candle nPOC detection (used in Chart TF mode or before daily REST history loads)
    const nakedByPrice = new Map<number, NakedPocMagnet>()
    for (let i = 0; i < candles.length - 1; i++) {
      const closedCandle = candles[i]
      if (closedCandle.tradeCount === 0 || closedCandle.pocPrice === null) continue
      const alignedPoc = Math.floor(closedCandle.pocPrice / effectiveStep) * effectiveStep

      let testedLater = false
      for (let j = i + 1; j < candles.length; j++) {
        const later = candles[j]
        if (later.tradeCount === 0 || later.low === null || later.high === null) continue
        const laterLowRow = Math.floor(later.low / effectiveStep) * effectiveStep
        const laterHighRow = Math.floor(later.high / effectiveStep) * effectiveStep
        if (laterLowRow <= alignedPoc && alignedPoc <= laterHighRow) {
          testedLater = true
          break
        }
      }

      if (!testedLater) {
        for (const t of allValidTrades) {
          if (t.time < closedCandle.end) continue
          const tradeRow = Math.floor(t.price / effectiveStep) * effectiveStep
          if (tradeRow === alignedPoc) {
            testedLater = true
            break
          }
        }
      }

      if (!testedLater) {
        const distancePct =
          latestPrice > 0 ? Number((((alignedPoc - latestPrice) / latestPrice) * 100).toFixed(2)) : null
        nakedByPrice.set(alignedPoc, {
          candleIndex: closedCandle.index,
          candleStart: closedCandle.start,
          price: alignedPoc,
          rowPrice: alignedPoc,
          onLadder: alignedPoc >= ladderMinRowPrice && alignedPoc <= ladderMaxRowPrice,
          kind: 'candle',
          originLabel: `${new Date(closedCandle.start).toISOString().slice(11, 16)} UTC`,
          volumeBtc: closedCandle.pocVolumeBtc,
          directionFromClose:
            alignedPoc > latestRowPrice ? 'above' : alignedPoc < latestRowPrice ? 'below' : 'at',
          distanceUsd: Math.round(alignedPoc - latestPrice),
          distancePct,
        })
      }
    }
    nakedPocs = Array.from(nakedByPrice.values()).sort((a, b) => b.candleIndex - a.candleIndex)
  }

  const nakedByRowPrice = new Map<number, NakedPocMagnet[]>()
  for (const n of nakedPocs) {
    if (!n.onLadder) continue
    const list = nakedByRowPrice.get(n.rowPrice)
    if (list) list.push(n)
    else nakedByRowPrice.set(n.rowPrice, [n])
  }

  const showPrevMarkers = rangeId !== 'prevDay' && prevDayLevels !== null
  const prevPocRow = showPrevMarkers
    ? Math.floor(prevDayLevels.pocPrice / effectiveStep) * effectiveStep
    : null
  const prevVahRow = showPrevMarkers
    ? Math.floor(prevDayLevels.vahPrice / effectiveStep) * effectiveStep
    : null
  const prevValRow = showPrevMarkers
    ? Math.floor(prevDayLevels.valPrice / effectiveStep) * effectiveStep
    : null

  const rows: SessionProfileRow[] = grid.rawRows.map((row, r) => {
    const buySharePct = row.totalBtc > 0 ? Math.round((row.buyBtc / row.totalBtc) * 100) : 0
    const sellSharePct = row.totalBtc > 0 ? 100 - buySharePct : 0
    const rowMagnets = nakedByRowPrice.get(row.price) ?? []
    return {
      ...row,
      totalWidthPct:
        grid.maxRowTotalBtc > 0 && row.totalBtc > 0
          ? Math.max(4, Math.round((row.totalBtc / grid.maxRowTotalBtc) * 100))
          : 0,
      buySharePct,
      sellSharePct,
      isSessionPoc: r === grid.pocIdx,
      isVah: row.price === grid.vahPrice,
      isVal: row.price === grid.valPrice,
      inValueArea: grid.vaIndices.has(r),
      isLatestRow: row.price === latestRowPrice,
      isNakedPoc: rowMagnets.length > 0,
      nakedPocCount: rowMagnets.length,
      nakedPocLabels: rowMagnets.map(n => `${n.originLabel} (${formatPriceInt(n.price)})`),
      isPrevDayPoc: prevPocRow !== null && row.price === prevPocRow,
      isPrevDayVah: prevVahRow !== null && row.price === prevVahRow,
      isPrevDayVal: prevValRow !== null && row.price === prevValRow,
    }
  })

  const valueStatus: SessionProfileEvaluation['valueStatus'] =
    latestRowPrice > grid.vahPrice ? 'above' : latestRowPrice < grid.valPrice ? 'below' : 'inside'

  const magnetLabel = 'NPOC'
  const magnetNote = nakedPocs[0]
    ? `, with an untested ${formatPriceInt(nakedPocs[0].price)} ${magnetLabel} magnet`
    : ''

  let badge: SessionProfileEvaluation['badge']
  let headline: string
  let oneLiner: string

  if (valueStatus === 'above') {
    badge = {
      label:
        nakedPocs.length > 0
          ? `Above Value · ${nakedPocs.length} magnet${nakedPocs.length === 1 ? '' : 's'}`
          : 'Above Value Area',
      tone: 'teal',
    }
    headline = `Price accepted above the ${rangeLabel} Value Area`
    oneLiner = `Holding above ${formatPriceInt(grid.vahPrice)} VAH — buyers hold control${magnetNote}.`
  } else if (valueStatus === 'below') {
    badge = {
      label:
        nakedPocs.length > 0
          ? `Below Value · ${nakedPocs.length} magnet${nakedPocs.length === 1 ? '' : 's'}`
          : 'Below Value Area',
      tone: 'rose',
    }
    headline = `Price pressing below the ${rangeLabel} Value Area`
    oneLiner = `Trading below ${formatPriceInt(grid.valPrice)} VAL — sellers hold control${magnetNote}.`
  } else {
    badge = {
      label:
        nakedPocs.length > 0
          ? `${nakedPocs.length} Naked POC${nakedPocs.length === 1 ? '' : 's'}`
          : 'Inside Value Area',
      tone: nakedPocs.length > 0 ? 'amber' : 'blue',
    }
    headline =
      nakedPocs.length > 0
        ? `Price inside ${rangeLabel} value — untested POC magnet active`
        : `Price balancing around the ${rangeLabel} POC`
    oneLiner = nakedPocs[0]
      ? `Trading inside ${formatPriceInt(grid.valPrice)}–${formatPriceInt(grid.vahPrice)} with ${nakedPocs.length} untested ${magnetLabel}${nakedPocs.length === 1 ? '' : 's'} (nearest ${formatPriceInt(nakedPocs[0].price)}).`
      : `70% of ${rangeLabel} volume traded between ${formatPriceInt(grid.valPrice)} and ${formatPriceInt(grid.vahPrice)} around ${formatPriceInt(grid.pocPrice)} POC.`
  }

  const hasCandles = candlesToDistribute.length > 0
  const hasLive = liveTradesToUse.length > 0
  const sourceLabel =
    rangeId === '24h' || rangeId === 'today' || rangeId === 'prevDay'
      ? hasCandles && hasLive
        ? '15m candles + live'
        : hasCandles
          ? '15m candles'
          : 'Live ticks only'
      : rangeId === '3d' || rangeId === '7d'
        ? hasCandles && hasLive
          ? '1H candles + live'
          : hasCandles
            ? '1H candles'
            : 'Live ticks only'
        : hasCandles && hasLive
          ? 'Backfill + live'
          : hasCandles
            ? 'Candle backfill'
            : 'Live ticks only'

  let liveOnlySlotsCount = 0
  for (const slotStart of liveBySlot.keys()) {
    if (!candleCoveredSlots.has(slotStart)) liveOnlySlotsCount++
  }
  const candleCount = candlesToDistribute.length + liveOnlySlotsCount
  const tradeCount =
    liveTradesToUse.length +
    candlesToDistribute.reduce((sum, c) => sum + Math.max(1, Math.round(c.volumeBtc * 10)), 0)

  return {
    rangeId,
    rangeLabel,
    sourceLabel,
    candleCount,
    stepUsd: effectiveStep,
    totalBtc: grid.totalBtc,
    deltaBtc: grid.deltaBtc,
    tradeCount,
    latestPrice,
    sessionPocPrice: grid.pocPrice,
    sessionPocVolumeBtc: grid.pocVolumeBtc,
    sessionVahPrice: grid.vahPrice,
    sessionValPrice: grid.valPrice,
    valueStatus,
    prevDayLevels,
    nakedPocMode,
    nakedPocs,
    rows,
    badge,
    headline,
    oneLiner,
  }
}

export type FpbsBarSignalKind =
  | 'trapped-buyers'
  | 'trapped-sellers'
  | 'buy-absorption'
  | 'sell-absorption'
  | 'buyers-driving'
  | 'sellers-driving'
  | 'balanced'
  | 'empty'

export type FpbsColumn = {
  source: FootprintSource
  priceChangePct: number | null
  index: number
  start: number
  end: number
  isDeveloping: boolean
  tradeCount: number
  volumeBtc: number
  deltaBtc: number
  deltaPct: number
  maxDeltaBtc: number
  minDeltaBtc: number
  cvdBtc: number
  pocPrice: number | null
  volumeIntensityPct: number
  deltaIntensityPct: number
  signalKind: FpbsBarSignalKind
  signalLabel: string
  signalTone: 'teal' | 'rose' | 'amber' | 'blue'
}

export type FpbsEvaluation = {
  columns: FpbsColumn[]
  windowVolumeBtc: number
  windowCvdBtc: number
  windowDeltaPct: number
  totalTradeCount: number
  trapOrWallCount: number
  latestTrapOrWall: FpbsColumn | null
  peakConvictionCol: FpbsColumn | null
  badge: { label: string; tone: 'teal' | 'rose' | 'amber' | 'blue' }
  headline: string
  oneLiner: string
}

export function evaluateFpbsStats(
  candles: readonly FootprintCandle[],
  exchangeBars: readonly FootprintCandle[] = [],
): FpbsEvaluation {
  const historical = new Map(exchangeBars.map(bar => [bar.start, bar]))
  candles = candles.map(bar => {
    const exchangeBar = historical.get(bar.start)
    return !bar.isDeveloping && exchangeBar?.source === 'exchange-totals' ? exchangeBar : bar
  })
  const maxVol = Math.max(...candles.map(c => c.totalBtc), 0)
  const maxAbsDelta = Math.max(...candles.map(c => Math.abs(c.deltaBtc)), 0)

  let runningCvdBtc = 0
  let windowVolumeBtc = 0
  let totalTradeCount = 0

  const columns: FpbsColumn[] = candles.map(c => {
    const source = c.tradeCount === 0 ? 'missing' : c.source ?? 'trade-sample'
    runningCvdBtc += c.deltaBtc
    windowVolumeBtc += c.totalBtc
    totalTradeCount += c.tradeCount

    let signalKind: FpbsBarSignalKind
    let signalLabel: string
    let signalTone: FpbsColumn['signalTone']

    if (c.tradeCount === 0) {
      signalKind = 'empty'
      signalLabel = '—'
      signalTone = 'blue'
    } else if (
      source === 'trade-sample' &&
      c.maxDeltaBtc >= 0.25 &&
      c.deltaBtc < 0 &&
      c.close !== null &&
      c.pocPrice !== null &&
      c.close <= c.pocPrice
    ) {
      signalKind = 'trapped-buyers'
      signalLabel = 'Delta turned negative'
      signalTone = 'rose'
    } else if (
      source === 'trade-sample' &&
      c.minDeltaBtc <= -0.25 &&
      c.deltaBtc > 0 &&
      c.close !== null &&
      c.pocPrice !== null &&
      c.close >= c.pocPrice
    ) {
      signalKind = 'trapped-sellers'
      signalLabel = 'Delta turned positive'
      signalTone = 'teal'
    } else if (source !== 'candle-estimate' && c.deltaBtc >= 0.15 && c.open !== null && c.close !== null && c.close < c.open) {
      signalKind = 'sell-absorption'
      signalLabel = 'Price fell on net buying'
      signalTone = 'amber'
    } else if (source !== 'candle-estimate' && c.deltaBtc <= -0.15 && c.open !== null && c.close !== null && c.close > c.open) {
      signalKind = 'buy-absorption'
      signalLabel = 'Price rose on net selling'
      signalTone = 'amber'
    } else if (c.deltaPct >= 15) {
      signalKind = 'buyers-driving'
      signalLabel = '🟢 Buyers'
      signalTone = 'teal'
    } else if (c.deltaPct <= -15) {
      signalKind = 'sellers-driving'
      signalLabel = '🔴 Sellers'
      signalTone = 'rose'
    } else {
      signalKind = 'balanced'
      signalLabel = '⚖️ Balanced'
      signalTone = 'blue'
    }

    return {
      source,
      priceChangePct: c.open !== null && c.open > 0 && c.close !== null
        ? ((c.close - c.open) / c.open) * 100
        : null,
      index: c.index,
      start: c.start,
      end: c.end,
      isDeveloping: c.isDeveloping,
      tradeCount: c.tradeCount,
      volumeBtc: c.totalBtc,
      deltaBtc: c.deltaBtc,
      deltaPct: c.deltaPct,
      maxDeltaBtc: c.maxDeltaBtc,
      minDeltaBtc: c.minDeltaBtc,
      cvdBtc: runningCvdBtc,
      pocPrice: c.pocPrice,
      volumeIntensityPct: maxVol > 0 && c.totalBtc > 0 ? Math.max(8, Math.round((c.totalBtc / maxVol) * 100)) : 0,
      deltaIntensityPct:
        maxAbsDelta > 0 && Math.abs(c.deltaBtc) > 0
          ? Math.max(8, Math.round((Math.abs(c.deltaBtc) / maxAbsDelta) * 100))
          : 0,
      signalKind,
      signalLabel,
      signalTone,
    }
  })

  const trapOrWallCols = columns.filter(
    col =>
      col.signalKind === 'trapped-buyers' ||
      col.signalKind === 'trapped-sellers' ||
      col.signalKind === 'buy-absorption' ||
      col.signalKind === 'sell-absorption',
  )
  const latestTrapOrWall = trapOrWallCols.length > 0 ? trapOrWallCols[trapOrWallCols.length - 1] : null

  let peakConvictionCol: FpbsColumn | null = null
  for (const col of columns) {
    if (col.tradeCount === 0) continue
    if (!peakConvictionCol || Math.abs(col.deltaBtc) >= Math.abs(peakConvictionCol.deltaBtc)) {
      peakConvictionCol = col
    }
  }

  const windowCvdBtc = runningCvdBtc
  const windowDeltaPct = windowVolumeBtc > 0 ? (windowCvdBtc / windowVolumeBtc) * 100 : 0

  let badge: FpbsEvaluation['badge']
  let headline: string
  let oneLiner: string

  if (totalTradeCount === 0) {
    badge = { label: 'Waiting for trades', tone: 'blue' }
    headline = 'Waiting for live trades to populate 6-Bar Stats'
    oneLiner =
      'Tracks Volume, Delta %, Max/Min intrabar delta excursions, and Running CVD across all 6 bars.'
  } else if (latestTrapOrWall) {
    const timeLabel = latestTrapOrWall.isDeveloping
      ? 'live bar'
      : `${new Date(latestTrapOrWall.start).toISOString().slice(11, 16)} UTC`
    badge = {
      label: `${trapOrWallCols.length} flagged ${trapOrWallCols.length === 1 ? 'bar' : 'bars'}`,
      tone: latestTrapOrWall.signalTone,
    }
    headline = `${latestTrapOrWall.signalLabel} · ${timeLabel}`
    oneLiner = `6-bar Running CVD is ${formatSignedBtc(windowCvdBtc)} ₿ across ${windowVolumeBtc.toFixed(2)} ₿ volume, with ${latestTrapOrWall.signalLabel} on ${timeLabel}.`
  } else if (windowCvdBtc > 0) {
    badge = { label: 'Net buying flow', tone: 'teal' }
    headline = '6-bar Running CVD favors buyers'
    oneLiner = `Running CVD stands at ${formatSignedBtc(windowCvdBtc)} ₿ (${windowDeltaPct >= 0 ? '+' : ''}${Math.round(windowDeltaPct)}%) across ${windowVolumeBtc.toFixed(2)} ₿ traded.`
  } else if (windowCvdBtc < 0) {
    badge = { label: 'Net selling flow', tone: 'rose' }
    headline = '6-bar Running CVD favors sellers'
    oneLiner = `Running CVD stands at ${formatSignedBtc(windowCvdBtc)} ₿ (${Math.round(windowDeltaPct)}%) across ${windowVolumeBtc.toFixed(2)} ₿ traded.`
  } else {
    badge = { label: 'Balanced 6-bar flow', tone: 'blue' }
    headline = '6-bar Running CVD is evenly balanced'
    oneLiner = `Buyers and sellers are matched across ${windowVolumeBtc.toFixed(2)} ₿ traded in this 6-bar window.`
  }

  return {
    columns,
    windowVolumeBtc,
    windowCvdBtc,
    windowDeltaPct,
    totalTradeCount,
    trapOrWallCount: trapOrWallCols.length,
    latestTrapOrWall,
    peakConvictionCol,
    badge,
    headline,
    oneLiner,
  }
}

function escapeCsvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`
  return value
}

export function formatFpbsCsv(fpbs: FpbsEvaluation): string {
  const header =
    'Time (UTC),State,Trades,Volume (BTC),Delta (BTC),Delta (%),Max Delta (BTC),Min Delta (BTC),Running CVD (BTC),POC (USD),Signal,Source'
  const lines = fpbs.columns.map(col =>
    [
      new Date(col.start).toISOString().slice(11, 16),
      col.isDeveloping ? 'Live' : 'Closed',
      col.source === 'trade-sample' ? String(col.tradeCount) : '',
      col.source !== 'missing' ? col.volumeBtc.toFixed(4) : '',
      col.source !== 'missing' ? col.deltaBtc.toFixed(4) : '',
      col.source !== 'missing' ? col.deltaPct.toFixed(1) : '',
      col.source === 'trade-sample' ? col.maxDeltaBtc.toFixed(4) : '',
      col.source === 'trade-sample' ? col.minDeltaBtc.toFixed(4) : '',
      col.source !== 'missing' ? col.cvdBtc.toFixed(4) : '',
      col.source === 'trade-sample' && col.pocPrice !== null ? String(Math.round(col.pocPrice)) : '',
      col.signalLabel,
      col.source,
    ]
      .map(escapeCsvCell)
      .join(','),
  )
  return [header, ...lines].join('\n')
}



