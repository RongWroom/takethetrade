import { btcToSatoshis, evaluateOiRegime, type OiRegimeEvaluation, type OiRegimeId, type PulseEvaluation } from './tradeEngine'

export type ConfirmationMode = '5m' | '15m'
export { LIQUIDATION_LARGE_USD } from './marketRules'
export const SIGNAL_RULES = {
  confirmations: 2,
  minimumPricePct: 0.02,
  priorRangeFraction: 0,
  minimumOiPct: 0.01,
  minimumVolumeChangePct: 5,
  maximumSampleGapMs: 15_000,
  maximumOiAgeMs: 90_000,
  oiRefreshMs: 30_000,
  maximumObservationGapMs: 30_000,
} as const

export type HistoricalWindowSeed = {
  start: number
  end: number
  priceStart: number
  priceEnd: number
  high?: number
  low?: number
  oiStartBtc: number
  oiEndBtc: number
  volumeBtc: number
  deltaBtc?: number | null
}

type Snapshot = {
  priceStart: number | null
  priceEnd: number | null
  deltaBtc: number | null
  cvdBtc: number | null
  volumeBtc: number | null
}

export type ConfirmationView = {
  mode: ConfirmationMode
  completed: number
  candidate: OiRegimeId | null
  confirmed: OiRegimeEvaluation | null
  pulse: PulseEvaluation
  status: 'warming' | 'pending' | 'confirmed' | 'mixed' | 'insufficient'
  lastClosedAt: number | null
  snapshot: Snapshot
  observed: OiRegimeEvaluation | null
  evaluatedWindows: number
  rejectedWindows: number
  nextCloseAt: number
  reason: string
  lastWindow: {
    start: number
    end: number
    pricePct: number | null
    oiPct: number | null
    volumeChangePct: number | null
  } | null
}

type Observation = { time: number; value: number }
type Window = {
  start: number
  first: Observation | null
  last: Observation | null
  high: number
  low: number
  oiFirst: Observation | null
  oiLast: Observation | null
  volume: bigint
  delta: bigint
  invalid: boolean
  ids: Set<string>
}

type PreviousWindow = {
  end: number
  priceStart: number
  priceEnd: number
  pricePct: number
  oiStart: number
  oiEnd: number
  oiPct: number
  volume: number
  rangePct: number
  rawRegimeId: OiRegimeId | null
}

const emptySnapshot = (): Snapshot => ({ priceStart: null, priceEnd: null, deltaBtc: null, cvdBtc: null, volumeBtc: null })
const quietPulse = (status: ConfirmationView['status']): PulseEvaluation => ({
  ruleId: status === 'mixed' ? 'confirmed-mixed' : 'insufficient-data',
  observation: status === 'mixed' ? 'Mixed / sideways' : status === 'insufficient' ? 'Insufficient data' : 'Waiting for confirmation',
  headline: status === 'mixed' ? 'No confirmed directional trend.' : status === 'insufficient' ? 'Waiting for usable market data.' : 'Waiting for two matching completed windows.',
  copy: status === 'insufficient'
    ? 'The feed is stale or interrupted. Fresh complete windows are required before confirming a trend.'
    : 'Live numbers still update immediately. Trend labels classify closed price and open-interest moves, with volume tracked as supporting confirmation.',
  evidence: 'OKX BTC-USDT-SWAP closed windows. Two consecutive matching closes confirm a trend.',
})

export class SignalConfirmation {
  private readonly mode: ConfirmationMode
  private readonly duration: number
  private eligibleStart: number
  private current: Window | null = null
  private latestOi: Observation | null = null
  private previous: PreviousWindow | null = null
  private candidate: OiRegimeId | null = null
  private completed = 0
  private misses = 0
  private confirmed: OiRegimeEvaluation | null = null
  private snapshot = emptySnapshot()
  private pulse: PulseEvaluation = quietPulse('warming')
  private status: ConfirmationView['status'] = 'warming'
  private lastClosedAt: number | null = null
  private observed: OiRegimeEvaluation | null = null
  private evaluatedWindows = 0
  private rejectedWindows = 0
  private reason = 'Collecting the first full window of price and open interest.'
  private lastWindow: ConfirmationView['lastWindow'] = null
  private lastObservationAt: number | null = null
  private suspended = false

