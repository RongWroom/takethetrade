import { btcToSatoshis, type Trade } from './tradeEngine'

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

export type FootprintCandle = {
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
const WIDEN_STEPS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000] as const
const IMBALANCE_MIN_BTC = 0.05
const IMBALANCE_RATIO = 3
const MAX_CANDLE_ROWS = 15

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

function widenStepForRange(minPrice: number, maxPrice: number, baseStep: number): number {
  const candidates = WIDEN_STEPS.filter(s => s >= baseStep)
  for (const step of candidates) {
    const minIdx = Math.floor(minPrice / step)
    const maxIdx = Math.floor(maxPrice / step)
    if (maxIdx - minIdx + 1 <= MAX_CANDLE_ROWS) return step
  }
  return WIDEN_STEPS[WIDEN_STEPS.length - 1]
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
      close >= pocPrice ? 'Buyers won the fight above POC' : 'Buyers pushing harder on the ask'
    const imbNote =
      buyImbalanceCount > 0
        ? ` with ${buyImbalanceCount} strong buy imbalance${buyImbalanceCount === 1 ? '' : 's'}`
        : ''
    return {
      badge: { label: 'Buyers in control', tone: 'teal' },
      headline,
      oneLiner: `Market buyers led by ${formatSignedBtc(deltaBtc)} ₿${imbNote} around the ${pocText} POC.`,
    }
  }

  if (deltaPct <= -15 || (deltaBtc < 0 && sellImbalanceCount > buyImbalanceCount && close <= pocPrice)) {
    const headline =
      close <= pocPrice ? 'Sellers won the fight below POC' : 'Sellers pressing harder on the bid'
    const imbNote =
      sellImbalanceCount > 0
        ? ` with ${sellImbalanceCount} strong sell imbalance${sellImbalanceCount === 1 ? '' : 's'}`
        : ''
    return {
      badge: { label: 'Sellers in control', tone: 'rose' },
      headline,
      oneLiner: `Market sellers led by ${formatSignedBtc(deltaBtc)} ₿${imbNote} around the ${pocText} POC.`,
    }
  }

  if (Math.abs(deltaPct) < 15 && (buyImbalanceCount > 0 || sellImbalanceCount > 0)) {
    return {
      badge: { label: 'Heavy clash', tone: 'amber' },
      headline: 'Passive wall soaking up aggressive orders',
      oneLiner: `Both sides clashed around the ${pocText} POC, leaving net flow near flat (${formatSignedBtc(deltaBtc)} ₿).`,
    }
  }

  return {
    badge: { label: 'Balanced fight', tone: 'blue' },
    headline: 'Even tug-of-war around POC',
    oneLiner: `Buyers and sellers are trading evenly around ${pocText} with no decisive breakout yet.`,
  }
}

