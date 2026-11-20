import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { CheckStatus, TradeCheckResult, TradeSide } from '../domain/tradeCheck'
import {
  computeJournalPnl,
  createJournalEntry,
  serializeJournalCsv,
  serializeJournalJson,
  serializeJournalTsv,
  type JournalEntry,
  type PageDataSnapshot,
  type TradeOutcome,
} from '../domain/tradeJournal'
import { emptyDraft, type DraftIntent } from './useTradeCheck'
import type { UseTradeJournalReturn } from './useTradeJournal'

const STATUS_META: Record<CheckStatus, { icon: string; label: string }> = {
  good: { icon: '✓', label: 'In your favour' },
  against: { icon: '✕', label: 'Against you' },
  caution: { icon: '!', label: 'Watch' },
  neutral: { icon: '–', label: 'Nothing notable' },
  unknown: { icon: '…', label: 'Waiting' },
}

const OUTCOME_OPTIONS: ReadonlyArray<{ id: TradeOutcome; label: string }> = [
  { id: 'open', label: 'Open' },
  { id: 'win', label: 'Win' },
  { id: 'loss', label: 'Loss' },
  { id: 'breakeven', label: 'BE' },
]

function triggerDownload(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function formatUtcStamp(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`
}

type Props = {
  open: boolean
  mode: 'plan' | 'journal'
  onOpenJournal: () => void
  onClose: () => void
  draft: DraftIntent
  setDraft: Dispatch<SetStateAction<DraftIntent>>
  result: TradeCheckResult | null
  livePrice: number | null
  timeframeLabel: string
  confirmationLabel: string
  captureSnapshot: () => PageDataSnapshot
  journal: UseTradeJournalReturn
}

export function MyTradePanel({
  open,
  mode,
  onOpenJournal,
  onClose,
  draft,
  setDraft,
  result,
  livePrice,
  timeframeLabel,
  confirmationLabel,
  captureSnapshot,
  journal,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [showDetails, setShowDetails] = useState(() => Boolean(draft.entry || draft.stop || draft.leverage))
  const [feedback, setFeedback] = useState<string | null>(null)
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flashFeedback = (msg: string) => {
    setFeedback(msg)
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
    feedbackTimer.current = setTimeout(() => setFeedback(null), 3000)
  }

  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal()
    if (!open && ref.current?.open) ref.current.close()
  }, [open])

  const getActiveOrCurrentEntries = (): JournalEntry[] => {
    if (journal.entries.length > 0) return journal.entries
    return [createJournalEntry(captureSnapshot(), { id: 'live-snapshot' })]
  }

  const handleLogSnapshot = (outcome: TradeOutcome = 'open') => {
    const raw = captureSnapshot()
    const lockedEntry =
      raw.myTrade.entryInput.trim() === '' && raw.market.price !== null
        ? String(raw.market.price)
        : raw.myTrade.entryInput
    const snap: PageDataSnapshot = {
      ...raw,
      myTrade: {
        ...raw.myTrade,
        entryInput: lockedEntry,
      },
    }
    const created = journal.logSnapshot(snap, { outcome })
    flashFeedback(`Logged snapshot at ${created.createdAtIso.slice(11, 19)} UTC`)
  }

  const handleCopySheets = async () => {
    const target = getActiveOrCurrentEntries()
    const tsv = serializeJournalTsv(target, true)
    try {
      await navigator.clipboard.writeText(tsv)
      flashFeedback(
        journal.entries.length > 0
          ? `Copied ${target.length} ${target.length === 1 ? 'row' : 'rows'} + headers for Google Sheets`
          : 'Copied current page snapshot + headers for Google Sheets',
      )
    } catch {
      flashFeedback('Clipboard unavailable — use Download CSV instead')
    }
  }

  const handleCopyJson = async () => {
    const target = getActiveOrCurrentEntries()
    const json = serializeJournalJson(target)
    try {
      await navigator.clipboard.writeText(json)
      flashFeedback(
        journal.entries.length > 0
          ? `Copied ${target.length} journal ${target.length === 1 ? 'entry' : 'entries'} as JSON for LLM`
          : 'Copied current page snapshot as JSON for LLM',
      )
    } catch {
      flashFeedback('Clipboard unavailable — use Download JSON instead')
    }
  }

  const handleDownloadCsv = () => {
    const target = getActiveOrCurrentEntries()
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    triggerDownload(`takethetrade-journal-${stamp}.csv`, serializeJournalCsv(target), 'text/csv;charset=utf-8')
    flashFeedback(`Downloaded CSV (${target.length} ${target.length === 1 ? 'row' : 'rows'})`)
  }

  const handleDownloadJson = () => {
    const target = getActiveOrCurrentEntries()
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    triggerDownload(`takethetrade-journal-${stamp}.json`, serializeJournalJson(target), 'application/json;charset=utf-8')
    flashFeedback(`Downloaded JSON (${target.length} ${target.length === 1 ? 'entry' : 'entries'})`)
  }

  const handleCopySingleRow = async (entry: JournalEntry) => {
    try {
      await navigator.clipboard.writeText(serializeJournalTsv([entry], false))
      flashFeedback('Copied row for Google Sheets (Cmd/Ctrl+V into sheet)')
    } catch {
      flashFeedback('Clipboard unavailable')
    }
  }

  const handleCopySingleJson = async (entry: JournalEntry) => {
    try {
      await navigator.clipboard.writeText(serializeJournalJson([entry]))
      flashFeedback('Copied entry JSON for LLM')
    } catch {
      flashFeedback('Clipboard unavailable')
    }
  }

  const [reviewClock, setReviewClock] = useState(() => Date.now())
  useEffect(() => {
    if (!open) return
    const timer = setInterval(() => setReviewClock(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [open])
  const recentEntries = journal.entries.filter(entry => entry.createdAtMs >= reviewClock - 7 * 24 * 60 * 60 * 1000)
  const reviewedCount = recentEntries.filter(entry => entry.processGrade).length

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
            {mode === 'plan' && <p className="eyebrow">TRADE CONTEXT · {timeframeLabel.toUpperCase()}</p>}
            <h2 id="my-trade-title">{mode === 'plan' ? 'My Trade' : 'Journal'}</h2>
          </div>
          <button className="close" onClick={onClose} aria-label={mode === 'plan' ? 'Close My Trade' : 'Close Journal'}>
            ×
          </button>
        </div>

        <p className="mt-readonly">
          <span aria-hidden="true">🔒</span> Read-only. This app cannot place trades. What you enter stays in this browser.
        </p>

        <div hidden={mode !== 'plan'}>
        <div className="mt-actions">
          <span className="mt-section-label">Trade direction</span>
          <button type="button" className="secondary mt-reset" onClick={resetTrade}>
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

          <div className="mt-export-bar">
            <button type="button" className="mt-log-btn" disabled={!draft.side}
              onClick={() => handleLogSnapshot()}>Log trade snapshot</button>
            <button type="button" className="mt-export-btn"
              onClick={() => handleLogSnapshot('no-trade')}>Log no trade</button>
            <button type="button" className="mt-export-btn" onClick={onOpenJournal}>Open journal</button>
          </div>
        </div>

        <section className="mt-journal" aria-label="Trade reviews" hidden={mode !== 'journal'}>
          <div className="mt-journal-head">
            <div>
              <span className="mt-section-label">Review your decisions</span>
              <p className="mt-journal-sub">Grade how you handled the decision. Record the outcome and one lesson separately.</p>
            </div>

          </div>

          <details>
            <summary>Export journal</summary>
            <div className="mt-export-bar" role="group" aria-label="Export or copy journal data">
            <button type="button" className="mt-export-btn" onClick={handleCopySheets}>
              Copy for Sheets
            </button>
            <button type="button" className="mt-export-btn" onClick={handleCopyJson}>
              Copy JSON for LLM
            </button>
            <button type="button" className="mt-export-btn" onClick={handleDownloadCsv}>
              Download CSV
            </button>
            <button type="button" className="mt-export-btn" onClick={handleDownloadJson}>
              Download JSON
            </button>
          </div>

          </details>

          {journal.entries.length === 0 ? (
            <p className="mt-journal-empty">
              No decisions logged. Open My Trade to save a trade snapshot or a decision to sit out.
            </p>
          ) : (
            <>
              <div className="mt-journal-stats">
                <span>
                  <strong>{reviewedCount} of {recentEntries.length}</strong> decisions reviewed in the last 7 days
                </span>
                <button type="button" className="mt-clear-journal" onClick={journal.clearJournal}>
                  Clear Journal
                </button>
              </div>

              <ul className="mt-journal-list">
                {journal.entries.map(entry => {
                  const s = entry.snapshot
                  const pnl = computeJournalPnl(entry)
                  const sideTag =
                    entry.outcome === 'no-trade' ? 'NO TRADE' : s.myTrade.side === 'long'
                      ? '▲ LONG'
                      : s.myTrade.side === 'short'
                        ? '▼ SHORT'
                        : 'SNAPSHOT'
                  const sideClass = s.myTrade.side ?? 'neutral'
                  const entryPxText =
                    pnl.entryPriceUsed !== null
                      ? `$${pnl.entryPriceUsed.toLocaleString('en-US', { maximumFractionDigits: 1 })}`
                      : '—'
                  return (
                    <li key={entry.id} className={`mt-journal-card outcome-${entry.outcome}`}>
                      <div className="mt-jc-top">
                        <div className="mt-jc-meta">
                          <span className={`mt-jc-side ${sideClass}`}>{sideTag}</span>
                          {entry.outcome !== 'no-trade' && <strong>{entryPxText}</strong>}
                          <small>
                            {s.timeframe} · {formatUtcStamp(entry.createdAtIso)}
                          </small>
                        </div>
                        <button
                          type="button"
                          className="mt-jc-delete"
                          aria-label="Remove journal entry"
                          onClick={() => journal.deleteEntry(entry.id)}
                        >
                          ×
                        </button>
                      </div>

                      <details>
                        <summary>Market at capture</summary>
                        <div className="mt-jc-chips">
                        <span className="mt-jc-chip">
                          {s.oiRegime.marketTitle ? `${s.oiRegime.marketTitle} (${s.oiRegime.sentiment})` : s.confirmationStatus}
                        </span>
                        {s.story.smartRsi && (
                          <span className="mt-jc-chip">
                            RSI {s.story.smartRsi.value.toFixed(1)} ({s.story.smartRsi.zone})
                          </span>
                        )}
                        <span className="mt-jc-chip">Structure: {s.story.structure.shortLabel}</span>
                        {s.myTrade.summary && (
                          <span className="mt-jc-chip">
                            Checks: {s.myTrade.summary.good}✓ {s.myTrade.summary.against}✕ {s.myTrade.summary.caution}!
                          </span>
                        )}
                      </div>

                      </details>
                      <label className="mt-jc-inputs">
                        <span>Process grade</span>
                        <select value={entry.processGrade ?? ''} onChange={event => {
                          const grade = event.target.value
                          journal.updateEntry(entry.id, { processGrade: grade === 'A' || grade === 'B' || grade === 'C' ? grade : undefined })
                        }}>
                          <option value="">Unreviewed</option>
                          <option value="A">A · Followed plan</option>
                          <option value="B">B · Minor deviation</option>
                          <option value="C">C · Broke a key rule</option>
                        </select>
                      </label>
                      <details>
                        <summary>How to grade</summary>
                        <p>A means you followed your setup, risk and exit rules. B means you made a minor deviation. C means you broke a key rule. For a decision to sit out, grade how well you followed your criteria for waiting.</p>
                      </details>

                      <div className="mt-jc-outcomes" role="group" aria-label="Trade outcome" hidden={entry.outcome === 'no-trade'}>
                        {OUTCOME_OPTIONS.map(opt => (
                          <button
                            key={opt.id}
                            type="button"
                            className={`mt-outcome-btn ${opt.id} ${entry.outcome === opt.id ? 'active' : ''}`}
                            aria-pressed={entry.outcome === opt.id}
                            onClick={() => journal.updateEntry(entry.id, { outcome: opt.id })}
                          >
                            {opt.label}
                          </button>
                        ))}
                        {pnl.priceMovePct !== null && (
                          <span className={`mt-jc-pnl ${pnl.priceMovePct >= 0 ? 'pos' : 'neg'}`}>
                            {pnl.priceMovePct >= 0 ? '+' : ''}
                            {pnl.priceMovePct.toFixed(2)}%
                            {pnl.leveragedPnlPct !== null && pnl.leverageNum
                              ? ` (${pnl.leveragedPnlPct >= 0 ? '+' : ''}${pnl.leveragedPnlPct.toFixed(1)}% @ ${pnl.leverageNum}x)`
                              : ''}
                          </span>
                        )}
                      </div>

                      <div className="mt-jc-inputs">
                        <div className="mt-jc-exit-row" hidden={entry.outcome === 'no-trade'}>
                          <input
                            type="text"
                            inputMode="decimal"
                            aria-label="Exit price"
                            placeholder="Exit price (e.g. 81200)"
                            value={entry.exitPrice}
                            onChange={e => journal.updateEntry(entry.id, { exitPrice: e.target.value })}
                          />
                          {livePrice !== null && (
                            <button
                              type="button"
                              className="mt-mini"
                              onClick={() => journal.updateEntry(entry.id, { exitPrice: livePrice.toFixed(1) })}
                            >
                              Now
                            </button>
                          )}
                        </div>
                        <input
                          type="text"
                          aria-label="Trade note"
                          placeholder="One lesson or reason for waiting"
                          value={entry.notes}
                          onChange={e => journal.updateEntry(entry.id, { notes: e.target.value })}
                        />
                      </div>

                      <div className="mt-jc-foot">
                        <button type="button" className="mt-jc-action" onClick={() => handleCopySingleRow(entry)}>
                          Copy Row (Sheets)
                        </button>
                        <button type="button" className="mt-jc-action" onClick={() => handleCopySingleJson(entry)}>
                          Copy Entry JSON
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </section>
        {feedback && <div className="mt-feedback" role="status">{feedback}</div>}
      </div>
    </dialog>
  )
}
