import { useEffect, useRef, useState } from 'react'
import {
  getTimeframeOption,
  normalizeOkxCandles,
  normalizeOkxLiquidationOrders,
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
  evaluateMarketPulse,
  evaluateOiRegime,
  replayTrades,
  scaleSparklineBars,
  type OiRegimeEvaluation,
  type PulseEvaluation,
  type Trade,
} from '../domain/tradeEngine'
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
  const isHighLiq = totalLiqUsd >= 25_000
  const liqDesc = totalLiqUsd === 0
    ? `No forced liquidations in ${timeframe.shortLabel} window`
    : longLiqUsd >= shortLiqUsd
      ? `${isHighLiq ? 'High liquidation event! ' : ''}${longShare}% longs forced out (${timeframe.shortLabel})`
      : `${isHighLiq ? 'High liquidation event! ' : ''}${100 - longShare}% shorts squeezed (${timeframe.shortLabel})`

  const liqPlain = totalLiqUsd === 0
    ? `No liquidations reported in ${tfText}. Nobody has been forced out of their leveraged trades.`
    : longLiqUsd >= shortLiqUsd
      ? `${isHighLiq ? 'High liquidation event! ' : ''}Over-leveraged buyers (longs) lost their margin as price dropped and were forced to sell (${formatUsdCompact(longLiqUsd)} longs vs ${formatUsdCompact(shortLiqUsd)} shorts).`
      : `${isHighLiq ? 'High liquidation event! ' : ''}Over-leveraged sellers (shorts) got squeezed as price rose and were forced to buy back (${formatUsdCompact(shortLiqUsd)} shorts vs ${formatUsdCompact(longLiqUsd)} longs).`

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

export function useLiveMarketData(timeframeId: TimeframeId = '1m'): LiveDashboardState {
  const tfOption = getTimeframeOption(timeframeId)
  const tfRef = useRef<TimeframeOption>(tfOption)

  const publishRef = useRef<(() => void) | null>(null)
  const backfillRef = useRef<RestBackfillCache>({})

  const [state, setState] = useState<LiveDashboardState>(() => {
    const anchor = Math.floor(Date.now() / tfOption.bucketMs) * tfOption.bucketMs
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
      pulse: evaluateMarketPulse({
        priceStart: null,
        priceEnd: null,
        deltaSats: null,
        cvdChangeSats: null,
        oiStartBtc: null,
        oiEndBtc: null,
        longLiqUsd: 0,
        shortLiqUsd: 0,
      }),
      oiRegime: evaluateOiRegime({
        priceStart: null,
        priceEnd: null,
        volumeSeriesBtc: [],
        oiStartBtc: null,
        oiEndBtc: null,
      }),
      events: [],
    }
  })

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
    const seenLiqIds = new Set<string>()
    let liquidations: Liquidation[] = []
    const eventsMap = new Map<string, MarketEventItem>()

    const publish = () => {
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
      const oiStale = status !== 'Connected' || oiTime === null || now - oiTime > 15000

      const windowStart = now - Math.max(bucketMs, minute)
      const windowLiquidations = tf.id === '1m' ? liquidations : liquidations.filter(l => l.time >= windowStart)
      const activeLiquidations = windowLiquidations.length > 0 ? windowLiquidations : liquidations
      const longLiqUsd = activeLiquidations.filter(l => l.side === 'long').reduce((s, l) => s + l.notionalUsd, 0)
      const shortLiqUsd = activeLiquidations.filter(l => l.side === 'short').reduce((s, l) => s + l.notionalUsd, 0)
      const liqSeries = activeLiquidations.slice(-12).map(l => l.notionalUsd)

      if (delta !== null) {
        const absDeltaBtc = Number(delta < 0n ? -delta : delta) / 1e8
        if (absDeltaBtc >= 25) {
          const bucketKey = `delta-${tf.id}-${Math.floor(now / bucketMs)}`
          eventsMap.set(bucketKey, {
            id: bucketKey,
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

      const windowTrades = trades.filter(t => t.time >= now - bucketMs)
      let tfPriceStart: number | null = firstPrice
      if (windowTrades.length > 0) {
        tfPriceStart = Number(windowTrades[0].price)
      }
      if (cached && cached.candles.length >= 2 && windowTrades.length <= 1) {
        tfPriceStart = cached.candles[cached.candles.length - 2].open
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

      const pulse = evaluateMarketPulse({
        priceStart: tfPriceStart,
        priceEnd: priceEndNum,
        deltaSats: delta,
        cvdChangeSats: cvd,
        oiStartBtc: tfOiInitial,
        oiEndBtc: oiEndNum,
        longLiqUsd,
        shortLiqUsd,
      })

      const oiRegime = evaluateOiRegime({
        priceStart: tfPriceStart,
        priceEnd: priceEndNum,
        volumeSeriesBtc: volumeSeries,
        oiStartBtc: tfOiInitial,
        oiEndBtc: oiEndNum,
      })

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
        pulse,
        oiRegime,
        events: Array.from(eventsMap.values()).sort((a, b) => b.time - a.time).slice(0, 20),
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
              const sample = normalizeOkxOpenInterest(row)
              if (sample.time <= Date.now() + 60000 && (oiTime === null || sample.time >= oiTime)) {
                oi = sample.btc
                oiTime = sample.time
                const num = Number(sample.btc)
                if (Number.isFinite(num)) {
                  if (oiInitial === null) oiInitial = num
                  oiHistory.push({ time: sample.time, btc: num })
                  if (oiHistory.length > 120) oiHistory.shift()
                }
                receivedNewOi = true
              }
            }
            if (receivedNewOi && oiHistory.length === 1) publish()
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
                  if (item.notionalUsd >= 25_000) {
                    eventsMap.set(`liq-${item.id}`, {
                      id: `liq-${item.id}`,
                      tag: 'HIGH LIQUIDATION EVENT',
                      title: `Large ${item.side} liquidation`,
                      value: `${formatUsdCompact(item.notionalUsd)} ${item.side}s`,
                      color: item.side === 'long' ? 'rose' : 'teal',
                      description:
                        item.side === 'long'
                          ? `High liquidation event! Over-leveraged buyers (longs) were forced to sell ${item.btc} BTC near $${item.price}, adding sudden downward selling pressure.`
                          : `High liquidation event! Over-leveraged sellers (shorts) were forced to buy back ${item.btc} BTC near $${item.price}, adding sudden upward buying fuel.`,
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
        }
      }
      socket.onerror = () => socket?.close()
      socket.onclose = () => {
        if (stopped) return
        gap = true
        status = 'Disconnected'
        publish()
        attempts++
        timer = setTimeout(connect, Math.min(1000 * 2 ** Math.min(attempts, 5), 30000))
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        gap = true
      } else if (socket?.readyState === WebSocket.OPEN && Date.now() - lastReceive > 30000) {
        gap = true
        socket.close()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
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

