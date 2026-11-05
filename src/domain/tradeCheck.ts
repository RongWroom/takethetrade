/**
 * "My Trade" check: deterministic, read-only context for a trade the user is
 * considering or already holding elsewhere. This module never places orders —
 * it only compares a user-described intent against observed market data.
 */
import type { OiRegimeId } from './tradeEngine'

export type TradeSide = 'long' | 'short'

export type TradeIntent = {
  side: TradeSide
  entry?: number
  stop?: number
  leverage?: number
}

export type CandleLike = { high: number; low: number; close: number; volumeBtc: number }

export type MarketSnapshot = {
  price: number | null
  /** Price at the start of the selected timeframe window. */
  priceStart: number | null
  /** Latest-bucket taker delta (BTC). */
  deltaBtc: number | null
  /** Cumulative delta across the visible window (BTC). */
  cvdBtc: number | null
  /** Latest-bucket traded volume (BTC). */
  volumeBtc: number | null
  oiRegimeId: OiRegimeId | null
  /** Volume-weighted average price over recent 15m candles. */
  vwap: number | null
  /** Average true range of recent 15m candles, as % of price. */
  atrPct: number | null
  /** Current funding rate as a decimal (0.0001 = 0.01%). */
  fundingRate: number | null
  /** Latest long/short account ratio. */
  lsRatio: number | null
  /** Average long/short account ratio over the preceding hour. */
  lsRatioAvg: number | null
  /** % change of 1h closes over the last 6 hours. */
  trendPct: number | null
  /** Reported liquidations in the last 15 minutes (USD notional). */
  recentLongLiqUsd: number
  recentShortLiqUsd: number
  timeframeLabel: string
}

export type CheckStatus = 'good' | 'caution' | 'against' | 'neutral' | 'unknown'

export type TradeCheckItem = {
  id: string
  status: CheckStatus
  title: string
  headline: string
  explanation: string
  evidence: string
}

export type TradeCheckResult = {
  mode: 'planning' | 'position'
  referencePrice: number | null
  issues: IntentIssue[]
  checks: TradeCheckItem[]
  summary: { good: number; against: number; caution: number; headline: string }
}

/** OKX BTC-USDT-SWAP tier-1 maintenance margin ratio (approximation). */
export const MAINTENANCE_MARGIN_RATE = 0.004