  constructor(mode: ConfirmationMode, now: number) {
    this.mode = mode
    this.duration = mode === '15m' ? 900_000 : 300_000
    this.eligibleStart = Math.ceil(now / this.duration) * this.duration
  }

  interrupt(now: number, reason = 'The live feed was interrupted; confirmation needs fresh full windows.'): void {
    this.eligibleStart = Math.ceil(now / this.duration) * this.duration
    this.current = null
    this.latestOi = null
    this.previous = null
    this.candidate = null
    this.completed = 0
    this.misses = 0
    this.confirmed = null
    this.snapshot = emptySnapshot()
    this.status = 'insufficient'
    this.pulse = quietPulse(this.status)
    this.reason = reason
    this.pulse.copy = reason
    this.lastObservationAt = now
  }

  /**
   * Seeds initial closed windows from OKX historical REST data when no live windows
   * have been evaluated yet, eliminating the cold-start warm-up wait on page load.
   */
  seedHistory(windows: readonly HistoricalWindowSeed[], now: number): boolean {
    if (this.evaluatedWindows > 0 || windows.length === 0) return false
    const currentBoundary = Math.floor(now / this.duration) * this.duration
    const valid = windows
      .filter(
        w =>
          Number.isSafeInteger(w.start) &&
          Number.isSafeInteger(w.end) &&
          w.end - w.start === this.duration &&
          w.end <= currentBoundary &&
          Number.isFinite(w.priceStart) &&
          w.priceStart > 0 &&
          Number.isFinite(w.priceEnd) &&
          w.priceEnd > 0 &&
          Number.isFinite(w.oiStartBtc) &&
          w.oiStartBtc > 0 &&
          Number.isFinite(w.oiEndBtc) &&
          w.oiEndBtc > 0 &&
          Number.isFinite(w.volumeBtc) &&
          w.volumeBtc >= 0,
      )
      .sort((a, b) => a.start - b.start)
    if (valid.length === 0) return false

    const contiguous: HistoricalWindowSeed[] = [valid[valid.length - 1]]
    for (let i = valid.length - 2; i >= 0; i--) {
      if (valid[i].end === contiguous[0].start) {
        contiguous.unshift(valid[i])
      } else {
        break
      }
    }

    this.suspended = false
    for (const sw of contiguous) {
      const high = sw.high !== undefined && Number.isFinite(sw.high) ? sw.high : Math.max(sw.priceStart, sw.priceEnd)
      const low = sw.low !== undefined && Number.isFinite(sw.low) ? sw.low : Math.min(sw.priceStart, sw.priceEnd)
      this.evaluateCompletedWindow({
        start: sw.start,
        end: sw.end,
        priceStart: sw.priceStart,
        priceEnd: sw.priceEnd,
        high,
        low,
        oiStart: sw.oiStartBtc,
        oiEnd: sw.oiEndBtc,
        volume: sw.volumeBtc,
        deltaBtc: sw.deltaBtc ?? null,
      })
    }
    this.lastObservationAt = now
    return true
  }

  private advance(now: number): void {
    if (this.lastObservationAt !== null && now - this.lastObservationAt > SIGNAL_RULES.maximumObservationGapMs) {
      this.interrupt(now, 'Observations paused for more than 30 seconds; the incomplete window was discarded.')
    }
    this.lastObservationAt = now
    if (now < this.eligibleStart) return
    const start = Math.floor(now / this.duration) * this.duration
    if (this.current && start > this.current.start) {
      const end = this.current.start + this.duration
      this.close(this.current, end)
      if (start > end) {
        this.interrupt(now)
        if (now < this.eligibleStart) return
      }
      this.current = null
    }
    if (!this.current) {
      const seed = this.latestOi && this.latestOi.time <= start && start - this.latestOi.time <= SIGNAL_RULES.maximumOiAgeMs ? this.latestOi : null
      this.current = {
        start, first: null, last: null, high: -Infinity, low: Infinity,
        oiFirst: seed, oiLast: seed, volume: 0n, delta: 0n, invalid: false, ids: new Set(),
      }
    }
  }

