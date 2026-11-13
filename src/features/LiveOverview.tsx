import { useEffect, useRef, useState } from 'react'
import {
  getTimeframeOption,
  normalizeOkxCandles,
  normalizeOkxFundingRate,
  normalizeOkxLiquidationOrders,
  normalizeOkxLongShortRatio,
  normalizeOkxOiHistory,
  normalizeOkxOpenInterest,
  normalizeOkxTakerVolume,
  normalizeOkxTrade,
  type Liquidation,
  type OkxCandlePoint,
  type OkxOiHistoryPoint,
  type OkxTakerVolumeBucket,
  type TimeframeId,
  type TimeframeOption,
} from '../data/okx'
import {
  calculateCvdMedianProfile,
  evaluateOiRegime,
  replayTrades,
  scaleSparklineBars,
  type OiRegimeEvaluation,
  type PulseEvaluation,
  type Trade,
} from '../domain/tradeEngine'
import { calcAtrPct, calcVwap, type MarketSnapshot } from '../domain/tradeCheck'
import {
  LIQUIDATION_LARGE_USD,
  SIGNAL_RULES,
  SignalConfirmation,
  type ConfirmationMode,
  type ConfirmationView,
} from '../domain/signalConfirmation'
import type { Metric } from '../fixtures/demo'

const minute = 60_000

const formatSignedBtc = (n: bigint) => {
  const sign = n < 0n ? '-' : '+'
  const abs = n < 0n ? -n : n
  const btc = Number(abs) / 100_000_000
  if (btc === 0) return '0.00 BTC'
  if (btc >= 100) return `${sign}${btc.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} BTC`
  if (btc >= 1) return `${sign}${btc.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} BTC`
  if (btc >= 0.01) return `${sign}${btc.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} BTC`
  return `${sign}${btc.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 })} BTC`
}

const formatOiBtc = (oi: string) => {
  const num = Number(oi)
  if (!Number.isFinite(num)) return `${oi} BTC`
  return `${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} BTC`
}

