import { type ConfirmationView } from '../domain/signalConfirmation'
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
  const { mode, status, candidate, confirmed, lastWindow, evaluatedWindows, rejectedWindows, nextCloseAt, reason } = view
  const title = candidate ? OI_CHEAT_SHEET_ROWS.find(r => r.id === candidate)?.marketTitle ?? candidate : null
  const confirmedTitle = confirmed?.activeRow?.marketTitle ?? null
  const progress =
    status === 'confirmed'
      ? `${title ?? confirmedTitle ?? 'Regime'}: confirmed on the latest ${mode} close.`
      : status === 'pending'
        ? confirmedTitle
          ? `Holding ${confirmedTitle} (confirmed) · latest ${mode} close was neutral.`
          : `No confirmed regime on the latest ${mode} close.`
        : status === 'mixed'
          ? `Mixed: no confirmed direction on the latest ${mode} close.`
          : `Waiting for the first completed ${mode} close.`
  const windowText = lastWindow
    ? `Last ${mode} window ${utcTime(lastWindow.start)}–${utcTime(lastWindow.end)}: price ${signedPct(lastWindow.pricePct)}, OI ${signedPct(lastWindow.oiPct)}, volume ${lastWindow.volumeChangePct === null ? 'baseline established on this window' : signedPct(lastWindow.volumeChangePct)}.`
    : `No ${mode} window has closed yet.`
  const detail = `Valid windows ${evaluatedWindows} · rejected ${rejectedWindows}. ${windowText} Next close ${utcTime(nextCloseAt)}.`
  return { status: STATUS_LABEL[status], progress, detail, reason }
}