  trade(input: { id: string; time: number; price: number; quantityBtc: string; side: 'buy' | 'sell' }, receivedAt: number): void {
    this.advance(receivedAt)
    const w = this.current
    if (!w || input.time < w.start || input.time >= w.start + this.duration || input.time > receivedAt + 1000) return
    if (w.ids.has(input.id)) return
    if (!Number.isFinite(input.price) || input.price <= 0) {
      w.invalid = true
      return
    }
    let quantity: bigint
    try {
      quantity = btcToSatoshis(input.quantityBtc)
    } catch {
      w.invalid = true
      return
    }
    w.ids.add(input.id)
    if (w.ids.size > 100_000) {
      this.interrupt(receivedAt, 'The per-window trade safety limit was reached; this window is incomplete.')
      return
    }
    const point = { time: input.time, value: input.price }
    if (!w.first || point.time < w.first.time) w.first = point
    if (!w.last || point.time >= w.last.time) w.last = point
    w.high = Math.max(w.high, input.price)
    w.low = Math.min(w.low, input.price)
    w.volume += quantity
    w.delta += input.side === 'buy' ? quantity : -quantity
  }

  openInterest(input: { time: number; btc: number }, receivedAt: number): void {
    this.advance(receivedAt)
    if (!Number.isFinite(input.btc) || input.btc <= 0 || input.time > receivedAt + 1000) return
    if (this.latestOi && input.time <= this.latestOi.time) return
    const point = { time: input.time, value: input.btc }
    this.latestOi = point
    const w = this.current
    if (!w || point.time < w.start || point.time >= w.start + this.duration) return
    if (!w.oiFirst) w.oiFirst = point
    w.oiLast = point
  }

