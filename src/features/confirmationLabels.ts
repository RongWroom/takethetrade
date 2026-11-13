import { SIGNAL_RULES, type ConfirmationView } from '../domain/signalConfirmation'
import { OI_CHEAT_SHEET_ROWS } from '../domain/tradeEngine'

const STATUS_LABEL: Record<ConfirmationView['status'], string> = {
  warming: 'Warming up',
  pending: 'Pending',
  confirmed: 'Confirmed',
  mixed: 'Mixed',
  insufficient: 'Insufficient data',
}

const utcTime = (t: number) => `${new Date(t).toISOString().slice(11, 16)} UTC`

const signedPct = (n: number | null) => (n === null ? 'unavailable' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`)

export function describeConfirmation(view: ConfirmationView): { status: string; progress: string; detail: string; reason: string } {
  const { mode, status, completed, candidate, lastWindow, evaluatedWindows, rejectedWindows, nextCloseAt, reason } = view
  const title = candidate ? OI_CHEAT_SHEET_ROWS.find(r => r.id === candidate)?.marketTitle ?? candidate : null
  const required = SIGNAL_RULES.confirmations
  const progress =
    status === 'confirmed'
      ? `${title ?? 'Regime'}: ${completed} of ${required} matching ${mode} closes.`
      : status === 'pending'
        ? `Candidate ${title ?? 'none'}: ${completed} of ${required} matching ${mode} closes.`
        : status === 'mixed'
          ? `Mixed: ${completed} of ${required} matching ${mode} closes. No confirmed direction.`
          : `${completed} of ${required} matching ${mode} closes.`
  const windowText = lastWindow
    ? `Last ${mode} window ${utcTime(lastWindow.start)}–${utcTime(lastWindow.end)}: price ${signedPct(lastWindow.pricePct)}, OI ${signedPct(lastWindow.oiPct)}, volume ${lastWindow.volumeChangePct === null ? 'baseline unavailable (strong labels wait for a prior full window)' : signedPct(lastWindow.volumeChangePct)}.`
    : `No ${mode} window has closed yet.`
  const detail = `Valid windows ${evaluatedWindows} · rejected ${rejectedWindows}. ${windowText} Next close ${utcTime(nextCloseAt)}.`
  return { status: STATUS_LABEL[status], progress, detail, reason }
}
