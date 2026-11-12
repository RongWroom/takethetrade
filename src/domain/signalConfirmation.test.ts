import { describe, expect, it } from 'vitest'
import { SignalConfirmation, SIGNAL_RULES } from './signalConfirmation'

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
  it('uses a volume baseline then two distinct completed windows, never refresh counts', () => {
    const tracker = new SignalConfirmation('5m', 0)
    expect(fillWindow(tracker, 0).completed).toBe(0)
    const first = fillWindow(tracker, duration, { quantity: '1.2' })
    expect(first.completed).toBe(1)
    expect(first.confirmed).toBeNull()
    for (let i = 1; i <= 5; i++) expect(tracker.view(2 * duration + i * 1000, true).completed).toBe(1)
    const second = fillWindow(tracker, 2 * duration, { quantity: '1.44' })
    expect(second.completed).toBe(2)
    expect(second.confirmed?.activeRowId).toBe('strong-uptrend')
    expect(second.snapshot.deltaBtc).toBeCloseTo(43.2)
    expect(second.snapshot.cvdBtc).toBeCloseTo(43.2)
    expect(second.snapshot.priceEnd).toBeCloseTo(80_000 * 1.001 ** 3)
    expect(second.lastClosedAt).toBe(3 * duration)
  })

  it('does not count the partial window on page load', () => {
    const tracker = new SignalConfirmation('5m', 1000)
    tracker.openInterest({ time: 10_000, btc: 30_000 }, 10_000)
    tracker.trade({ id: 'partial', time: 10_000, price: 80_000, quantityBtc: '100', side: 'buy' }, 10_000)
    expect(tracker.view(duration, true).lastClosedAt).toBeNull()
    expect(fillWindow(tracker, duration).completed).toBe(0)
    expect(fillWindow(tracker, 2 * duration, { quantity: '1.2' }).completed).toBe(1)
  })

  it('holds one opposing close, confirms two, and uses matching pulse and snapshot', () => {
    const tracker = confirmedTracker()
    const opposing = { pricePct: -0.1, quantity: '1.728' }
    const first = fillWindow(tracker, 3 * duration, opposing)
    expect(first.status).toBe('pending')
    expect(first.candidate).toBe('strong-downtrend')
    expect(first.confirmed?.activeRowId).toBe('strong-uptrend')
    const second = fillWindow(tracker, 4 * duration, { ...opposing, quantity: '2.0736' })
    expect(second.confirmed?.activeRowId).toBe('strong-downtrend')
    expect(second.pulse.ruleId).toBe('confirmed-strong-downtrend')
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

  it('filters price and OI noise and requires increasing volume for strong regimes', () => {
    for (const options of [{ pricePct: 0.049 }, { oiPct: 0.049 }, { quantity: '1' }]) {
      const tracker = new SignalConfirmation('5m', 0)
      fillWindow(tracker, 0)
      expect(fillWindow(tracker, duration, options).candidate).toBeNull()
      expect(fillWindow(tracker, 2 * duration, options).confirmed).toBeNull()
    }
  })

  it('scales the price noise floor with the prior observed range', () => {
    const tracker = new SignalConfirmation('5m', 0)
    fillWindow(tracker, 0, { pricePct: 1 })
    expect(fillWindow(tracker, duration, { pricePct: 0.1, quantity: '1.2' }).candidate).toBeNull()
  })

  it('includes exact threshold boundaries without floating-point sign noise', () => {
    const tracker = new SignalConfirmation('5m', 0)
    fillWindow(tracker, 0)
    const first = fillWindow(tracker, duration, { pricePct: 0.05, oiPct: 0.05, quantity: '1.1' })
    expect(first.candidate).toBe('strong-uptrend')
    expect(fillWindow(tracker, 2 * duration, { pricePct: 0.05, oiPct: 0.05, quantity: '1.21' }).confirmed?.activeRowId).toBe('strong-uptrend')
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
    expect(fillWindow(gapTracker, 0, { omitOiAt: 20_000 }).status).toBe('insufficient')
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
    fillWindow(tracker, 0, {}, slow)
    expect(fillWindow(tracker, slow, { quantity: '1.2' }, slow).completed).toBe(1)
    const view = fillWindow(tracker, 2 * slow, { quantity: '1.44' }, slow)
    expect(view.confirmed?.activeRowId).toBe('strong-uptrend')
    expect(view.mode).toBe('15m')
    expect(view.lastClosedAt).toBe(3 * slow)
    expect(SIGNAL_RULES.confirmations).toBe(2)
  })
})