  private evaluateCompletedWindow(params: {
    start: number
    end: number
    priceStart: number
    priceEnd: number
    high: number
    low: number
    oiStart: number
    oiEnd: number
    volume: number
    deltaBtc: number | null
  }): void {
    const { start, end, priceStart, priceEnd, high, low, oiStart, oiEnd, volume, deltaBtc } = params
    this.lastClosedAt = end
    const pricePct = (priceEnd / priceStart - 1) * 100
    const oiPct = (oiEnd / oiStart - 1) * 100
    const volumePct = this.previous && this.previous.volume > 0 ? (volume / this.previous.volume - 1) * 100 : null
    this.lastWindow = { start, end, pricePct, oiPct, volumeChangePct: volumePct }
    this.evaluatedWindows++

    const priceThreshold = Math.max(SIGNAL_RULES.minimumPricePct, (this.previous?.rangePct ?? 0) * SIGNAL_RULES.priorRangeFraction)
    const oiThreshold = SIGNAL_RULES.minimumOiPct

    const isConsecutive = this.previous !== null && this.previous.end === start
    const samePriceSign =
      isConsecutive &&
      Math.abs(pricePct) > 1e-9 &&
      Math.abs(this.previous!.pricePct) > 1e-9 &&
      Math.sign(pricePct) === Math.sign(this.previous!.pricePct)
    const sameOiSign =
      isConsecutive &&
      Math.abs(oiPct) > 1e-9 &&
      Math.abs(this.previous!.oiPct) > 1e-9 &&
      Math.sign(oiPct) === Math.sign(this.previous!.oiPct)

    const net2PricePct =
      isConsecutive && this.previous!.priceStart > 0
        ? (priceEnd / this.previous!.priceStart - 1) * 100
        : null
    const net2OiPct =
      isConsecutive && this.previous!.oiStart > 0
        ? (oiEnd / this.previous!.oiStart - 1) * 100
        : null

    const singlePricePass = Math.abs(pricePct) + 1e-10 >= priceThreshold
    const twoBarPricePass =
      samePriceSign &&
      Math.abs(pricePct) + 1e-10 >= priceThreshold * 0.5 &&
      Math.abs(this.previous!.pricePct) + 1e-10 >= priceThreshold * 0.5 &&
      net2PricePct !== null &&
      Math.abs(net2PricePct) + 1e-10 >= priceThreshold
    const pricePass = singlePricePass || twoBarPricePass

    const singleOiPass = Math.abs(oiPct) + 1e-10 >= oiThreshold
    const twoBarOiPass =
      sameOiSign &&
      Math.abs(oiPct) + 1e-10 >= oiThreshold * 0.5 &&
      Math.abs(this.previous!.oiPct) + 1e-10 >= oiThreshold * 0.5 &&
      net2OiPct !== null &&
      Math.abs(net2OiPct) + 1e-10 >= oiThreshold
    const oiPass = singleOiPass || twoBarOiPass

    const evaluation = evaluateOiRegime({
      priceStart,
      priceEnd: pricePass ? priceEnd : priceStart,
      oiStartBtc: oiStart,
      oiEndBtc: oiPass ? oiEnd : oiStart,
      volumeSeriesBtc:
        this.previous !== null && volumePct !== null && Math.abs(volumePct) + 1e-10 >= SIGNAL_RULES.minimumVolumeChangePct
          ? [this.previous.volume, volume]
          : [],
    })

    const rawEvaluation = evaluateOiRegime({
      priceStart,
      priceEnd,
      oiStartBtc: oiStart,
      oiEndBtc: oiEnd,
      volumeSeriesBtc: [],
    })

    this.observed = evaluation
    const volumeNote =
      volumePct === null
        ? 'Volume baseline established on this window.'
        : evaluation.volumeConfirmsOi
          ? `Volume (${volumePct >= 0 ? '+' : ''}${volumePct.toFixed(1)}%) confirms the open-interest move.`
          : `Volume changed ${volumePct >= 0 ? '+' : ''}${volumePct.toFixed(1)}% vs the prior window.`

    this.reason =
      evaluation.priceDirection === 'flat'
        ? `Price moved ${pricePct.toFixed(3)}%, inside the ${priceThreshold.toFixed(3)}% noise band.`
        : evaluation.oiDirection === 'flat'
          ? `Price is ${evaluation.priceDirection}, but open interest changed only ${oiPct.toFixed(3)}% (minimum ${oiThreshold}%).`
          : `This completed window supports ${evaluation.activeRow!.marketTitle.toLowerCase()} (${evaluation.activeRow!.sentiment.toLowerCase()}). ${volumeNote}`

    const id = evaluation.activeRowId
    const twoBarSameRegime =
      id !== null &&
      isConsecutive &&
      this.previous!.rawRegimeId === id &&
      samePriceSign &&
      sameOiSign &&
      twoBarPricePass &&
      twoBarOiPass

    if (id !== null) {
      if (id === this.candidate || twoBarSameRegime) {
        this.completed = Math.min(2, Math.max(this.completed + 1, twoBarSameRegime ? 2 : 1))
      } else {
        this.completed = 1
      }
    } else {
      this.completed = 0
    }
    this.candidate = id
    this.previous = {
      end,
      priceStart,
      priceEnd,
      pricePct,
      oiStart,
      oiEnd,
      oiPct,
      volume,
      rangePct: ((high - low) / priceStart) * 100,
      rawRegimeId: rawEvaluation.activeRowId,
    }

    if (id !== null && this.completed === 2) {
      this.confirmed = evaluation
      this.misses = 0
      this.snapshot = { priceStart, priceEnd, deltaBtc, cvdBtc: deltaBtc, volumeBtc: volume }
      this.status = 'confirmed'
      this.reason = `Two consecutive completed ${this.mode} windows support ${evaluation.activeRow!.marketTitle.toLowerCase()}. ${volumeNote}`
      this.pulse = {
        ruleId: `confirmed-${id}`,
        observation: `Confirmed ${evaluation.activeRow!.marketTitle.toLowerCase()}`,
        headline: evaluation.activeRow!.marketTitle,
        copy: `Two consecutive ${this.mode} closes support this price/OI pattern. This is confirmation of observed conditions, not a prediction.`,
        evidence: `Latest closed window: price ${pricePct.toFixed(3)}% (minimum ${priceThreshold.toFixed(3)}%) · OI ${oiPct.toFixed(3)}% · volume ${volumePct === null ? 'baseline pending' : `${volumePct.toFixed(1)}% vs prior window`}${deltaBtc !== null ? ` · delta ${deltaBtc.toFixed(4)} BTC` : ''} · close ${new Date(end).toISOString()}`,
      }
    } else {
      this.misses++
      if (this.misses >= 2) {
        this.confirmed = null
        this.snapshot = emptySnapshot()
      }
      this.status = id !== null || this.confirmed ? 'pending' : 'mixed'
      if (!this.confirmed) {
        this.pulse = quietPulse(this.status)
        if (id !== null) {
          this.pulse.observation = `Candidate: ${evaluation.activeRow!.marketTitle}`
          this.pulse.headline = `${evaluation.activeRow!.marketTitle}: one close, awaiting second close.`
        } else {
          this.pulse.headline = `Price ${evaluation.priceDirection}; open interest ${evaluation.oiDirection}.`
        }
        this.pulse.copy = this.reason
        this.pulse.evidence = `Closed ${new Date(start).toISOString()} to ${new Date(end).toISOString()} · price ${pricePct.toFixed(3)}% · OI ${oiPct.toFixed(3)}% · volume ${volumePct === null ? 'baseline only' : `${volumePct.toFixed(1)}% vs previous window`}`
      }
    }
  }