const pct = (n: number, dp = 2) => `${n >= 0 ? '+' : ''}${n.toFixed(dp)}%`
const usd = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
const usdCompact = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `$${(n / 1_000).toFixed(1)}K` : usd(n))
const btc = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)} BTC`

const unknown = (id: string, title: string, waitingFor: string): TradeCheckItem => ({
  id,
  status: 'unknown',
  title,
  headline: `Waiting for ${waitingFor}`,
  explanation: `This check needs ${waitingFor} before it can say anything. It will fill in automatically.`,
  evidence: 'Insufficient data',
})

/** Volume-weighted average price from candles, using the typical price (H+L+C)/3. */
export function calcVwap(candles: readonly CandleLike[]): number | null {
  let pv = 0
  let v = 0
  for (const c of candles) {
    if (!(c.volumeBtc > 0)) continue
    pv += ((c.high + c.low + c.close) / 3) * c.volumeBtc
    v += c.volumeBtc
  }
  return v > 0 ? pv / v : null
}

/** Average true range as a percentage of the last close. Needs at least two candles. */
export function calcAtrPct(candles: readonly CandleLike[]): number | null {
  if (candles.length < 2) return null
  let sum = 0
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]
    const prevClose = candles[i - 1].close
    sum += Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose))
  }
  const atr = sum / (candles.length - 1)
  const last = candles[candles.length - 1].close
  return last > 0 ? (atr / last) * 100 : null
}

/**
 * Approximate isolated-margin liquidation price. Ignores fees, funding and
 * position-tier changes; for guidance only.
 */
export function approxLiquidationPrice(side: TradeSide, entry: number, leverage: number): number {
  return side === 'long'
    ? entry * (1 - 1 / leverage + MAINTENANCE_MARGIN_RATE)
    : entry * (1 + 1 / leverage - MAINTENANCE_MARGIN_RATE)
}

export type IntentIssue = { field: 'entry' | 'stop' | 'leverage'; message: string }

export function validateIntent(intent: TradeIntent, price: number | null): IntentIssue[] {
  const issues: IntentIssue[] = []
  const { side, entry, stop, leverage } = intent
  let entryOk = false
  if (entry !== undefined) {
    if (!(entry > 0)) issues.push({ field: 'entry', message: 'Entry price must be a positive number.' })
    else if (price !== null && price > 0 && Math.abs(entry - price) / price > 0.2)
      issues.push({ field: 'entry', message: 'Entry price is more than 20% away from the current price. Check for a typo.' })
    else entryOk = true
  }
  if (stop !== undefined) {
    const ref = entryOk ? entry! : price
    const label = entryOk ? 'entry price' : 'current price'
    if (!(stop > 0)) issues.push({ field: 'stop', message: 'Stop must be a positive number.' })
    else if (ref !== null && ref > 0) {
      if (side === 'long' && stop >= ref) issues.push({ field: 'stop', message: `For a long, the stop should be below the ${label}.` })
      if (side === 'short' && stop <= ref) issues.push({ field: 'stop', message: `For a short, the stop should be above the ${label}.` })
    }
  }
  if (leverage !== undefined && (!(leverage >= 1) || leverage > 125))
    issues.push({ field: 'leverage', message: 'Leverage must be between 1x and 125x.' })
  return issues
}

function checkFlow(side: TradeSide, s: MarketSnapshot): TradeCheckItem {
  const title = 'Who is in control'
  if (s.deltaBtc === null || s.cvdBtc === null) return unknown('flow', title, 'live trades')
  const evidence = `Delta ${btc(s.deltaBtc)} · CVD ${btc(s.cvdBtc)} (${s.timeframeLabel})`
  const buyers = s.deltaBtc > 0 && s.cvdBtc > 0
  const sellers = s.deltaBtc < 0 && s.cvdBtc < 0
  if (!buyers && !sellers)
    return {
      id: 'flow',
      status: 'neutral',
      title,
      headline: 'Mixed flow: neither side is clearly in control.',
      explanation: 'Buyers and sellers are trading blows. No strong push for or against your trade right now.',
      evidence,
    }
  const withYou = (side === 'long' && buyers) || (side === 'short' && sellers)
  const who = buyers ? 'Buyers' : 'Sellers'
  return {
    id: 'flow',
    status: withYou ? 'good' : 'against',
    title,
    headline: withYou ? `${who} are in control. Flow is on your side.` : `${who} are in control, pushing against your ${side}.`,
    explanation: withYou
      ? `${who} are using market orders more aggressively than the other side, in the same direction as your trade.`
      : `${who} are using market orders more aggressively, which pushes price the opposite way to your ${side}.`,
    evidence,
  }
}

function checkDivergence(side: TradeSide, s: MarketSnapshot): TradeCheckItem {
  const title = 'Is the move real?'
  if (s.price === null || s.priceStart === null || s.cvdBtc === null || s.priceStart <= 0) return unknown('divergence', title, 'price and flow data')
  const move = ((s.price - s.priceStart) / s.priceStart) * 100
  const evidence = `Price ${pct(move)} · CVD ${btc(s.cvdBtc)} (${s.timeframeLabel})`
  const hollowRise = move > 0.05 && s.cvdBtc < 0
  const hollowDrop = move < -0.05 && s.cvdBtc > 0
  if (!hollowRise && !hollowDrop)
    return {
      id: 'divergence',
      status: 'neutral',
      title,
      headline: 'Price and buying/selling agree. No warning sign.',
      explanation: 'When price moves in the same direction as the buying or selling pressure, the move is backed by real orders.',
      evidence,
    }
  const helpsYou = (hollowRise && side === 'short') || (hollowDrop && side === 'long')
  const headline = hollowRise ? "Price is rising, but buyers aren't behind it." : "Price is falling, but sellers aren't behind it."
  return {
    id: 'divergence',
    status: helpsYou ? 'good' : 'against',
    title,
    headline: helpsYou ? `${headline} That move may fade, which would help your ${side}.` : `${headline} Your ${side} may be riding a hollow move.`,
    explanation:
      'This is called a divergence: price is going one way while net market orders go the other. Moves without real buying or selling behind them often run out of steam.',
    evidence,
  }
}

function checkAbsorption(side: TradeSide, s: MarketSnapshot): TradeCheckItem {
  const title = 'Hidden big orders'
  if (s.price === null || s.priceStart === null || s.deltaBtc === null || s.volumeBtc === null || s.priceStart <= 0)
    return unknown('absorption', title, 'price and flow data')
  const move = ((s.price - s.priceStart) / s.priceStart) * 100
  const imbalance = s.volumeBtc > 0 ? s.deltaBtc / s.volumeBtc : 0
  const evidence = `Price ${pct(move)} · Delta ${btc(s.deltaBtc)} of ${s.volumeBtc.toFixed(2)} BTC volume (${Math.round(imbalance * 100)}% one-sided)`
  const flat = Math.abs(move) <= 0.02
  if (!flat || Math.abs(imbalance) < 0.25)
    return {
      id: 'absorption',
      status: 'neutral',
      title,
      headline: 'No sign of a hidden wall soaking up orders.',
      explanation: 'Absorption is when one side pushes hard but price will not move, because a large passive trader is taking the other side.',
      evidence,
    }
  const buyersAbsorbed = imbalance > 0
  const against = (buyersAbsorbed && side === 'long') || (!buyersAbsorbed && side === 'short')
  return {
    id: 'absorption',
    status: against ? 'against' : 'good',
    title,
    headline: buyersAbsorbed
      ? `Buyers are pushing but price won't rise. A big seller is soaking it up${side === 'long' ? ' above you' : ''}.`
      : `Sellers are pushing but price won't fall. A big buyer is soaking it up${side === 'short' ? ' below you' : ''}.`,
    explanation: against
      ? `Someone with large limit orders is absorbing the side your ${side} needs. Until they are done, price may struggle to move your way.`
      : `The other side is pushing hard and getting nowhere. A large trader appears to be defending the direction of your ${side}.`,
    evidence,
  }
}