const formatUsdCompact = (usd: number) => {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}K`
  return `$${Math.round(usd).toLocaleString('en-US')}`
}

const formatPrice = (px: string) => {
  const num = Number(px)
  if (!Number.isFinite(num)) return `$${px}`
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export type MarketEventItem = {
  id: string
  kind: 'liquidation' | 'flow'
  tag: string
  title: string
  value: string
  color: 'rose' | 'teal' | 'amber' | 'blue'
  description: string
  time: number
}

export type LiveDashboardState = {
  status: string
  price: string | null
  rawPrice: string | null
  timeframe: TimeframeId
  timeframeLabel: string
  anchor: number
  updated: number | null
  gap: boolean
  oiTime: number | null
  oiStale: boolean
  metrics: Metric[]
  pulse: PulseEvaluation
  oiRegime: OiRegimeEvaluation
  events: MarketEventItem[]
  snapshot: MarketSnapshot
  confirmation: ConfirmationView
}

const emptyOiRegime = evaluateOiRegime({
  priceStart: null,
  priceEnd: null,
  volumeSeriesBtc: [],
  oiStartBtc: null,
  oiEndBtc: null,
})

/** Slower-moving context for the My Trade check, refreshed every few minutes over public REST. */
type TradeContext = {
  vwap: number | null
  atrPct: number | null
  trendPct: number | null
  lsRatio: number | null
  lsRatioAvg: number | null
}

const emptyContext: TradeContext = { vwap: null, atrPct: null, trendPct: null, lsRatio: null, lsRatioAvg: null }

const emptySnapshot = (timeframeLabel: string): MarketSnapshot => ({
  price: null,
  priceStart: null,
  deltaBtc: null,
  cvdBtc: null,
  volumeBtc: null,
  oiRegimeId: null,
  vwap: null,
  atrPct: null,
  fundingRate: null,
  lsRatio: null,
  lsRatioAvg: null,
  trendPct: null,
  recentLongLiqUsd: 0,
  recentShortLiqUsd: 0,
  timeframeLabel,
})

async function fetchTradeContext(signal: AbortSignal): Promise<{ context: TradeContext; fundingRate: number | null }> {
  const get = (url: string) =>
    fetch(url, { signal })
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null)
  const [m15, h1, ls, funding] = await Promise.all([
    get('https://www.okx.com/api/v5/market/candles?instId=BTC-USDT-SWAP&bar=15m&limit=24'),
    get('https://www.okx.com/api/v5/market/candles?instId=BTC-USDT-SWAP&bar=1H&limit=7'),
    get('https://www.okx.com/api/v5/rubik/stat/contracts/long-short-account-ratio-contract?instId=BTC-USDT-SWAP&period=5m&limit=13'),
    get('https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP'),
  ])
  const c15 = normalizeOkxCandles(m15?.data)
  const c1h = normalizeOkxCandles(h1?.data)
  const lsPts = normalizeOkxLongShortRatio(ls?.data)
  const prior = lsPts.slice(0, -1)
  const fundingSample = Array.isArray(funding?.data) ? normalizeOkxFundingRate(funding.data[0]) : null
  return {
    context: {
      vwap: calcVwap(c15),
      atrPct: calcAtrPct(c15),
      trendPct: c1h.length >= 2 ? ((c1h[c1h.length - 1].close - c1h[0].close) / c1h[0].close) * 100 : null,
      lsRatio: lsPts.length > 0 ? lsPts[lsPts.length - 1].ratio : null,
      lsRatioAvg: prior.length > 0 ? prior.reduce((sum, p) => sum + p.ratio, 0) / prior.length : null,
    },
    fundingRate: fundingSample?.rate ?? null,
  }
}

function buildMetrics(params: {
  timeframe: TimeframeOption
  delta: bigint | null
  cvd: bigint | null
  deltaSeries: number[]
  cvdSeries: number[]
  volumeSeries: number[]
  oi: string | null
  oiInitial: number | null
  oiSeries: number[]
  oiTime: number | null
  oiStale: boolean
  liquidations: Liquidation[]
  liqSeries: number[]
  anchor: number
  gap: boolean
}): Metric[] {
  const { timeframe, delta, cvd, deltaSeries, cvdSeries, volumeSeries, oi, oiInitial, oiSeries, oiTime, oiStale, liquidations, liqSeries, anchor, gap } = params
  const tfText = timeframe.id === '1m' ? 'this minute' : `this ${timeframe.shortLabel} window`
  const coverageNote = gap ? 'Incomplete coverage: session starts on page load with no backfill.' : 'Continuous session coverage since anchor.'

  const deltaColor = delta !== null && delta < 0n ? 'rose' : 'teal'
  const deltaDesc = delta === null
    ? 'Waiting for live trades'
    : delta > 0n
      ? `Buyers hitting the ask · ${tfText}`
      : delta < 0n
        ? `Sellers hitting the bid · ${tfText}`
        : `Buyers & sellers matched · ${tfText}`

  const deltaPlain = delta === null
    ? 'Waiting for trades to see whether buyers or sellers are more impatient right now.'
    : delta > 0n
      ? `Buyers are more aggressive in ${tfText}! Traders market-bought ${formatSignedBtc(delta)} more than they sold — paying up immediately instead of waiting.`
      : delta < 0n
        ? `Sellers are more aggressive in ${tfText}! Traders market-sold ${formatSignedBtc(delta)} more than they bought — rushing to sell at current prices.`
        : `Buyers and sellers are evenly balanced in ${tfText} — neither side is pushing harder with market orders.`

  const cvdDesc = cvd === null
    ? 'Waiting for session flow'
    : cvd > 0n
      ? `Net buying (${timeframe.shortLabel} bars) · tap for median view`
      : cvd < 0n
        ? `Net selling (${timeframe.shortLabel} bars) · tap for median view`
        : `Balanced (${timeframe.shortLabel} bars) · tap for median view`

  const cvdMedian = calculateCvdMedianProfile(cvdSeries, volumeSeries)

  const cvdPlain = cvd === null
    ? 'Waiting for trades to track the running tug-of-war between buyers and sellers.'
    : cvd > 0n
      ? `Buyers are winning the tug-of-war (${formatSignedBtc(cvd)} net buying across ${timeframe.shortLabel} buckets). ${cvdMedian.summary}`
      : cvd < 0n
        ? `Sellers are winning the tug-of-war (${formatSignedBtc(cvd)} net selling across ${timeframe.shortLabel} buckets). ${cvdMedian.summary}`
        : `Buyers and sellers have canceled each other out across ${timeframe.shortLabel} buckets. ${cvdMedian.summary}`

  const oiCurrentNum = oi !== null ? Number(oi) : null
  const oiPct = oiCurrentNum !== null && oiInitial !== null && oiInitial > 0
    ? ((oiCurrentNum - oiInitial) / oiInitial) * 100
    : null
  const oiDesc = oi === null
    ? 'Waiting for OKX open interest'
    : `${oiPct !== null ? `${oiPct >= 0 ? '+' : ''}${oiPct.toFixed(2)}% (${timeframe.shortLabel}) · ` : ''}OKX${oiStale ? ' · stale' : ''}`

  const oiPlain = oi === null
    ? 'Waiting for open interest data to see if new leveraged money is entering or leaving the market.'
    : oiPct !== null && oiPct > 0.01
      ? `New money is entering the market (${oiPct >= 0 ? '+' : ''}${oiPct.toFixed(2)}% over ${timeframe.shortLabel})! Traders are opening fresh leveraged contracts.`
      : oiPct !== null && oiPct < -0.01
        ? `Money is leaving the market (${oiPct.toFixed(2)}% over ${timeframe.shortLabel})! Traders are closing out their leveraged positions.`
        : `Open interest is steady over ${timeframe.shortLabel} — roughly the same number of leveraged contracts are open.`

  const totalLiqUsd = liquidations.reduce((sum, l) => sum + l.notionalUsd, 0)
  const longLiqUsd = liquidations.filter(l => l.side === 'long').reduce((sum, l) => sum + l.notionalUsd, 0)
  const shortLiqUsd = totalLiqUsd - longLiqUsd
  const longShare = totalLiqUsd > 0 ? Math.round((longLiqUsd / totalLiqUsd) * 100) : 0
  const isHighLiq = totalLiqUsd >= LIQUIDATION_LARGE_USD
  const liqDesc = totalLiqUsd === 0
    ? `No reported liquidations in ${timeframe.shortLabel} window`
    : longLiqUsd >= shortLiqUsd
      ? `${isHighLiq ? 'Large reported liquidation! ' : ''}${longShare}% longs forced out (${timeframe.shortLabel})`
      : `${isHighLiq ? 'Large reported liquidation! ' : ''}${100 - longShare}% shorts squeezed (${timeframe.shortLabel})`

  const liqPlain = totalLiqUsd === 0
    ? 'No liquidations reported in this window. This feed does not capture every liquidation.'
    : longLiqUsd >= shortLiqUsd
      ? `${isHighLiq ? 'Large reported liquidation! ' : ''}Over-leveraged buyers (longs) lost their margin as price dropped and were forced to sell (${formatUsdCompact(longLiqUsd)} longs vs ${formatUsdCompact(shortLiqUsd)} shorts).`
      : `${isHighLiq ? 'Large reported liquidation! ' : ''}Over-leveraged sellers (shorts) got squeezed as price rose and were forced to buy back (${formatUsdCompact(shortLiqUsd)} shorts vs ${formatUsdCompact(longLiqUsd)} longs).`

  return [
    {
      id: 'delta',
      label: 'Volume Delta',
      value: delta === null ? '—' : formatSignedBtc(delta),
      description: deltaDesc,
      plainSummary: deltaPlain,
      detail: `${deltaPlain} (Technical: Taker buy volume minus taker sell volume in the current ${timeframe.label} bucket on OKX BTC-USDT-SWAP. ${coverageNote})`,
      color: deltaColor,
      bars: scaleSparklineBars(deltaSeries),
    },
    {
      id: 'cvd',
      label: 'Cumulative Volume Delta',
      value: cvd === null ? '—' : formatSignedBtc(cvd),
      description: cvdDesc,
      plainSummary: cvdPlain,
      detail: `${cvdPlain} (Technical: Running sum of executed trade delta across ${timeframe.label} buckets anchored at ${new Date(anchor).toISOString()}. ${coverageNote})`,
      color: 'blue',
      bars: scaleSparklineBars(cvdSeries),
      cvdMedian,
    },
    {
      id: 'oi',
      label: 'Open Interest',
      value: oi === null ? '—' : formatOiBtc(oi),
      description: oiDesc,
      plainSummary: oiPlain,
      detail: `${oiPlain} (Technical: Outstanding OKX BTC-USDT-SWAP contracts converted to BTC (${oi ?? '—'} BTC raw). ${oiTime ? `Last reported ${new Date(oiTime).toISOString()}${oiStale ? ' (stale)' : ''}.` : 'Waiting for initial open-interest push.'})`,
      color: 'amber',
      bars: scaleSparklineBars(oiSeries.length > 1 ? oiSeries.map(v => v - (oiInitial ?? v)) : oiSeries),
    },
    {
      id: 'liquidations',
      label: 'Liquidations',
      value: formatUsdCompact(totalLiqUsd),
      description: liqDesc,
      plainSummary: liqPlain,
      detail: `${liqPlain} (Technical: Reported forced closures on OKX BTC-USDT-SWAP in ${timeframe.label} window since ${new Date(anchor).toISOString()}. Long liquidations: ${formatUsdCompact(longLiqUsd)} · Short liquidations: ${formatUsdCompact(shortLiqUsd)}.)`,
      color: 'rose',
      bars: scaleSparklineBars(liqSeries),
    },
  ]
}

type RestBackfillCache = Partial<
  Record<
    TimeframeId,
    {
      candles: OkxCandlePoint[]
      takerBuckets: OkxTakerVolumeBucket[]
      oiPoints: OkxOiHistoryPoint[]
    }
  >
>

export function useLiveMarketData(timeframeId: TimeframeId = '1m', confirmationMode: ConfirmationMode = '5m'): LiveDashboardState {
  const tfOption = getTimeframeOption(timeframeId)
  const tfRef = useRef<TimeframeOption>(tfOption)

  const publishRef = useRef<(() => void) | null>(null)
  const backfillRef = useRef<RestBackfillCache>({})
  const trackerRef = useRef<SignalConfirmation | null>(null)

  const [state, setState] = useState<LiveDashboardState>(() => {
    const anchor = Math.floor(Date.now() / tfOption.bucketMs) * tfOption.bucketMs
    const confirmation = new SignalConfirmation(confirmationMode, Date.now()).view(Date.now(), false, 'Connection: Connecting.')
    return {
      status: 'Connecting',
      price: null,
      rawPrice: null,
      timeframe: tfOption.id,
      timeframeLabel: tfOption.label,
      anchor,
      updated: null,
      gap: true,
      oiTime: null,
      oiStale: true,
      metrics: buildMetrics({
        timeframe: tfOption,
        delta: null,
        cvd: null,
        deltaSeries: [],
        cvdSeries: [],
        volumeSeries: [],
        oi: null,
        oiInitial: null,
        oiSeries: [],
        oiTime: null,
        oiStale: true,
        liquidations: [],
        liqSeries: [],
        anchor,
        gap: true,
      }),
      pulse: confirmation.pulse,
      oiRegime: confirmation.confirmed ?? emptyOiRegime,
      events: [],
      snapshot: emptySnapshot(`${confirmationMode} confirmation`),
      confirmation,
    }
  })

  useEffect(() => {
    trackerRef.current = new SignalConfirmation(confirmationMode, Date.now())
    publishRef.current?.()
  }, [confirmationMode])

  useEffect(() => {
    let stopped = false
    let socket: WebSocket | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let ping: ReturnType<typeof setInterval> | undefined
    let status = 'Connecting'
    let lastReceive = 0
    let lastEventTime = 0
    let firstPrice: number | null = null
    let lastPrice: string | null = null
    let updated: number | null = null
    let gap = true
    const sessionStart = Date.now()
    let trades: (Trade & { price: string })[] = []
    let attempts = 0
    let oi: string | null = null
    let oiInitial: number | null = null
    let oiTime: number | null = null
    const oiHistory: { time: number; btc: number }[] = []
    let oiRefreshing = false
    const acceptOi = (sample: { btc: string; time: number }) => {
      const num = Number(sample.btc)
      if (!Number.isFinite(num) || sample.time > Date.now() + 1000 || (oiTime !== null && sample.time <= oiTime)) return false
      oi = sample.btc
      oiTime = sample.time
      if (oiInitial === null) oiInitial = num
      oiHistory.push({ time: sample.time, btc: num })
      if (oiHistory.length > 120) oiHistory.shift()
      trackerRef.current?.openInterest({ time: sample.time, btc: num }, Date.now())
      return true
    }
    const seenLiqIds = new Set<string>()
    let liquidations: Liquidation[] = []
    const eventsMap = new Map<string, MarketEventItem>()
    let context: TradeContext = emptyContext
    let fundingRate: number | null = null
    let fundingTime: number | null = null
    const contextController = new AbortController()

    const publish = () => {
      const tracker = trackerRef.current
      if (!tracker) return
      const now = Date.now()
      const tf = tfRef.current
      const bucketMs = tf.bucketMs
      const alignedSessionAnchor = Math.floor(sessionStart / bucketMs) * bucketMs
      const cached = backfillRef.current[tf.id]

      let delta: bigint | null = null
      let cvd: bigint | null = null
      let deltaSeries: number[] = []
      let cvdSeries: number[] = []
      let volumeSeries: number[] = []
      let effectiveAnchor = alignedSessionAnchor

      if (trades.length) {
        try {
          const earliestTradeTime = trades[0].time
          const replayStart = Math.floor(Math.min(sessionStart, earliestTradeTime) / bucketMs) * bucketMs
          effectiveAnchor = replayStart
          const end = Math.max(replayStart + bucketMs, Math.floor(now / bucketMs) * bucketMs + bucketMs)
          const b = replayTrades(trades, {
            exchange: 'OKX',
            symbol: 'BTC-USDT-SWAP',
            start: replayStart,
            end,
            bucketMs,
          }).buckets
          delta = b[b.length - 1].delta
          cvd = b[b.length - 1].cvd
          deltaSeries = b.slice(-12).map(bucket => Number(bucket.delta) / 1e8)
          cvdSeries = b.slice(-12).map(bucket => Number(bucket.cvd) / 1e8)
          volumeSeries = b.slice(-12).map(bucket => Number(bucket.volume) / 1e8)
        } catch {
          status = 'Data error'
          gap = true
          trades = []
          tracker.interrupt(now, 'Trade data could not be replayed.')
        }
      }

      if (cached && cached.takerBuckets.length > 0) {
        const currentBucketStart = Math.floor(now / bucketMs) * bucketMs
        const priorRest = cached.takerBuckets.filter(tb => tb.time < currentBucketStart).slice(-11)
        if (priorRest.length > 0 && deltaSeries.length <= 1) {
          const liveCurrentDeltaBtc = delta !== null ? Number(delta) / 1e8 : priorRest[priorRest.length - 1].deltaBtc
          const liveCurrentVolBtc = volumeSeries.length > 0 ? volumeSeries[volumeSeries.length - 1] : priorRest[priorRest.length - 1].volumeBtc
          const combinedDeltas = [...priorRest.map(r => r.deltaBtc), ...(delta !== null ? [liveCurrentDeltaBtc] : [])].slice(-12)
          const combinedVols = [...priorRest.map(r => r.volumeBtc), ...(delta !== null ? [liveCurrentVolBtc] : [])].slice(-12)
          let runningCvd = 0
          const combinedCvd = combinedDeltas.map(d => {
            runningCvd += d
            return runningCvd
          })
          deltaSeries = combinedDeltas
          volumeSeries = combinedVols
          cvdSeries = combinedCvd
          if (delta === null) {
            delta = BigInt(Math.round(combinedDeltas[combinedDeltas.length - 1] * 1e8))
          }
          cvd = BigInt(Math.round(runningCvd * 1e8))
          effectiveAnchor = priorRest[0].time
        }
      }

      const effectiveStatus = status === 'Connected' && updated !== null && now - updated > 15000 ? 'Stale' : status
      const oiStale = status !== 'Connected' || oiTime === null || now - oiTime > SIGNAL_RULES.maximumOiAgeMs

      const activeLiquidations = liquidations.filter(l => l.time >= now - bucketMs && l.time <= now)
      const liqSeries = activeLiquidations.slice(-12).map(l => l.notionalUsd)

      if (delta !== null) {
        const absDeltaBtc = Number(delta < 0n ? -delta : delta) / 1e8
        if (absDeltaBtc >= 25) {
          const bucketKey = `delta-${tf.id}-${Math.floor(now / bucketMs)}`
          eventsMap.set(bucketKey, {
            id: bucketKey,
            kind: 'flow',
            tag: `LIVE ORDER FLOW (${tf.shortLabel.toUpperCase()})`,
            title: delta > 0n ? 'Elevated taker buying delta' : 'Elevated taker selling delta',
            value: formatSignedBtc(delta),
            color: delta > 0n ? 'teal' : 'rose',
            description:
              delta > 0n
                ? `Big buying wave! Buyers aggressively market-bought ${formatSignedBtc(delta)} more than sellers in this ${tf.shortLabel} window.`
                : `Big selling wave! Sellers aggressively market-sold ${formatSignedBtc(delta)} more than buyers in this ${tf.shortLabel} window.`,
            time: updated ?? now,
          })
        }
      }

      const priceEndNum =
        lastPrice !== null
          ? Number(lastPrice)
          : cached && cached.candles.length > 0
            ? cached.candles[cached.candles.length - 1].close
            : null

      const windowOi = oiHistory.filter(o => o.time >= now - bucketMs)
      let tfOiInitial = windowOi.length > 0 ? windowOi[0].btc : oiInitial
      const oiEndNum = oi !== null ? Number(oi) : null
      let oiSeriesNums = oiHistory.slice(-24).map(o => o.btc)

      if (cached && cached.oiPoints.length >= 2 && oiSeriesNums.length <= 1 && oiEndNum !== null && priceEndNum !== null && priceEndNum > 0) {
        const prevOiBtc = cached.oiPoints[cached.oiPoints.length - 2].oiUsd / priceEndNum
        if (Number.isFinite(prevOiBtc) && prevOiBtc > 0) {
          tfOiInitial = prevOiBtc
          oiSeriesNums = [...cached.oiPoints.slice(-11).map(p => p.oiUsd / priceEndNum), oiEndNum]
        }
      }

      if (volumeSeries.length === 0 && cached && cached.candles.length > 0) {
        volumeSeries = cached.candles.slice(-12).map(c => c.volumeBtc)
      }

      const metrics = buildMetrics({
        timeframe: tf,
        delta,
        cvd,
        deltaSeries,
        cvdSeries,
        volumeSeries,
        oi,
        oiInitial: tfOiInitial,
        oiSeries: oiSeriesNums,
        oiTime,
        oiStale,
        liquidations: activeLiquidations,
        liqSeries,
        anchor: effectiveAnchor,
        gap,
      })

      const healthReason =
        effectiveStatus === 'Stale'
          ? 'Trade feed is stale.'
          : effectiveStatus !== 'Connected'
            ? `Connection: ${effectiveStatus}.`
            : oiTime === null
              ? 'Waiting for the first BTC-USDT-SWAP open-interest snapshot.'
              : oiStale
                ? 'Latest open-interest snapshot is older than 90 seconds.'
                : undefined
      const confirmation = tracker.view(now, effectiveStatus === 'Connected' && !oiStale, healthReason)
      const oiRegime = confirmation.confirmed ?? emptyOiRegime

      const recentLiqs = liquidations.filter(l => l.time >= now - 15 * minute && l.time <= now)
      const snapshot: MarketSnapshot = {
        price: priceEndNum,
        flowPrice: confirmation.snapshot.priceEnd,
        priceStart: confirmation.snapshot.priceStart,
        deltaBtc: confirmation.snapshot.deltaBtc,
        cvdBtc: confirmation.snapshot.cvdBtc,
        volumeBtc: confirmation.snapshot.volumeBtc,
        oiRegimeId: confirmation.confirmed?.activeRowId ?? null,
        vwap: context.vwap,
        atrPct: context.atrPct,
        fundingRate,
        lsRatio: context.lsRatio,
        lsRatioAvg: context.lsRatioAvg,
        trendPct: context.trendPct,
        recentLongLiqUsd: recentLiqs.filter(l => l.side === 'long').reduce((sum, l) => sum + l.notionalUsd, 0),
        recentShortLiqUsd: recentLiqs.filter(l => l.side === 'short').reduce((sum, l) => sum + l.notionalUsd, 0),
        timeframeLabel: `${confirmation.mode} confirmation`,
      }

      const displayPrice =
        lastPrice !== null
          ? formatPrice(lastPrice)
          : priceEndNum !== null
            ? formatPrice(String(priceEndNum))
            : null

      setState({
        status: effectiveStatus,
        price: displayPrice,
        rawPrice: lastPrice ? `$${lastPrice}` : priceEndNum !== null ? `$${priceEndNum}` : null,
        timeframe: tf.id,
        timeframeLabel: tf.label,
        anchor: effectiveAnchor,
        updated,
        gap,
        oiTime,
        oiStale,
        metrics,
        pulse: confirmation.pulse,
        oiRegime,
        events: Array.from(eventsMap.values()).sort((a, b) => b.time - a.time).slice(0, 20),
        snapshot,
        confirmation,
      })
    }

    publishRef.current = publish

    const connect = () => {
      if (stopped) return
      status = attempts ? 'Reconnecting' : 'Connecting'
      publish()
      socket = new WebSocket('wss://ws.okx.com/ws/v5/public')
      socket.onopen = () => {
        if (!socket || stopped) return
        lastReceive = Date.now()
        socket.send(
          JSON.stringify({
            op: 'subscribe',
            args: [
              { channel: 'trades', instId: 'BTC-USDT-SWAP' },
              { channel: 'open-interest', instId: 'BTC-USDT-SWAP' },
              { channel: 'liquidation-orders', instType: 'SWAP' },
              { channel: 'funding-rate', instId: 'BTC-USDT-SWAP' },
            ],
          }),
        )
      }
      socket.onmessage = e => {
        lastReceive = Date.now()
        if (e.data === 'pong') return
        try {
          const msg = JSON.parse(String(e.data))
          if (msg.event === 'error') {
            gap = true
            trackerRef.current?.interrupt(Date.now(), 'Subscription error from the OKX feed.')
            status = 'Subscription error'
            socket?.close()
            return
          }
          if (msg.event === 'subscribe') {
            attempts = 0
            status = 'Connected'
            publish()
            return
          }
          if (!Array.isArray(msg.data)) return
          if (msg.arg?.channel === 'open-interest') {
            let receivedNewOi = false
            for (const row of msg.data) {
              if (acceptOi(normalizeOkxOpenInterest(row))) receivedNewOi = true
            }
            if (receivedNewOi && oiHistory.length === 1) publish()
            return
          }
          if (msg.arg?.channel === 'funding-rate') {
            for (const row of msg.data) {
              const sample = normalizeOkxFundingRate(row)
              if (sample && (fundingTime === null || sample.time >= fundingTime)) {
                fundingRate = sample.rate
                fundingTime = sample.time
              }
            }
            return
          }
          if (msg.arg?.channel === 'liquidation-orders') {
            let added = false
            for (const row of msg.data) {
              const items = normalizeOkxLiquidationOrders(row)
              for (const item of items) {
                if (item.time <= Date.now() + 60000 && !seenLiqIds.has(item.id)) {
                  seenLiqIds.add(item.id)
                  liquidations.push(item)
                  added = true
                  if (item.notionalUsd >= LIQUIDATION_LARGE_USD) {
                    eventsMap.set(`liq-${item.id}`, {
                      id: `liq-${item.id}`,
                      kind: 'liquidation',
                      tag: 'LARGE REPORTED LIQUIDATION',
                      title: `Large ${item.side} liquidation`,
                      value: `${formatUsdCompact(item.notionalUsd)} ${item.side}s`,
                      color: item.side === 'long' ? 'rose' : 'teal',
                      description:
                        item.side === 'long'
                          ? `Large reported liquidation! Over-leveraged buyers (longs) were forced to sell ${item.btc} BTC near $${item.price}, adding sudden downward selling pressure.`
                          : `Large reported liquidation! Over-leveraged sellers (shorts) were forced to buy back ${item.btc} BTC near $${item.price}, adding sudden upward buying fuel.`,
                      time: item.time,
                    })
                  }
                }
              }
            }
            if (liquidations.length > 1000) liquidations = liquidations.slice(-1000)
            if (added) publish()
            return
          }
          if (msg.arg?.channel !== 'trades') return
          const wasEmpty = trades.length === 0
          for (const row of msg.data) {
            const t = normalizeOkxTrade(row)
            if (t.time > Date.now() + 60000) {
              gap = true
              continue
            }
            trackerRef.current?.trade({ id: t.id, time: t.time, price: Number(t.price), quantityBtc: t.quantityBtc, side: t.side }, Date.now())
            if (t.time >= Math.floor(sessionStart / minute) * minute) {
              trades.push(t)
              if (firstPrice === null) firstPrice = Number(t.price)
              if (t.time >= lastEventTime) {
                lastEventTime = t.time
                lastPrice = t.price
                updated = t.time
              }
            }
          }
          if (trades.length > 50000) {
            trades = trades.slice(-50000)
            gap = true
          }
          if (wasEmpty && trades.length > 0) publish()
        } catch {
          gap = true
          trackerRef.current?.interrupt(Date.now(), 'Feed message could not be parsed.')
        }
      }
      socket.onerror = () => socket?.close()
      socket.onclose = () => {
        if (stopped) return
        gap = true
        trackerRef.current?.interrupt(Date.now(), 'Connection closed.')
        status = 'Disconnected'
        publish()
        attempts++
        timer = setTimeout(connect, Math.min(1000 * 2 ** Math.min(attempts, 5), 30000))
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState !== 'hidden' && socket?.readyState === WebSocket.OPEN && Date.now() - lastReceive > 30000) {
        gap = true
        socket.close()
      }
      publish()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    const refreshOi = async () => {
      if (oiRefreshing) return
      oiRefreshing = true
      try {
        const res = await fetch('https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=BTC-USDT-SWAP', { signal: contextController.signal })
        if (!res.ok) return
        const json = (await res.json()) as { data?: unknown }
        const row = Array.isArray(json.data) ? json.data.find(r => (r as { instId?: unknown }).instId === 'BTC-USDT-SWAP') : undefined
        if (!row || stopped) return
        if (acceptOi(normalizeOkxOpenInterest(row))) publish()
      } catch {
        return
      } finally {
        oiRefreshing = false
      }
    }
    void refreshOi()
    const oiTimer = setInterval(() => void refreshOi(), SIGNAL_RULES.oiRefreshMs)
    const refreshContext = async () => {
      const result = await fetchTradeContext(contextController.signal)
      if (stopped) return
      context = result.context
      if (fundingRate === null && result.fundingRate !== null) fundingRate = result.fundingRate
      publish()
    }
    void refreshContext()
    const contextTimer = setInterval(() => void refreshContext(), 5 * minute)
    connect()
    const render = setInterval(publish, 5000)
    ping = setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN && Date.now() - lastReceive > 20000) socket.send('ping')
      if (socket?.readyState === WebSocket.OPEN && Date.now() - lastReceive > 30000) {
        gap = true
        socket.close()
      }
    }, 5000)
    return () => {
      stopped = true
      publishRef.current = null
      document.removeEventListener('visibilitychange', onVisibilityChange)
      clearInterval(render)
      clearInterval(contextTimer)
      clearInterval(oiTimer)
      contextController.abort()
      if (ping) clearInterval(ping)
      if (timer) clearTimeout(timer)
      socket?.close()
    }
  }, [])

  useEffect(() => {
    const tf = getTimeframeOption(timeframeId)
    tfRef.current = tf
    publishRef.current?.()
    if (timeframeId === '1m') return
    if (backfillRef.current[timeframeId]) {
      publishRef.current?.()
      return
    }
    let cancelled = false
    const controller = new AbortController()
    const fetchBackfill = async () => {
      try {
        const candleReq = fetch(
          `https://www.okx.com/api/v5/market/candles?instId=BTC-USDT-SWAP&bar=${tf.candleBar}&limit=12`,
          { signal: controller.signal },
        ).then(r => (r.ok ? r.json() : null))

        const takerReq = tf.rubikPeriod
          ? fetch(
              `https://www.okx.com/api/v5/rubik/stat/taker-volume-contract?instId=BTC-USDT-SWAP&period=${tf.rubikPeriod}&unit=1&limit=12`,
              { signal: controller.signal },
            ).then(r => (r.ok ? r.json() : null))
          : Promise.resolve(null)

        const oiReq = tf.rubikPeriod
          ? fetch(
              `https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-volume?ccy=BTC&period=${tf.rubikPeriod}`,
              { signal: controller.signal },
            ).then(r => (r.ok ? r.json() : null))
          : Promise.resolve(null)

        const [candleJson, takerJson, oiJson] = await Promise.all([candleReq, takerReq, oiReq])
        if (cancelled) return

        const candles = normalizeOkxCandles(candleJson?.data)
        const takerBuckets = normalizeOkxTakerVolume(takerJson?.data)
        const oiPoints = normalizeOkxOiHistory(oiJson?.data)

        if (candles.length > 0 || takerBuckets.length > 0 || oiPoints.length > 0) {
          backfillRef.current[timeframeId] = { candles, takerBuckets, oiPoints }
          publishRef.current?.()
        }
      } catch {
        // Ignore network/CORS errors in restricted test environments and rely on live WebSocket stream
      }
    }
    void fetchBackfill()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [timeframeId])

  return state
}