  private close(w: Window, end: number): void {
    this.lastClosedAt = end
    const maxGap = SIGNAL_RULES.maximumSampleGapMs
    const pricePct = w.first && w.last ? (w.last.value / w.first.value - 1) * 100 : null
    const oiPct = w.oiFirst && w.oiLast ? (w.oiLast.value / w.oiFirst.value - 1) * 100 : null
    const volume = Number(w.volume) / 1e8
    const volumePct = this.previous && this.previous.volume > 0 ? (volume / this.previous.volume - 1) * 100 : null
    this.lastWindow = { start: w.start, end, pricePct, oiPct, volumeChangePct: volumePct }
    const invalidReason = w.invalid
      ? 'Invalid trade data made this window incomplete.'
      : !w.first || !w.last || w.first.time - w.start > maxGap || end - w.last.time > maxGap
        ? 'Trade observations did not cover the start and end of this window.'
        : !w.oiFirst || !w.oiLast
          ? 'No usable open-interest snapshot covered this window.'
          : w.oiFirst.time > w.start + SIGNAL_RULES.maximumOiAgeMs || w.start - w.oiFirst.time > SIGNAL_RULES.maximumOiAgeMs
            ? 'No recent open-interest baseline was available at the window start.'
            : end - w.oiLast.time > SIGNAL_RULES.maximumOiAgeMs
              ? 'The latest open-interest snapshot was more than 90 seconds old at the close.'
              : null
    if (invalidReason !== null || !w.first || !w.last || !w.oiFirst || !w.oiLast || pricePct === null || oiPct === null) {
      this.rejectedWindows++
      this.confirmed = null
      this.candidate = null
      this.completed = 0
      this.misses = 0
      this.previous = null
      this.snapshot = emptySnapshot()
      this.status = 'insufficient'
      this.reason = invalidReason ?? 'Window data was incomplete.'
      this.pulse = quietPulse(this.status)
      this.pulse.copy = this.reason
      return
    }
    this.evaluateCompletedWindow({
      start: w.start,
      end,
      priceStart: w.first.value,
      priceEnd: w.last.value,
      high: w.high,
      low: w.low,
      oiStart: w.oiFirst.value,
      oiEnd: w.oiLast.value,
      volume,
      deltaBtc: Number(w.delta) / 1e8,
    })
  }

  view(now: number, healthy: boolean, reason?: string): ConfirmationView {
    if (!healthy) {
      if (!this.suspended) this.interrupt(now, reason)
      this.suspended = true
      if (reason) {
        this.reason = reason
        this.pulse.copy = reason
      }
    }
    else {
      if (this.suspended) {
        const oi = this.latestOi
        this.interrupt(now, 'The feed is available again; collecting fresh complete windows.')
        if (oi && now - oi.time <= SIGNAL_RULES.maximumOiAgeMs) this.latestOi = oi
        this.suspended = false
      }
      if (this.status === 'insufficient' && this.current === null) {
        this.status = this.evaluatedWindows === 0 && this.rejectedWindows === 0 ? 'warming' : 'insufficient'
        this.pulse = quietPulse(this.status)
      }
      this.advance(now)
    }
    return {
      mode: this.mode, completed: this.completed, candidate: this.candidate, confirmed: this.confirmed,
      pulse: this.pulse, status: this.status, lastClosedAt: this.lastClosedAt, snapshot: { ...this.snapshot },
      observed: this.observed, evaluatedWindows: this.evaluatedWindows, rejectedWindows: this.rejectedWindows,
      nextCloseAt: Math.max(this.eligibleStart, Math.floor(now / this.duration) * this.duration) + this.duration,
      reason: this.reason, lastWindow: this.lastWindow ? { ...this.lastWindow } : null,
    }
  }
}