function checkRegime(side: TradeSide, s: MarketSnapshot): TradeCheckItem {
  const title = 'Trend strength (open interest)'
  if (s.oiRegimeId === null)
    return {
      id: 'regime',
      status: 'neutral',
      title,
      headline: 'No clear trend pattern in price, volume and open interest.',
      explanation: 'Open interest is the number of open leveraged positions. When it rises with price, new money is backing the move.',
      evidence: `Regime: none (${s.timeframeLabel})`,
    }
  const map: Record<OiRegimeId, { long: CheckStatus; short: CheckStatus; text: string }> = {
    'strong-uptrend': { long: 'good', short: 'against', text: 'Strong uptrend: new money is opening longs as price rises.' },
    'weak-uptrend': { long: 'caution', short: 'caution', text: 'Weak uptrend: price is rising mainly because shorts are closing, not new buyers.' },
    'strong-downtrend': { long: 'against', short: 'good', text: 'Strong downtrend: new money is opening shorts as price falls.' },
    'weak-downtrend': { long: 'caution', short: 'caution', text: 'Weak downtrend: price is falling mainly because longs are closing, and selling may be exhausting.' },
  }
  const row = map[s.oiRegimeId]
  const status = row[side]
  return {
    id: 'regime',
    status,
    title,
    headline: row.text,
    explanation:
      status === 'good'
        ? `Fresh positions are being opened in the direction of your ${side}. That usually means the move has fuel.`
        : status === 'against'
          ? `Fresh positions are being opened against your ${side}. That usually means the move against you has fuel.`
          : 'The current move is driven by people exiting rather than entering, so it may not last. Treat it with care either way.',
    evidence: `Regime: ${s.oiRegimeId} (${s.timeframeLabel})`,
  }
}

