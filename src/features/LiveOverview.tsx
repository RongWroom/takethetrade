import { useEffect, useState } from 'react'
import { normalizeOkxLiquidationOrders, normalizeOkxOpenInterest, normalizeOkxTrade, type Liquidation } from '../data/okx'
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
  const { delta, cvd, deltaSeries, cvdSeries, volumeSeries, oi, oiInitial, oiSeries, oiTime, oiStale, liquidations, liqSeries, anchor, gap } = params
  const coverageNote = gap ? 'Incomplete coverage: session starts on page load with no backfill.' : 'Continuous session coverage since anchor.'

  const deltaColor = delta !== null && delta < 0n ? 'rose' : 'teal'
  const deltaDesc = delta === null
    ? 'Waiting for live trades'
    : delta > 0n
      ? 'Buyers are hitting the ask · this minute'
      : delta < 0n
        ? 'Sellers are hitting the bid · this minute'
        : 'Buyers & sellers evenly matched · this minute'

  const deltaPlain = delta === null
    ? 'Waiting for trades to see whether buyers or sellers are more impatient right now.'
    : delta > 0n
      ? `Buyers are more aggressive right now! This means traders have market-bought ${formatSignedBtc(delta)} more than they sold this minute — they are willing to pay up immediately instead of waiting.`
      : delta < 0n
        ? `Sellers are more aggressive right now! This means traders have market-sold ${formatSignedBtc(delta)} more than they bought this minute — they are rushing to sell at current prices.`
        : 'Buyers and sellers are completely balanced this minute — neither side is pushing harder with market orders.'

  const cvdDesc = cvd === null
    ? 'Waiting for session flow'
    : cvd > 0n
      ? 'More market buying overall · tap to flip median view'
      : cvd < 0n
        ? 'More market selling overall · tap to flip median view'
        : 'Balanced session flow · tap to flip median view'

  const cvdMedian = calculateCvdMedianProfile(cvdSeries, volumeSeries)

  const cvdPlain = cvd === null
    ? 'Waiting for trades to track the running tug-of-war between buyers and sellers.'
    : cvd > 0n
      ? `Buyers are winning the session tug-of-war (${formatSignedBtc(cvd)} net buying). ${cvdMedian.summary}`
      : cvd < 0n
        ? `Sellers are winning the session tug-of-war (${formatSignedBtc(cvd)} net selling). ${cvdMedian.summary}`
        : `Buyers and sellers have canceled each other out since the session began. ${cvdMedian.summary}`

  const oiCurrentNum = oi !== null ? Number(oi) : null
  const oiPct = oiCurrentNum !== null && oiInitial !== null && oiInitial > 0
    ? ((oiCurrentNum - oiInitial) / oiInitial) * 100
    : null
  const oiDesc = oi === null
    ? 'Waiting for OKX open interest'
    : `${oiPct !== null ? `${oiPct >= 0 ? '+' : ''}${oiPct.toFixed(2)}% in session · ` : ''}OKX${oiStale ? ' · stale' : ''}`

  const oiPlain = oi === null
    ? 'Waiting for open interest data to see if new leveraged money is entering or leaving the market.'
    : oiPct !== null && oiPct > 0.01
      ? `New money is entering the market (${oiPct >= 0 ? '+' : ''}${oiPct.toFixed(2)}%)! This means traders are opening fresh leveraged contracts rather than closing old ones.`
      : oiPct !== null && oiPct < -0.01
        ? `Money is leaving the market (${oiPct.toFixed(2)}%)! This means traders are closing out their leveraged positions (taking profit, stopping out, or getting liquidated).`
        : 'Open interest is steady — roughly the same number of leveraged contracts are open as when the session started.'

  const totalLiqUsd = liquidations.reduce((sum, l) => sum + l.notionalUsd, 0)
  const longLiqUsd = liquidations.filter(l => l.side === 'long').reduce((sum, l) => sum + l.notionalUsd, 0)
  const shortLiqUsd = totalLiqUsd - longLiqUsd
  const longShare = totalLiqUsd > 0 ? Math.round((longLiqUsd / totalLiqUsd) * 100) : 0
  const isHighLiq = totalLiqUsd >= 25_000
  const liqDesc = totalLiqUsd === 0
    ? 'No forced liquidations yet in session'
    : longLiqUsd >= shortLiqUsd
      ? `${isHighLiq ? 'High liquidation event! ' : ''}${longShare}% buyers (longs) forced out`
      : `${isHighLiq ? 'High liquidation event! ' : ''}${100 - longShare}% sellers (shorts) squeezed`

  const liqPlain = totalLiqUsd === 0
    ? 'No liquidations reported yet! Nobody has been forced out of their leveraged trades during this session.'
    : longLiqUsd >= shortLiqUsd
      ? `${isHighLiq ? 'High liquidation event! ' : ''}This means over-leveraged buyers (longs) lost their margin as price dropped and the exchange forced them to sell (${formatUsdCompact(longLiqUsd)} longs vs ${formatUsdCompact(shortLiqUsd)} shorts). Forced selling like this can speed up a drop — or mark exhaustion once the last weak buyers are flushed out.`
      : `${isHighLiq ? 'High liquidation event! ' : ''}This means over-leveraged sellers (shorts) got squeezed as price rose and the exchange forced them to buy back (${formatUsdCompact(shortLiqUsd)} shorts vs ${formatUsdCompact(longLiqUsd)} longs). Forced buying like this adds rocket fuel to an upward move.`

  return [
    {
      id: 'delta',
      label: 'Volume Delta',
      value: delta === null ? '—' : formatSignedBtc(delta),
      description: deltaDesc,
      plainSummary: deltaPlain,
      detail: `${deltaPlain} (Technical: Taker buy volume minus taker sell volume in the current UTC minute on OKX BTC-USDT-SWAP. ${coverageNote})`,
      color: deltaColor,
      bars: scaleSparklineBars(deltaSeries),
    },
    {
      id: 'cvd',
      label: 'Cumulative Volume Delta',
      value: cvd === null ? '—' : formatSignedBtc(cvd),
      description: cvdDesc,
      plainSummary: cvdPlain,
      detail: `${cvdPlain} (Technical: Running sum of executed trade delta anchored at ${new Date(anchor).toISOString()}. ${coverageNote})`,
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
      detail: `${liqPlain} (Technical: Reported forced closures on OKX BTC-USDT-SWAP since ${new Date(anchor).toISOString()}. Long liquidations: ${formatUsdCompact(longLiqUsd)} · Short liquidations: ${formatUsdCompact(shortLiqUsd)}.)`,
      color: 'rose',
      bars: scaleSparklineBars(liqSeries),
    },
  ]
}

