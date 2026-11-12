import { SIGNAL_RULES, type ConfirmationView } from '../domain/signalConfirmation'
import { OI_CHEAT_SHEET_ROWS } from '../domain/tradeEngine'

const STATUS_LABEL: Record<ConfirmationView['status'], string> = {
  warming: 'Warming up',
  pending: 'Pending',
  confirmed: 'Confirmed',
  mixed: 'Mixed',
  insufficient: 'Insufficient data',
}

export function describeConfirmation(view: ConfirmationView): { status: string; progress: string } {
  const { mode, status, completed, candidate, lastClosedAt } = view
  const title = candidate ? OI_CHEAT_SHEET_ROWS.find(r => r.id === candidate)?.marketTitle ?? candidate : null
  const closed = lastClosedAt !== null ? ` · last ${mode} close ${new Date(lastClosedAt).toISOString().slice(11, 16)} UTC` : ''
  const required = SIGNAL_RULES.confirmations
  const progress =
    status === 'warming'
      ? lastClosedAt === null
        ? `Waiting for the first complete ${mode} window with live trades and open interest. 0 of ${required} matching closes.`
        : `Volume baseline ready. Waiting for two qualifying ${mode} closes.`
      : status === 'insufficient'
        ? `Live feed or open-interest data was interrupted. Fresh complete ${mode} windows are needed before any regime is confirmed.`
        : status === 'mixed'
          ? `Recent ${mode} closes disagree, so no regime is confirmed. ${completed} of ${required} matching closes.`
          : status === 'pending'
            ? `Candidate ${title ?? 'none'}: ${completed} of ${required} matching ${mode} closes${closed}.`
            : `${title ?? 'Regime'}: ${completed} of ${required} matching ${mode} closes${closed}.`
  return { status: STATUS_LABEL[status], progress }
}