function checkLocation(side: TradeSide, s: MarketSnapshot, ref: number | null, mode: 'planning' | 'position'): TradeCheckItem {
  const title = mode === 'position' ? 'Your entry vs the average price' : 'Are you chasing?'
  if (ref === null || s.vwap === null || s.atrPct === null || s.atrPct <= 0) return unknown('location', title, 'recent candles')
  const distPct = ((ref - s.vwap) / s.vwap) * 100
  const inAtr = distPct / s.atrPct
  // Positive "expensive" means a worse price for the chosen side.
  const expensive = side === 'long' ? inAtr : -inAtr
  const evidence = `${mode === 'position' ? 'Entry' : 'Price'} ${usd(ref)} · 6h VWAP ${usd(s.vwap)} (${pct(distPct)}) · typical 15m range ${s.atrPct.toFixed(2)}%`
  const where = mode === 'position' ? 'You entered' : "You'd be entering"
  const verb = side === 'long' ? 'buying' : 'selling'
  if (expensive >= 3)
    return {
      id: 'location',
      status: 'against',
      title,
      headline: `${where} far ${side === 'long' ? 'above' : 'below'} the average price. This looks like chasing.`,
      explanation: `${verb[0].toUpperCase()}${verb.slice(1)} ${Math.abs(distPct).toFixed(2)}% away from the 6-hour average price, more than 3× a normal 15-minute move. Late entries often get caught when price snaps back toward the average.`,
      evidence,
    }
  if (expensive >= 1.5)
    return {
      id: 'location',
      status: 'caution',
      title,
      headline: `${where} ${side === 'long' ? 'above' : 'below'} the average price. You may be a little late.`,
      explanation: `Price has already moved ${Math.abs(distPct).toFixed(2)}% from the 6-hour average. Not a deal-breaker, but there's less room before a pullback.`,
      evidence,
    }
  if (expensive <= -0.5)
    return {
      id: 'location',
      status: 'good',
      title,
      headline: `${where} ${side === 'long' ? 'below' : 'above'} the average price, a good spot for a ${side}.`,
      explanation: `You're ${verb} at a better price than most traders paid over the last 6 hours (VWAP).`,
      evidence,
    }
  return {
    id: 'location',
    status: 'neutral',
    title,
    headline: `${where} close to the average price.`,
    explanation: 'Neither chasing nor getting a bargain. Price is near where most volume traded over the last 6 hours.',
    evidence,
  }
}