export function useLiveMarketData(): LiveDashboardState {
  const [state, setState] = useState<LiveDashboardState>(() => {
    const anchor = Math.floor(Date.now() / minute) * minute
    return {
      status: 'Connecting',
      price: null,
      rawPrice: null,
      anchor,
      updated: null,
      gap: true,
      oiTime: null,
      oiStale: true,
      metrics: buildMetrics({
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
    let anchor = Math.floor(Date.now() / minute) * minute
    let trades: Trade[] = []
    let attempts = 0
    let oi: string | null = null
    let oiInitial: number | null = null
    let oiTime: number | null = null
    const oiHistory: number[] = []
    const seenLiqIds = new Set<string>()
    let liquidations: Liquidation[] = []
    const eventsMap = new Map<string, MarketEventItem>()

    const publish = () => {
      const now = Date.now()
      let delta: bigint | null = null
      let cvd: bigint | null = null
      let deltaSeries: number[] = []
      let cvdSeries: number[] = []
      let volumeSeries: number[] = []
      if (trades.length) {
        try {
          const end = Math.max(anchor + minute, Math.floor(now / minute) * minute + minute)
          const b = replayTrades(trades, { exchange: 'OKX', symbol: 'BTC-USDT-SWAP', start: anchor, end, bucketMs: minute }).buckets
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

      const effectiveStatus = status === 'Connected' && updated !== null && now - updated > 15000 ? 'Stale' : status
      const oiStale = status !== 'Connected' || oiTime === null || now - oiTime > 15000
      const longLiqUsd = liquidations.filter(l => l.side === 'long').reduce((s, l) => s + l.notionalUsd, 0)
      const shortLiqUsd = liquidations.filter(l => l.side === 'short').reduce((s, l) => s + l.notionalUsd, 0)
      const liqSeries = liquidations.slice(-12).map(l => l.notionalUsd)

      if (delta !== null) {
        const absDeltaBtc = Number(delta < 0n ? -delta : delta) / 1e8
        if (absDeltaBtc >= 25) {
          const minuteKey = `delta-${Math.floor(now / minute)}`
          eventsMap.set(minuteKey, {
            id: minuteKey,
            tag: 'LIVE ORDER FLOW EVENT',
            title: delta > 0n ? 'Elevated taker buying delta' : 'Elevated taker selling delta',
            value: formatSignedBtc(delta),
            color: delta > 0n ? 'teal' : 'rose',
            description:
              delta > 0n
                ? `Big buying wave! Buyers aggressively market-bought ${formatSignedBtc(delta)} more than sellers in this minute — they are rushing in at market price.`
                : `Big selling wave! Sellers aggressively market-sold ${formatSignedBtc(delta)} more than buyers in this minute — they are dumping into the bid.`,
            time: updated ?? now,
          })
        }
      }

      const metrics = buildMetrics({
        delta,
        cvd,
        deltaSeries,
        cvdSeries,
        volumeSeries,
        oi,
        oiInitial,
        oiSeries: oiHistory,
        oiTime,
        oiStale,
        liquidations,
        liqSeries,
        anchor,
        gap,
      })

      const priceEndNum = lastPrice !== null ? Number(lastPrice) : null
      const oiEndNum = oi !== null ? Number(oi) : null

      const pulse = evaluateMarketPulse({
        priceStart: firstPrice,
        priceEnd: priceEndNum,
        deltaSats: delta,
        cvdChangeSats: cvd,
        oiStartBtc: oiInitial,
        oiEndBtc: oiEndNum,
        longLiqUsd,
        shortLiqUsd,
      })

      const oiRegime = evaluateOiRegime({
        priceStart: firstPrice,
        priceEnd: priceEndNum,
        volumeSeriesBtc: volumeSeries,
        oiStartBtc: oiInitial,
        oiEndBtc: oiEndNum,
      })

      setState({
        status: effectiveStatus,
        price: lastPrice ? formatPrice(lastPrice) : null,
        rawPrice: lastPrice ? `$${lastPrice}` : null,
        anchor,
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
                  oiHistory.push(num)
                  if (oiHistory.length > 24) oiHistory.shift()
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
                          ? `High liquidation event! This means over-leveraged buyers (longs) were forced to sell ${item.btc} BTC near $${item.price}, adding sudden downward selling pressure.`
                          : `High liquidation event! This means over-leveraged sellers (shorts) were forced to buy back ${item.btc} BTC near $${item.price}, adding sudden upward buying fuel.`,
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
            if (t.time >= anchor) {
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
            anchor = Math.floor(trades[0].time / minute) * minute
            trades = trades.filter(t => t.time >= anchor)
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
      document.removeEventListener('visibilitychange', onVisibilityChange)
      clearInterval(render)
      if (ping) clearInterval(ping)
      if (timer) clearTimeout(timer)
      socket?.close()
    }
  }, [])

  return state
}