export function evaluateFootprint(params: {
  trades: readonly FootprintTrade[]
  now: number
  bucketMs: number
  stepOption?: FootprintStepOption
  candleCount?: number
}): FootprintEvaluation {
  const { trades, now, bucketMs, stepOption = 'auto', candleCount = 6 } = params
  const safeBucketMs = bucketMs > 0 ? bucketMs : 60_000
  const currentStart = Math.floor(now / safeBucketMs) * safeBucketMs
  const firstStart = currentStart - (candleCount - 1) * safeBucketMs

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
  for (const list of bucketed) {
    if (list.length === 0) continue
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

    const totalBtc = Number(buySats + sellSats) / 1e8
    const pocIdx = findPocIndex(rawRows, close)
    const { vaIndices, vahPrice, valPrice } = computeValueArea(rawRows, pocIdx, totalBtc)

    const closeRowPrice = Math.floor(close / effectiveStep) * effectiveStep
    let buyImbalanceCount = 0
    let sellImbalanceCount = 0

    const rows: FootprintRow[] = rawRows.map((row, r) => {
      const compareSell = rawRows[r + 1]?.sellBtc ?? row.sellBtc
      const compareBuy = rawRows[r - 1]?.buyBtc ?? row.buyBtc

      let imbalance: FootprintRow['imbalance'] = null
      if (row.buyBtc >= IMBALANCE_MIN_BTC && row.buyBtc >= IMBALANCE_RATIO * compareSell) {
        imbalance = 'buy'
        buyImbalanceCount++
      } else if (row.sellBtc >= IMBALANCE_MIN_BTC && row.sellBtc >= IMBALANCE_RATIO * compareBuy) {
        imbalance = 'sell'
        sellImbalanceCount++
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

    const buyBtc = Number(buySats) / 1e8
    const sellBtc = Number(sellSats) / 1e8
    const deltaBtc = Number(buySats - sellSats) / 1e8
    const deltaPct = totalBtc > 0 ? (deltaBtc / totalBtc) * 100 : 0
    const maxDeltaBtc = Number(maxDeltaSats) / 1e8
    const minDeltaBtc = Number(minDeltaSats) / 1e8
    const pocPrice = rawRows[pocIdx].price
    const pocVolumeBtc = rawRows[pocIdx].totalBtc

    const verdict = buildCandleVerdict({
      tradeCount: list.length,
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
      tradeCount: list.length,
      stepUsd: effectiveStep,
      pocPrice,
      pocVolumeBtc,
      vahPrice,
      valPrice,
      buyImbalanceCount,
      sellImbalanceCount,
      rows,
      ...verdict,
    }
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

export type NakedPocMagnet = {
  candleIndex: number
  candleStart: number
  price: number
  volumeBtc: number
  directionFromClose: 'above' | 'below' | 'at'
  distanceUsd: number
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
}

export type SessionProfileEvaluation = {
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
  nakedPocs: NakedPocMagnet[]
  rows: SessionProfileRow[]
  badge: { label: string; tone: 'teal' | 'rose' | 'amber' | 'blue' }
  headline: string
  oneLiner: string
}

export function evaluateSessionProfile(params: {
  trades: readonly FootprintTrade[]
  candles: readonly FootprintCandle[]
  stepOption?: FootprintStepOption
}): SessionProfileEvaluation {
  const { trades, candles, stepOption = 'auto' } = params
  const defaultStep = stepOption === 'auto' ? 10 : stepOption

  if (candles.length === 0) {
    return {
      stepUsd: defaultStep,
      totalBtc: 0,
      deltaBtc: 0,
      tradeCount: 0,
      latestPrice: null,
      sessionPocPrice: null,
      sessionPocVolumeBtc: 0,
      sessionVahPrice: null,
      sessionValPrice: null,
      valueStatus: 'waiting',
      nakedPocs: [],
      rows: [],
      badge: { label: 'Waiting for trades', tone: 'blue' },
      headline: 'Waiting for live trades to build Session Profile',
      oneLiner: 'Trades across this window will stack into one price profile with Value Area and Naked POC magnets.',
    }
  }

  const windowStart = candles[0].start
  const windowEnd = candles[candles.length - 1].end

  type ParsedTrade = { time: number; price: number; side: 'buy' | 'sell'; sats: bigint }
  const validTrades: ParsedTrade[] = []
  let minPrice = Infinity
  let maxPrice = -Infinity
  let buySats = 0n
  let sellSats = 0n

  for (const t of trades) {
    if (t.time < windowStart || t.time >= windowEnd) continue
    const price = Number(t.price)
    if (!Number.isFinite(price) || price <= 0) continue
    const sats = parseTradeSats(t.quantityBtc)
    if (sats === null) continue

    validTrades.push({ time: t.time, price, side: t.side, sats })
    if (price < minPrice) minPrice = price
    if (price > maxPrice) maxPrice = price
    if (t.side === 'buy') buySats += sats
    else sellSats += sats
  }

  if (validTrades.length === 0) {
    return {
      stepUsd: defaultStep,
      totalBtc: 0,
      deltaBtc: 0,
      tradeCount: 0,
      latestPrice: null,
      sessionPocPrice: null,
      sessionPocVolumeBtc: 0,
      sessionVahPrice: null,
      sessionValPrice: null,
      valueStatus: 'waiting',
      nakedPocs: [],
      rows: [],
      badge: { label: 'Waiting for trades', tone: 'blue' },
      headline: 'Waiting for live trades to build Session Profile',
      oneLiner: 'Trades across this window will stack into one price profile with Value Area and Naked POC magnets.',
    }
  }

  validTrades.sort((a, b) => a.time - b.time)
  const latestPrice = validTrades[validTrades.length - 1].price

  const baseStep = chooseStepUsd([maxPrice - minPrice], stepOption)
  const effectiveStep = widenStepForRange(minPrice, maxPrice, baseStep)
  const minRowIdx = Math.floor(minPrice / effectiveStep)
  const maxRowIdx = Math.floor(maxPrice / effectiveStep)

  const cellMap = new Map<number, { buySats: bigint; sellSats: bigint }>()
  for (const item of validTrades) {
    const rowIdx = Math.floor(item.price / effectiveStep)
    const existing = cellMap.get(rowIdx) ?? { buySats: 0n, sellSats: 0n }
    if (item.side === 'buy') existing.buySats += item.sats
    else existing.sellSats += item.sats
    cellMap.set(rowIdx, existing)
  }

  const rawRows: RawFootprintCell[] = []
  let maxRowTotalBtc = 0

  for (let idx = maxRowIdx; idx >= minRowIdx; idx--) {
    const cell = cellMap.get(idx)
    const rowBuyBtc = cell ? Number(cell.buySats) / 1e8 : 0
    const rowSellBtc = cell ? Number(cell.sellSats) / 1e8 : 0
    const rowTotalBtc = rowBuyBtc + rowSellBtc
    const rowDeltaBtc = rowBuyBtc - rowSellBtc
    if (rowTotalBtc > maxRowTotalBtc) maxRowTotalBtc = rowTotalBtc
    rawRows.push({
      price: idx * effectiveStep,
      buyBtc: rowBuyBtc,
      sellBtc: rowSellBtc,
      totalBtc: rowTotalBtc,
      deltaBtc: rowDeltaBtc,
    })
  }

  const totalBtc = Number(buySats + sellSats) / 1e8
  const deltaBtc = Number(buySats - sellSats) / 1e8
  const pocIdx = findPocIndex(rawRows, latestPrice)
  const { vaIndices, vahPrice, valPrice } = computeValueArea(rawRows, pocIdx, totalBtc)
  const sessionPocPrice = rawRows[pocIdx].price
  const sessionPocVolumeBtc = rawRows[pocIdx].totalBtc
  const latestRowPrice = Math.floor(latestPrice / effectiveStep) * effectiveStep

  // Naked POC detection: prior closed-candle POCs never revisited by later candles
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
      nakedByPrice.set(alignedPoc, {
        candleIndex: closedCandle.index,
        candleStart: closedCandle.start,
        price: alignedPoc,
        volumeBtc: closedCandle.pocVolumeBtc,
        directionFromClose:
          alignedPoc > latestRowPrice ? 'above' : alignedPoc < latestRowPrice ? 'below' : 'at',
        distanceUsd: Math.round(alignedPoc - latestPrice),
      })
    }
  }

  const nakedPocs = Array.from(nakedByPrice.values()).sort((a, b) => b.candleIndex - a.candleIndex)
  const nakedPriceSet = new Set(nakedPocs.map(n => n.price))

  const rows: SessionProfileRow[] = rawRows.map((row, r) => {
    const buySharePct = row.totalBtc > 0 ? Math.round((row.buyBtc / row.totalBtc) * 100) : 0
    const sellSharePct = row.totalBtc > 0 ? 100 - buySharePct : 0
    return {
      ...row,
      totalWidthPct:
        maxRowTotalBtc > 0 && row.totalBtc > 0 ? Math.max(4, Math.round((row.totalBtc / maxRowTotalBtc) * 100)) : 0,
      buySharePct,
      sellSharePct,
      isSessionPoc: r === pocIdx,
      isVah: row.price === vahPrice,
      isVal: row.price === valPrice,
      inValueArea: vaIndices.has(r),
      isLatestRow: row.price === latestRowPrice,
      isNakedPoc: nakedPriceSet.has(row.price),
    }
  })

  const valueStatus: SessionProfileEvaluation['valueStatus'] =
    latestRowPrice > vahPrice ? 'above' : latestRowPrice < valPrice ? 'below' : 'inside'

  const magnetNote = nakedPocs[0] ? `, with an untested ${formatPriceInt(nakedPocs[0].price)} nPOC magnet` : ''

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
    headline = 'Price accepted above the 6-bar Value Area'
    oneLiner = `Holding above ${formatPriceInt(vahPrice)} VAH — buyers hold control${magnetNote}.`
  } else if (valueStatus === 'below') {
    badge = {
      label:
        nakedPocs.length > 0
          ? `Below Value · ${nakedPocs.length} magnet${nakedPocs.length === 1 ? '' : 's'}`
          : 'Below Value Area',
      tone: 'rose',
    }
    headline = 'Price pressing below the 6-bar Value Area'
    oneLiner = `Trading below ${formatPriceInt(valPrice)} VAL — sellers hold control${magnetNote}.`
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
        ? 'Price inside value — untested POC magnet active'
        : 'Price balancing around the Session POC'
    oneLiner = nakedPocs[0]
      ? `Trading inside ${formatPriceInt(valPrice)}–${formatPriceInt(vahPrice)} with an untested ${formatPriceInt(nakedPocs[0].price)} nPOC magnet.`
      : `70% of window volume traded between ${formatPriceInt(valPrice)} and ${formatPriceInt(vahPrice)} around ${formatPriceInt(sessionPocPrice)} POC.`
  }

  return {
    stepUsd: effectiveStep,
    totalBtc,
    deltaBtc,
    tradeCount: validTrades.length,
    latestPrice,
    sessionPocPrice,
    sessionPocVolumeBtc,
    sessionVahPrice: vahPrice,
    sessionValPrice: valPrice,
    valueStatus,
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

export function evaluateFpbsStats(candles: readonly FootprintCandle[]): FpbsEvaluation {
  const maxVol = Math.max(...candles.map(c => c.totalBtc), 0)
  const maxAbsDelta = Math.max(...candles.map(c => Math.abs(c.deltaBtc)), 0)

  let runningCvdBtc = 0
  let windowVolumeBtc = 0
  let totalTradeCount = 0

  const columns: FpbsColumn[] = candles.map(c => {
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
      c.maxDeltaBtc >= 0.25 &&
      c.deltaBtc < 0 &&
      c.close !== null &&
      c.pocPrice !== null &&
      c.close <= c.pocPrice
    ) {
      signalKind = 'trapped-buyers'
      signalLabel = '🪤 Buyer Trap'
      signalTone = 'rose'
    } else if (
      c.minDeltaBtc <= -0.25 &&
      c.deltaBtc > 0 &&
      c.close !== null &&
      c.pocPrice !== null &&
      c.close >= c.pocPrice
    ) {
      signalKind = 'trapped-sellers'
      signalLabel = '🪤 Short Trap'
      signalTone = 'teal'
    } else if (c.deltaBtc >= 0.15 && c.open !== null && c.close !== null && c.close < c.open) {
      signalKind = 'sell-absorption'
      signalLabel = '🧱 Sell Wall'
      signalTone = 'amber'
    } else if (c.deltaBtc <= -0.15 && c.open !== null && c.close !== null && c.close > c.open) {
      signalKind = 'buy-absorption'
      signalLabel = '🛡️ Buy Floor'
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
      label: `${trapOrWallCols.length} trap/wall ${trapOrWallCols.length === 1 ? 'bar' : 'bars'}`,
      tone: latestTrapOrWall.signalTone,
    }
    headline = `${latestTrapOrWall.signalLabel} detected on ${timeLabel}`
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
    'Time (UTC),State,Trades,Volume (BTC),Delta (BTC),Delta (%),Max Delta (BTC),Min Delta (BTC),Running CVD (BTC),POC (USD),Signal'
  const lines = fpbs.columns.map(col =>
    [
      new Date(col.start).toISOString().slice(11, 16),
      col.isDeveloping ? 'Live' : 'Closed',
      String(col.tradeCount),
      col.volumeBtc.toFixed(4),
      col.deltaBtc.toFixed(4),
      col.deltaPct.toFixed(1),
      col.maxDeltaBtc.toFixed(4),
      col.minDeltaBtc.toFixed(4),
      col.cvdBtc.toFixed(4),
      col.pocPrice !== null ? String(Math.round(col.pocPrice)) : '',
      col.signalLabel,
    ]
      .map(escapeCsvCell)
      .join(','),
  )
  return [header, ...lines].join('\n')
}