function checkCrowding(side: TradeSide, s: MarketSnapshot): TradeCheckItem {
  const title = 'Is everyone on the same side?'
  if (s.fundingRate === null && s.lsRatio === null) return unknown('crowding', title, 'funding and long/short data')
  const parts: string[] = []
  if (s.fundingRate !== null) parts.push(`Funding ${(s.fundingRate * 100).toFixed(4)}% / 8h`)
  if (s.lsRatio !== null) parts.push(`Long/short accounts ${s.lsRatio.toFixed(2)}${s.lsRatioAvg !== null ? ` (1h avg ${s.lsRatioAvg.toFixed(2)})` : ''}`)
  const evidence = parts.join(' · ')
  const hotLongs = s.fundingRate !== null && s.fundingRate >= 0.0003
  const hotShorts = s.fundingRate !== null && s.fundingRate <= -0.0001
  const lsShift = s.lsRatio !== null && s.lsRatioAvg !== null && s.lsRatioAvg > 0 ? (s.lsRatio - s.lsRatioAvg) / s.lsRatioAvg : 0
  const pilingLong = lsShift >= 0.05
  const pilingShort = lsShift <= -0.05

  const crowdedYourSide = side === 'long' ? hotLongs : hotShorts
  const crowdedOtherSide = side === 'long' ? hotShorts : hotLongs
  const pilingYourSide = side === 'long' ? pilingLong : pilingShort
  const yours = side === 'long' ? 'longs' : 'shorts'
  const others = side === 'long' ? 'shorts' : 'longs'

  if (crowdedYourSide)
    return {
      id: 'crowding',
      status: 'against',
      title,
      headline: `Crowded trade: ${yours} are paying a high fee to stay in.`,
      explanation: `When most traders are already ${side} and paying funding for it, there are fewer new buyers left${side === 'short' ? ' (sellers)' : ''}. If price moves against them, their forced exits can cause a sharp move against you.`,
      evidence,
    }
  if (crowdedOtherSide)
    return {
      id: 'crowding',
      status: 'good',
      title,
      headline: `The crowd is on the other side. ${others[0].toUpperCase()}${others.slice(1)} are paying to stay in.`,
      explanation: `Crowded ${others} can become fuel for your ${side}: if price moves your way, their forced exits push it further.`,
      evidence,
    }
  if (pilingYourSide)
    return {
      id: 'crowding',
      status: 'caution',
      title,
      headline: `More traders are piling into ${yours} over the last hour.`,
      explanation: `The share of accounts holding ${yours} is rising quickly. Not extreme yet, but crowded trades tend to unwind sharply.`,
      evidence,
    }
  return {
    id: 'crowding',
    status: 'neutral',
    title,
    headline: 'Positioning looks normal. No crowd warning.',
    explanation: 'Funding is near its usual level and the long/short split is stable.',
    evidence,
  }
}

function checkTrend(side: TradeSide, s: MarketSnapshot): TradeCheckItem {
  const title = 'Bigger picture (1h)'
  if (s.trendPct === null) return unknown('trend', title, 'hourly candles')
  const evidence = `1h closes ${pct(s.trendPct)} over 6 hours`
  if (Math.abs(s.trendPct) < 0.3)
    return {
      id: 'trend',
      status: 'neutral',
      title,
      headline: 'The hourly chart is moving sideways.',
      explanation: 'No strong bigger trend to fight or follow. Ranges can chop both sides, so keep targets modest.',
      evidence,
    }
  const up = s.trendPct > 0
  const withYou = (up && side === 'long') || (!up && side === 'short')
  return {
    id: 'trend',
    status: withYou ? 'good' : 'caution',
    title,
    headline: withYou ? `The hourly trend is ${up ? 'up' : 'down'}, the same direction as your ${side}.` : `You're going ${side}, but the hourly trend is ${up ? 'up' : 'down'}.`,
    explanation: withYou
      ? 'Trading with the bigger trend gives your trade the wind at its back.'
      : 'Trading against the bigger trend can work, but it is harder. Moves your way tend to be shorter.',
    evidence,
  }
}

function checkLiquidations(side: TradeSide, s: MarketSnapshot): TradeCheckItem {
  const title = 'Recent forced closures'
  const total = s.recentLongLiqUsd + s.recentShortLiqUsd
  const evidence = `Last 15m: longs ${usdCompact(s.recentLongLiqUsd)} · shorts ${usdCompact(s.recentShortLiqUsd)} (OKX reported; not all liquidations)`
  if (total < 25_000)
    return {
      id: 'liquidations',
      status: 'neutral',
      title,
      headline: 'No major forced closures in the last 15 minutes.',
      explanation: "Liquidations are traders being force-closed. Big waves can cause sudden spikes. Right now it's quiet.",
      evidence,
    }
  const sameSide = side === 'long' ? s.recentLongLiqUsd : s.recentShortLiqUsd
  const otherSide = side === 'long' ? s.recentShortLiqUsd : s.recentLongLiqUsd
  const yours = side === 'long' ? 'longs' : 'shorts'
  const others = side === 'long' ? 'shorts' : 'longs'
  if (otherSide > sameSide)
    return {
      id: 'liquidations',
      status: 'caution',
      title,
      headline: `${others[0].toUpperCase()}${others.slice(1)} were just force-closed. Part of the recent move may be a squeeze.`,
      explanation: `Forced ${others === 'shorts' ? 'buying' : 'selling'} from liquidated ${others} pushed price your way, but squeeze-driven moves can fade once the forced orders stop.`,
      evidence,
    }
  return {
    id: 'liquidations',
    status: 'neutral',
    title,
    headline: `Over-leveraged ${yours} were just flushed out.`,
    explanation: `Some weak ${yours} have already been forced out. That removes some fuel for a further move against you, but it also shows the market recently went hard the other way.`,
    evidence,
  }
}

