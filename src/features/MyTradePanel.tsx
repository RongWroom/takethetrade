import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { CheckStatus, TradeCheckResult, TradeSide } from '../domain/tradeCheck'
import { emptyDraft, type DraftIntent } from './useTradeCheck'

const STATUS_META: Record<CheckStatus, { icon: string; label: string }> = {
  good: { icon: '✓', label: 'In your favour' },
  against: { icon: '✕', label: 'Against you' },
  caution: { icon: '!', label: 'Watch' },
  neutral: { icon: '–', label: 'Nothing notable' },
  unknown: { icon: '…', label: 'Waiting' },
}

type Props = {
  open: boolean
  onClose: () => void
  draft: DraftIntent
  setDraft: Dispatch<SetStateAction<DraftIntent>>
  result: TradeCheckResult | null
  livePrice: number | null
  timeframeLabel: string
  confirmationLabel: string
}

export function MyTradePanel({ open, onClose, draft, setDraft, result, livePrice, timeframeLabel, confirmationLabel }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [showDetails, setShowDetails] = useState(() => Boolean(draft.entry || draft.stop || draft.leverage))

  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal()
    if (!open && ref.current?.open) ref.current.close()
  }, [open])

  const issueFor = (field: 'entry' | 'stop' | 'leverage') => result?.issues.find(i => i.field === field)?.message
  const update = (patch: Partial<DraftIntent>) => setDraft(prev => ({ ...prev, ...patch }))
  const toggleSide = (side: TradeSide) => update({ side: draft.side === side ? null : side })
  const resetTrade = () => {
    setDraft(emptyDraft)
    setShowDetails(false)
  }

  const field = (key: 'entry' | 'stop' | 'leverage', label: string, hint: string, placeholder: string) => {
    const issue = issueFor(key)
    const id = `my-trade-${key}`
    return (
      <div className={`mt-field ${issue ? 'has-issue' : ''}`}>
        <label htmlFor={id}>
          {label} <span className="mt-optional">optional</span>
        </label>
        <div className="mt-input-row">
          <input
            id={id}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder={placeholder}
            value={draft[key]}
            aria-invalid={Boolean(issue)}
            aria-describedby={`${id}-hint`}
            onChange={e => update({ [key]: e.target.value })}
          />
          {key === 'entry' && livePrice !== null && (
            <button type="button" className="mt-mini" onClick={() => update({ entry: livePrice.toFixed(1) })}>
              Use current
            </button>
          )}
          {draft[key] && (
            <button type="button" className="mt-mini" aria-label={`Clear ${label}`} onClick={() => update({ [key]: '' })}>
              ×
            </button>
          )}
        </div>
        <small id={`${id}-hint`} className={issue ? 'mt-issue' : ''}>
          {issue ?? hint}
        </small>
      </div>
    )
  }

  return (
    <dialog
      ref={ref}
      className="drawer"
      onClose={onClose}
      onClick={e => {
        if (e.target === ref.current) onClose()
      }}
      aria-labelledby="my-trade-title"
    >
      <div className="dialog-content">
        <div className="dialog-head">
          <div>
            <p className="eyebrow">TRADE CONTEXT · {timeframeLabel.toUpperCase()}</p>
            <h2 id="my-trade-title">My Trade</h2>
          </div>
          <button className="close" onClick={onClose} aria-label="Close My Trade">
            ×
          </button>
        </div>

        <p className="mt-readonly">
          <span aria-hidden="true">🔒</span> Read-only. This app cannot place trades. What you enter stays in this browser.
        </p>

        <div className="mt-actions">
          <button type="button" className="secondary" onClick={resetTrade}>
            Reset My Trade
          </button>
        </div>

        <div className="mt-side" role="group" aria-label="Trade direction">
          <button type="button" className={`mt-side-btn long ${draft.side === 'long' ? 'active' : ''}`} aria-pressed={draft.side === 'long'} onClick={() => toggleSide('long')}>
            ▲ Long
            <small>betting price goes up</small>
          </button>
          <button type="button" className={`mt-side-btn short ${draft.side === 'short' ? 'active' : ''}`} aria-pressed={draft.side === 'short'} onClick={() => toggleSide('short')}>
            ▼ Short
            <small>betting price goes down</small>
          </button>
        </div>

        {!draft.side ? (
          <div className="empty">
            <strong>Thinking about a trade?</strong>
            <p>Pick Long or Short to see what the market says about it right now.</p>
          </div>
        ) : (
          <>
            <button type="button" className="mt-details-toggle" aria-expanded={showDetails} aria-controls="my-trade-fields" onClick={() => setShowDetails(v => !v)}>
              {showDetails ? '− Hide' : '+ Add'} entry, stop &amp; leverage
            </button>
            {showDetails && (
              <div id="my-trade-fields" className="mt-fields">
                {field('entry', 'Entry price', 'Leave blank to check entering at the current price.', livePrice ? livePrice.toFixed(0) : '71250')}
                {field('stop', 'Stop', 'Where you would get out if wrong.', draft.side === 'long' ? 'below entry' : 'above entry')}
                {field('leverage', 'Leverage', 'e.g. 10 for 10x. Used to estimate your liquidation price.', '10')}
              </div>
            )}

            {result && (
              <>
                <div className="mt-summary" aria-live="polite">
                  <span className="mt-mode">{result.mode === 'position' ? 'Your open trade' : 'If you entered now'}</span>
                  <strong>{result.summary.headline}</strong>
                </div>
                <p className="mt-confirmation">
                  Regime: {confirmationLabel}. Trend and flow use completed confirmation windows; price/risk, liquidation and funding checks remain live.
                </p>
                <ul className="mt-checks">
                  {result.checks.map(c => {
                    const meta = STATUS_META[c.status]
                    return (
                      <li key={c.id}>
                        <details className={`mt-check ${c.status}`}>
                          <summary>
                            <span className="mt-icon" aria-hidden="true">
                              {meta.icon}
                            </span>
                            <span className="mt-check-text">
                              <span className="mt-check-title">
                                {c.title} · <span className="mt-status-word">{meta.label}</span>
                              </span>
                              <span className="mt-check-headline">{c.headline}</span>
                            </span>
                          </summary>
                          <p>{c.explanation}</p>
                          <p className="mt-evidence">{c.evidence}</p>
                        </details>
                      </li>
                    )
                  })}
                </ul>
                <p className="mt-footnote">
                  Context, not advice. Checks are rule-based reads of OKX public data and can be wrong or incomplete. Liquidation prices are approximate.
                </p>
              </>
            )}
          </>
        )}
      </div>
    </dialog>
  )
}
