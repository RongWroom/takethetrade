import { describe, expect, it, vi } from 'vitest'
import { SignalConfirmation, SIGNAL_RULES } from './signalConfirmation'
import { buildConfirmationSeeds, loadOiSamples } from '../features/LiveOverview'

const duration = 300_000
type Options = { pricePct?: number; oiPct?: number; quantity?: string; omitOiAt?: number; duplicate?: boolean }
const baselines = new WeakMap<SignalConfirmation, { price: number; oi: number }>()

function fillWindow(tracker: SignalConfirmation, start: number, options: Options = {}, windowMs = duration) {
  const { pricePct = 0.1, oiPct = 0.1, quantity = '1', omitOiAt, duplicate = false } = options
  const baseline = baselines.get(tracker) ?? { price: 80_000, oi: 30_000 }
  for (let offset = 0; offset < windowMs; offset += 10_000) {
    const fraction = offset / (windowMs - 10_000)
    const time = start + offset
    if (offset !== omitOiAt) tracker.openInterest({ time, btc: baseline.oi * (1 + oiPct / 100 * fraction) }, time)
    const trade = { id: String(time), time, price: baseline.price * (1 + pricePct / 100 * fraction), quantityBtc: quantity, side: 'buy' as const }
    tracker.trade(trade, time)
    if (duplicate) tracker.trade(trade, time)
  }
  baselines.set(tracker, { price: baseline.price * (1 + pricePct / 100), oi: baseline.oi * (1 + oiPct / 100) })
  return tracker.view(start + windowMs, true)
}

function confirmedTracker() {
  const tracker = new SignalConfirmation('5m', 0)
  fillWindow(tracker, 0)
  fillWindow(tracker, duration, { quantity: '1.2' })
  const view = fillWindow(tracker, 2 * duration, { quantity: '1.44' })
  expect(view.status).toBe('confirmed')
  expect(view.confirmed?.activeRowId).toBe('strong-uptrend')
  return tracker
}