function checkPosition(side: TradeSide, s: MarketSnapshot, entry: number, leverage: number | undefined): TradeCheckItem {
  const title = 'Where you stand'
  if (s.price === null) return unknown('position', title, 'the live price')
  const raw = ((s.price - entry) / entry) * 100 * (side === 'long' ? 1 : -1)
  const lev = leverage ?? 1
  const evidence = `Entry ${usd(entry)} · Now ${usd(s.price)} · ${pct(raw)} price move${leverage ? ` · ${pct(raw * lev, 1)} on margin at ${lev}x (before fees)` : ''}`
  return {
    id: 'position',
    status: raw >= 0 ? 'good' : 'caution',
    title,
    headline:
      raw >= 0
        ? `Price has moved ${Math.abs(raw).toFixed(2)}% in your favour${leverage ? ` (≈ ${pct(raw * lev, 1)} on your margin)` : ''}.`
        : `Price is ${Math.abs(raw).toFixed(2)}% against you${leverage ? ` (≈ ${pct(raw * lev, 1)} on your margin)` : ''}.`,
    explanation: 'This is a simple estimate from the live price. It ignores fees and funding payments.',
    evidence,
  }
}

function checkStop(side: TradeSide, s: MarketSnapshot, ref: number, stop: number): TradeCheckItem {
  const title = 'Stop vs normal wiggle'
  if (s.price !== null && ((side === 'long' && s.price <= stop) || (side === 'short' && s.price >= stop)))
    return {
      id: 'stop',
      status: 'against',
      title,
      headline: 'Price is already past your stop.',
      explanation: 'If this were a live order it would have triggered. Double-check the level you entered.',
      evidence: `Stop ${usd(stop)} · Now ${usd(s.price)}`,
    }
  if (s.atrPct === null || s.atrPct <= 0) return unknown('stop', title, 'recent candles')
  const distPct = (Math.abs(ref - stop) / ref) * 100
  const ratio = distPct / s.atrPct
  const evidence = `Stop ${usd(stop)} is ${distPct.toFixed(2)}% from ${usd(ref)} · typical 15m range ${s.atrPct.toFixed(2)}% (${ratio.toFixed(1)}×)`
  if (ratio < 1)
    return {
      id: 'stop',
      status: 'against',
      title,
      headline: `Your stop is tighter than a normal 15-minute wiggle.`,
      explanation: `BTC typically moves about ${s.atrPct.toFixed(2)}% in 15 minutes, and your stop is only ${distPct.toFixed(2)}% away. Ordinary noise could stop you out even if your idea is right.`,
      evidence,
    }
  if (ratio < 1.5)
    return {
      id: 'stop',
      status: 'caution',
      title,
      headline: 'Your stop is only just outside normal noise.',
      explanation: 'A slightly busier-than-usual few minutes could reach it. Consider whether it sits beyond a meaningful level.',
      evidence,
    }
  return {
    id: 'stop',
    status: 'good',
    title,
    headline: 'Your stop has breathing room beyond normal wiggles.',
    explanation: 'Typical short-term noise is unlikely to reach it on its own.',
    evidence,
  }
}

function checkLiquidationDistance(side: TradeSide, s: MarketSnapshot, ref: number, leverage: number, stop: number | undefined): TradeCheckItem {
  const title = 'Liquidation distance'
  const liq = approxLiquidationPrice(side, ref, leverage)
  const now = s.price ?? ref
  const distPct = side === 'long' ? ((now - liq) / now) * 100 : ((liq - now) / now) * 100
  const evidence = `≈ ${usd(liq)} at ${leverage}x (approx., isolated margin, excludes fees) · ${distPct.toFixed(2)}% from current price`
  const stopBeyondLiq = stop !== undefined && ((side === 'long' && stop <= liq) || (side === 'short' && stop >= liq))
  if (stopBeyondLiq)
    return {
      id: 'liq-distance',
      status: 'against',
      title,
      headline: 'Your stop is beyond your liquidation price. You would be force-closed first.',
      explanation: `At ${leverage}x you'd be liquidated around ${usd(liq)}, before your stop at ${usd(stop!)} is reached. Lower the leverage or move the stop.`,
      evidence,
    }
  const status: CheckStatus = distPct < 2 ? 'against' : distPct < 5 ? 'caution' : 'good'
  return {
    id: 'liq-distance',
    status,
    title,
    headline:
      status === 'against'
        ? `At ${leverage}x you'd be force-closed around ${usd(liq)}, only ${distPct.toFixed(1)}% away.`
        : status === 'caution'
          ? `At ${leverage}x you'd be force-closed around ${usd(liq)}, ${distPct.toFixed(1)}% away. Not much room.`
          : `At ${leverage}x your forced-close price is about ${usd(liq)}, ${distPct.toFixed(1)}% away.`,
    explanation:
      status === 'good'
        ? 'A comfortable buffer against normal volatility.'
        : 'High leverage means a small move against you wipes out your margin. BTC can move several percent in minutes during busy periods.',
    evidence,
  }
}

const statusOrder: Record<CheckStatus, number> = { against: 0, caution: 1, good: 2, neutral: 3, unknown: 4 }

export function evaluateTradeCheck(intent: TradeIntent, s: MarketSnapshot): TradeCheckResult {
  const issues = validateIntent(intent, s.price)
  const bad = (field: IntentIssue['field']) => issues.some(i => i.field === field)
  const hasEntry = intent.entry !== undefined && !bad('entry')
  const mode = hasEntry ? 'position' : 'planning'
  const ref = hasEntry ? intent.entry! : s.price
  const { side } = intent
  const stopValid = intent.stop !== undefined && !bad('stop')
  const levValid = intent.leverage !== undefined && !bad('leverage')

  const checks: TradeCheckItem[] = []
  if (hasEntry) checks.push(checkPosition(side, s, intent.entry!, levValid ? intent.leverage : undefined))
  checks.push(
    checkFlow(side, s),
    checkDivergence(side, s),
    checkAbsorption(side, s),
    checkRegime(side, s),
    checkLocation(side, s, ref, mode),
    checkCrowding(side, s),
    checkTrend(side, s),
    checkLiquidations(side, s),
  )
  if (stopValid && ref !== null) checks.push(checkStop(side, s, ref, intent.stop!))
  if (levValid && ref !== null) checks.push(checkLiquidationDistance(side, s, ref, intent.leverage!, stopValid ? intent.stop : undefined))

  checks.sort((a, b) => statusOrder[a.status] - statusOrder[b.status])
  const good = checks.filter(c => c.status === 'good').length
  const against = checks.filter(c => c.status === 'against').length
  const caution = checks.filter(c => c.status === 'caution').length
  const known = checks.filter(c => c.status !== 'unknown').length
  const headline =
    known === 0
      ? 'Gathering market data…'
      : `${good} in your favour · ${against} against · ${caution} to watch`
  return { mode, referencePrice: ref, issues, checks, summary: { good, against, caution, headline } }
}