describe('closed-window signal confirmation', () => {
  it('confirms on the first completed window and keeps confirming on the next', () => {
    const tracker = new SignalConfirmation('5m', 0)
    const first = fillWindow(tracker, 0, { quantity: '1.2' })
    expect(first.completed).toBe(1)
    expect(first.status).toBe('confirmed')
    expect(first.candidate).toBe('strong-uptrend')
    expect(first.observed?.activeRowId).toBe('strong-uptrend')
    expect(first.confirmed?.activeRowId).toBe('strong-uptrend')
    for (let i = 1; i <= 5; i++) expect(tracker.view(duration + i * 1000, true).completed).toBe(1)
    const second = fillWindow(tracker, duration, { quantity: '1.44' })
    expect(second.completed).toBe(1)
    expect(second.status).toBe('confirmed')
    expect(second.confirmed?.activeRowId).toBe('strong-uptrend')
    expect(second.snapshot.deltaBtc).toBeCloseTo(43.2)
    expect(second.snapshot.cvdBtc).toBeCloseTo(43.2)
    expect(second.snapshot.priceEnd).toBeCloseTo(80_000 * 1.001 ** 2)
    expect(second.lastClosedAt).toBe(2 * duration)
  })

  it('does not count the partial window on page load', () => {
    const tracker = new SignalConfirmation('5m', 1000)
    tracker.openInterest({ time: 10_000, btc: 30_000 }, 10_000)
    tracker.trade({ id: 'partial', time: 10_000, price: 80_000, quantityBtc: '100', side: 'buy' }, 10_000)
    expect(tracker.view(duration, true).lastClosedAt).toBeNull()
    expect(fillWindow(tracker, duration).completed).toBe(1)
    expect(fillWindow(tracker, 2 * duration, { quantity: '1.2' }).completed).toBe(1)
  })

  it('switches to an opposing close immediately and uses matching pulse and snapshot', () => {
    const tracker = confirmedTracker()
    const first = fillWindow(tracker, 3 * duration, { pricePct: -0.1, quantity: '1.728' })
    expect(first.status).toBe('confirmed')
    expect(first.candidate).toBe('strong-downtrend')
    expect(first.confirmed?.activeRowId).toBe('strong-downtrend')
    expect(first.pulse.ruleId).toBe('confirmed-strong-downtrend')
  })

  it('does not preserve an old trend through two mixed or different unsupported closes', () => {
    const tracker = confirmedTracker()
    expect(fillWindow(tracker, 3 * duration, { pricePct: 0.001 }).confirmed).not.toBeNull()
    const second = fillWindow(tracker, 4 * duration, { pricePct: -0.001 })
    expect(second.confirmed).toBeNull()
    expect(second.status).toBe('mixed')
    expect(second.snapshot.deltaBtc).toBeNull()
    expect(second.pulse.ruleId).toBe('confirmed-mixed')
  })

  it('classifies strong regimes from price + OI even when volume does not jump, while filtering sub-threshold noise', () => {
    for (const options of [{ pricePct: 0.005 }, { oiPct: 0.004 }]) {
      const tracker = new SignalConfirmation('5m', 0)
      expect(fillWindow(tracker, 0, options).candidate).toBeNull()
      expect(fillWindow(tracker, duration, options).confirmed).toBeNull()
    }
    const steadyVolumeTracker = new SignalConfirmation('5m', 0)
    expect(fillWindow(steadyVolumeTracker, 0, { quantity: '1' }).candidate).toBe('strong-uptrend')
    const confirmedSteady = fillWindow(steadyVolumeTracker, duration, { quantity: '1' })
    expect(confirmedSteady.confirmed?.activeRowId).toBe('strong-uptrend')
    expect(confirmedSteady.confirmed?.volumeConfirmsOi).toBe(false)
  })

  it('confirms on the second close when two same-direction closes combine to clear the threshold', () => {
    const tracker = new SignalConfirmation('5m', 0)
    const first = fillWindow(tracker, 0, { pricePct: 0.012, oiPct: 0.006 })
    expect(first.completed).toBe(0)
    const second = fillWindow(tracker, duration, { pricePct: 0.012, oiPct: 0.006 })
    expect(second.completed).toBe(1)
    expect(second.status).toBe('confirmed')
    expect(second.confirmed?.activeRowId).toBe('strong-uptrend')
  })

  it('includes exact threshold boundaries without floating-point sign noise', () => {
    const tracker = new SignalConfirmation('5m', 0)
    const first = fillWindow(tracker, 0, { pricePct: SIGNAL_RULES.minimumPricePct, oiPct: SIGNAL_RULES.minimumOiPct, quantity: '1' })
    expect(first.candidate).toBe('strong-uptrend')
    expect(
      fillWindow(tracker, duration, { pricePct: SIGNAL_RULES.minimumPricePct, oiPct: SIGNAL_RULES.minimumOiPct, quantity: '1.1' }).confirmed?.activeRowId,
    ).toBe('strong-uptrend')
  })

  it('supports weak regimes without pretending decreasing OI proves reversal', () => {
    const tracker = new SignalConfirmation('5m', 0)
    expect(fillWindow(tracker, 0, { oiPct: -0.1 }).candidate).toBe('weak-uptrend')
    const view = fillWindow(tracker, duration, { oiPct: -0.1 })
    expect(view.confirmed?.activeRowId).toBe('weak-uptrend')
    expect(view.pulse.copy).toContain('not a prediction')
  })

  it('invalidates stale, interrupted, skipped or incomplete windows', () => {
    const tracker = confirmedTracker()
    expect(tracker.view(3 * duration + 1000, false).confirmed).toBeNull()
    expect(tracker.view(3 * duration + 2000, true).completed).toBe(0)
    const gapTracker = new SignalConfirmation('5m', 0)
    expect(fillWindow(gapTracker, 0, { omitOiAt: 20_000 }).evaluatedWindows).toBe(1)
    const skipped = confirmedTracker()
    expect(skipped.view(6 * duration + 1000, true).confirmed).toBeNull()
    const noTrades = new SignalConfirmation('5m', 0)
    noTrades.view(0, true)
    expect(noTrades.view(duration, true).status).toBe('insufficient')
  })

  it('deduplicates trades and excludes late previous-window and future events', () => {
    const tracker = new SignalConfirmation('5m', 0)
    fillWindow(tracker, 0, { duplicate: true })
    fillWindow(tracker, duration, { quantity: '1.2', duplicate: true })
    tracker.trade({ id: 'late', time: duration, price: 1, quantityBtc: '100', side: 'sell' }, 2 * duration)
    tracker.trade({ id: 'future', time: 3 * duration, price: 1, quantityBtc: '100', side: 'sell' }, 2 * duration)
    const view = fillWindow(tracker, 2 * duration, { quantity: '1.44', duplicate: true })
    expect(view.snapshot.volumeBtc).toBeCloseTo(43.2)
    expect(view.confirmed?.activeRowId).toBe('strong-uptrend')
  })

  it('uses full 15-minute windows in slow mode', () => {
    const tracker = new SignalConfirmation('15m', 0)
    const slow = 900_000
    expect(fillWindow(tracker, 0, {}, slow).completed).toBe(1)
    const view = fillWindow(tracker, slow, { quantity: '1.2' }, slow)
    expect(view.completed).toBe(1)
    expect(view.confirmed?.activeRowId).toBe('strong-uptrend')
    expect(view.mode).toBe('15m')
    expect(view.lastClosedAt).toBe(2 * slow)
    expect(SIGNAL_RULES.confirmations).toBe(1)
  })

  it('evaluates an hour of quiet OI as mixed, rather than restarting warm-up', () => {
    const tracker = new SignalConfirmation('5m', 0)
    for (let time = 0; time < 12 * duration; time += 10_000) {
      if (time % 60_000 === 0) tracker.openInterest({ time, btc: 30_000 }, time)
      tracker.trade({ id: `hour-${time}`, time, price: 80_000 + time / 100_000, quantityBtc: '1', side: 'buy' }, time)
      tracker.view(time, true)
    }
    const view = tracker.view(12 * duration, true)
    expect(view.evaluatedWindows).toBe(12)
    expect(view.rejectedWindows).toBe(0)
    expect(view.status).toBe('mixed')
    expect(view.observed?.priceDirection).toBe('flat')
    expect(view.observed?.oiDirection).toBe('flat')
    expect(view.lastWindow?.pricePct).toBeGreaterThan(0)
    expect(view.lastWindow?.oiPct).toBe(0)
    expect(view.lastClosedAt).toBe(12 * duration)
    expect(view.nextCloseAt).toBe(13 * duration)
    expect(view.pulse.headline).not.toContain('Waiting')
  })

  it('accepts once-per-minute OI and confirms over two windows without requiring 15-second updates', () => {
    const tracker = new SignalConfirmation('5m', 0)
    for (let time = 0; time < 2 * duration; time += 10_000) {
      if (time % 60_000 === 0) tracker.openInterest({ time, btc: 30_000 - 30 * time / duration }, time)
      tracker.trade({ id: `minute-${time}`, time, price: 80_000 + 100 * time / duration, quantityBtc: '1', side: 'buy' }, time)
      tracker.view(time, true)
    }
    const view = tracker.view(2 * duration, true)
    expect(view.evaluatedWindows).toBe(2)
    expect(view.rejectedWindows).toBe(0)
    expect(view.confirmed?.activeRowId).toBe('weak-uptrend')
  })

  it('reports missing or expired OI without claiming observed flat conditions', () => {
    for (const withInitialOi of [false, true]) {
      const tracker = new SignalConfirmation('5m', 0)
      if (withInitialOi) tracker.openInterest({ time: 0, btc: 30_000 }, 0)
      for (let time = 0; time < duration; time += 10_000) {
        tracker.trade({ id: String(time), time, price: 80_000 + time / 1000, quantityBtc: '1', side: 'buy' }, time)
      }
      const view = tracker.view(duration, true)
      expect(view.status).toBe('insufficient')
      expect(view.evaluatedWindows).toBe(0)
      expect(view.rejectedWindows).toBe(1)
      expect(view.observed).toBeNull()
      expect(view.reason).toContain(withInitialOi ? '90 seconds old' : 'No usable open-interest')
      expect(view.lastWindow?.pricePct).toBeGreaterThan(0)
    }
  })

  it('retains evaluated-window diagnostics across a genuine interruption', () => {
    const tracker = confirmedTracker()
    const before = tracker.view(3 * duration, true)
    tracker.view(3 * duration + 1000, false, 'Connection closed.')
    const after = tracker.view(3 * duration + 5000, false, 'Connection closed.')
    expect(after.confirmed).toBeNull()
    expect(after.evaluatedWindows).toBe(before.evaluatedWindows)
    expect(after.lastClosedAt).toBe(before.lastClosedAt)
    expect(after.lastWindow).toEqual(before.lastWindow)
    expect(after.reason).toBe('Connection closed.')
  })

  it('discards a window when observation processing actually pauses', () => {
    const tracker = confirmedTracker()
    const view = tracker.view(3 * duration + SIGNAL_RULES.maximumObservationGapMs + 1, true)
    expect(view.confirmed).toBeNull()
    expect(view.status).toBe('insufficient')
    expect(view.reason).toContain('Observations paused')
    expect(view.evaluatedWindows).toBe(3)
  })

  it('seeds initial closed windows from OKX REST history to avoid cold-start warm-up', () => {
    const now = 3 * duration + 45_000
    const tracker = new SignalConfirmation('5m', now)
    const seeds = buildConfirmationSeeds({
      now,
      duration,
      candles: [
        { time: duration, open: 80_000, high: 80_100, low: 79_990, close: 80_050, volumeBtc: 100 },
        { time: 2 * duration, open: 80_050, high: 80_150, low: 80_040, close: 80_110, volumeBtc: 120 },
      ],
      takerBuckets: [
        { time: duration, sellBtc: 40, buyBtc: 60, deltaBtc: 20, volumeBtc: 100 },
        { time: 2 * duration, sellBtc: 45, buyBtc: 75, deltaBtc: 30, volumeBtc: 120 },
      ],
      oiPoints: [
        { time: 0, oiUsd: 2_400_000_000 },
        { time: duration, oiUsd: 2_402_000_000 },
        { time: 2 * duration, oiUsd: 2_405_000_000 },
      ],
    })
    expect(seeds).toHaveLength(2)
    expect(tracker.seedHistory(seeds, now)).toBe(true)
    const view = tracker.view(now, true)
    expect(view.status).toBe('confirmed')
    expect(view.completed).toBe(1)
    expect(view.confirmed?.activeRowId).toBe('strong-uptrend')
    expect(view.evaluatedWindows).toBe(2)
  })

  it('seeds closed windows from locally sampled OI when the rubik history is unavailable (CORS)', () => {
    const now = 3 * duration + 45_000
    const seeds = buildConfirmationSeeds({
      now,
      duration,
      candles: [
        { time: duration, open: 80_000, high: 80_100, low: 79_990, close: 80_050, volumeBtc: 100 },
        { time: 2 * duration, open: 80_050, high: 80_150, low: 80_040, close: 80_110, volumeBtc: 120 },
      ],
      takerBuckets: [],
      oiSamples: [
        { time: duration - 20_000, btc: 30_000 },
        { time: 2 * duration - 10_000, btc: 30_030 },
        { time: 3 * duration - 30_000, btc: 30_070 },
      ],
    })
    expect(seeds).toHaveLength(2)
    expect(seeds[0]).toMatchObject({ start: duration, oiStartBtc: 30_000, oiEndBtc: 30_030, volumeBtc: 100 })
    const tracker = new SignalConfirmation('5m', now)
    expect(tracker.seedHistory(seeds, now)).toBe(true)
    expect(tracker.view(now, true).status).toBe('confirmed')
  })

  it('restores persisted OI samples after a reload, dropping stale, future and out-of-order entries', () => {
    const now = 10_000_000
    const store = JSON.stringify([
      { time: now - 3 * 60 * 60_000, btc: 30_000 },
      { time: now - 120_000, btc: 30_010 },
      { time: now - 150_000, btc: 30_005 },
      { time: now - 60_000, btc: -1 },
      { time: now - 30_000, btc: 30_020 },
      { time: now + 600_000, btc: 30_030 },
      null,
    ])
    vi.stubGlobal('localStorage', { getItem: () => store })
    expect(loadOiSamples(now)).toEqual([
      { time: now - 120_000, btc: 30_010 },
      { time: now - 30_000, btc: 30_020 },
    ])
    vi.stubGlobal('localStorage', { getItem: () => '{bad json' })
    expect(loadOiSamples(now)).toEqual([])
    vi.unstubAllGlobals()
  })

  it('confirms two consecutive green closes when their 2-window net OI increases despite a 1-bar OI dip', () => {
    const now = 2 * duration + 10_000
    const tracker = new SignalConfirmation('5m', now)
    tracker.seedHistory(
      [
        {
          start: 0,
          end: duration,
          priceStart: 64_600,
          priceEnd: 64_625,
          oiStartBtc: 46_340,
          oiEndBtc: 46_280,
          volumeBtc: 14_400,
        },
        {
          start: duration,
          end: 2 * duration,
          priceStart: 64_625,
          priceEnd: 64_895,
          oiStartBtc: 46_085,
          oiEndBtc: 46_230,
          volumeBtc: 50_700,
        },
      ],
      now,
    )
    const view = tracker.view(now, true)
    expect(view.status).toBe('confirmed')
    expect(view.completed).toBe(1)
    expect(view.confirmed?.activeRowId).toBe('strong-uptrend')
  })

  it('catches up on newly closed REST windows and recovers after an interruption', () => {
    const tracker = new SignalConfirmation('5m', duration + 5_000)
    tracker.seedHistory(
      [
        {
          start: 0,
          end: duration,
          priceStart: 80_000,
          priceEnd: 80_080,
          oiStartBtc: 30_000,
          oiEndBtc: 30_030,
          volumeBtc: 100,
        },
      ],
      duration + 5_000,
    )
    expect(tracker.view(duration + 5_000, true).status).toBe('confirmed')

    const caughtUp = tracker.seedHistory(
      [
        {
          start: 0,
          end: duration,
          priceStart: 80_000,
          priceEnd: 80_080,
          oiStartBtc: 30_000,
          oiEndBtc: 30_030,
          volumeBtc: 100,
        },
        {
          start: duration,
          end: 2 * duration,
          priceStart: 80_080,
          priceEnd: 80_160,
          oiStartBtc: 30_030,
          oiEndBtc: 30_070,
          volumeBtc: 120,
        },
      ],
      2 * duration + 5_000,
    )
    expect(caughtUp).toBe(true)
    expect(tracker.view(2 * duration + 5_000, true).status).toBe('confirmed')
  })
})
