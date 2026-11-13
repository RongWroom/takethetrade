import { useEffect, useRef, useState } from 'react'
import { TIMEFRAME_OPTIONS, type TimeframeId } from './data/okx'
import { OI_CHEAT_SHEET_ROWS, type CvdMedianProfile } from './domain/tradeEngine'
import { useLiveMarketData } from './features/LiveOverview'
import { LIQUIDATION_LARGE_USD, SIGNAL_RULES } from './domain/signalConfirmation'
import { describeConfirmation } from './features/confirmationLabels'
import { MyTradePanel } from './features/MyTradePanel'
import { useConfirmationPreference } from './features/useConfirmationPreference'
import { useTradeCheck } from './features/useTradeCheck'
import type { Metric } from './fixtures/demo'

type Panel = Metric['id'] | 'pulse' | 'events' | 'settings' | null

function formatSignedBtcNum(n: number): string {
  if (Math.abs(n) < 1e-6) return '0.00 BTC'
  const sign = n < 0 ? '-' : '+'
  const abs = Math.abs(n)
  return `${sign}${abs.toFixed(2)} BTC`
}

function CvdMedianChart({ profile, bucketSuffix = 'm' }: { profile: CvdMedianProfile; bucketSuffix?: string }) {
  return (
    <div className="cvd-median-wrap">
      <div className="cvd-median-stats">
        <span className="above-stat">
          ▲ Above: <strong>{profile.aboveVolumeBtc.toFixed(2)} BTC</strong> ({profile.aboveCount}
          {bucketSuffix})
        </span>
        <span className="median-badge">Median {formatSignedBtcNum(profile.medianBtc)}</span>
        <span className="below-stat">
          ▼ Below: <strong>{profile.belowVolumeBtc.toFixed(2)} BTC</strong> ({profile.belowCount}
          {bucketSuffix})
        </span>
      </div>
      <div className="cvd-median-chart" aria-label="CVD median volume chart">
        <div className="cvd-median-line" />
        {profile.bars.map((bar, i) => (
          <div key={i} className="cvd-median-col">
            <div className="cvd-half-top">
              {bar.direction === 'above' && (
                <i
                  className="bar-above"
                  style={{ height: `${bar.heightPct}%`, opacity: 0.55 + i / 28 }}
                  title={`CVD: ${formatSignedBtcNum(bar.valueBtc)} (${formatSignedBtcNum(bar.deviationBtc)} vs median) · Vol: ${bar.volumeBtc.toFixed(2)} BTC`}
                />
              )}
            </div>
            <div className="cvd-half-bottom">
              {bar.direction === 'below' && (
                <i
                  className="bar-below"
                  style={{ height: `${bar.heightPct}%`, opacity: 0.55 + i / 28 }}
                  title={`CVD: ${formatSignedBtcNum(bar.valueBtc)} (${formatSignedBtcNum(bar.deviationBtc)} vs median) · Vol: ${bar.volumeBtc.toFixed(2)} BTC`}
                />
              )}
              {bar.direction === 'on' && <i className="bar-on" />}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function App() {
  const [panel, setPanel] = useState<Panel>(null)
  const [focus, setFocus] = useState(false)
  const [timeframe, setTimeframe] = useState<TimeframeId>('1m')
  const [showFullMatrix, setShowFullMatrix] = useState(false)
  const [dismissedIds, setDismissedIds] = useState<string[]>([])
  const [flippedCards, setFlippedCards] = useState<Record<string, boolean>>({})
  const dialog = useRef<HTMLDialogElement>(null)
  const { mode: confirmationMode, setMode: setConfirmationMode } = useConfirmationPreference()
  const live = useLiveMarketData(timeframe, confirmationMode)
  const [tradeOpen, setTradeOpen] = useState(false)
  const trade = useTradeCheck(live.snapshot)

  const activeMetric = typeof panel === 'string' ? live.metrics.find(m => m.id === panel) ?? null : null
  const visibleEvents = live.events.filter(ev => !dismissedIds.includes(ev.id))
  const visibleEventIds = visibleEvents.map(ev => ev.id)
  const clearMarketEvents = () => setDismissedIds(prev => Array.from(new Set([...prev, ...visibleEventIds])))
  const confirmationInfo = describeConfirmation(live.confirmation)
  const observed = live.confirmation.observed
  const regimeBadge = live.confirmation.status === 'confirmed' ? 'CONFIRMED' : 'LAST CONFIRMED'

  const toggleFlip = (id: string) => {
    setFlippedCards(prev => ({ ...prev, [id]: !prev[id] }))
  }

  useEffect(() => {
    if (panel && !dialog.current?.open) dialog.current?.showModal()
    if (!panel && dialog.current?.open) dialog.current.close()
  }, [panel])

  const title = activeMetric
    ? activeMetric.label
    : panel === 'pulse'
      ? 'Market Pulse'
      : panel === 'events'
        ? 'Market Events'
        : 'Settings'

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#overview">
          <span className="brand-mark">→</span>
          <span>
            TAKE THE TRADE
            <small>MARKET OBSERVATORY</small>
          </span>
        </a>
        <nav aria-label="Main navigation">
          <a className="active" href="#overview">
            Overview
          </a>
          <button onClick={() => setPanel('events')}>
            Events <span className="nav-count">{visibleEvents.length}</span>
          </button>
          <button onClick={() => setPanel('settings')}>Settings</button>
          <button className="nav-trade" onClick={() => setTradeOpen(true)} aria-haspopup="dialog">
            My Trade
            {trade.draft.side && (
              <span className={`nav-trade-side ${trade.draft.side}`}>{trade.draft.side === 'long' ? '▲ Long' : '▼ Short'}</span>
            )}
          </button>
        </nav>
        <div className="topbar-right">
          <div className="timeframe-picker" role="group" aria-label="Select timeframe">
            {TIMEFRAME_OPTIONS.map(tf => (
              <button
                key={tf.id}
                type="button"
                className={`tf-btn ${timeframe === tf.id ? 'active' : ''}`}
                aria-pressed={timeframe === tf.id}
                onClick={() => setTimeframe(tf.id)}
              >
                {tf.shortLabel}
              </button>
            ))}
          </div>
          <span className="demo-pill">
            <span /> {live.status}
          </span>
        </div>
      </header>
      <main id="overview" className="container">
        <div className="intro">
          <div>
            <p className="eyebrow">YOUR MARKET OVERVIEW · {timeframe.toUpperCase()} WINDOW</p>
            <h1>Clarity in the flow.</h1>
            <p className="muted">Plain-English order flow for buyers and sellers.</p>
          </div>
          <div className="market">
            <span>
              BTC-USDT-SWAP <span className="demo-label">OKX LIVE · {timeframe.toUpperCase()}</span>
            </span>
            <strong>{live.price ?? '—'}</strong>
            <small>
              {live.updated
                ? `Updated ${new Date(live.updated).toISOString().slice(11, 19)} UTC · ${live.status}`
                : `${live.status} · waiting for trades`}
            </small>
          </div>
        </div>
        <div className="section-heading">
          <div>
            <p className="eyebrow">THE BIG PICTURE</p>
            <h2>Order flow at a glance</h2>
          </div>
          <span className="muted section-note">
            {live.timeframeLabel} window · Anchor {new Date(live.anchor).toISOString().slice(11, 16)} UTC · tap any box to flip
          </span>
        </div>
        <div className="grid">
          {live.metrics.map(m => {
            const isFlipped = Boolean(flippedCards[m.id])
            return (
              <div
                key={m.id}
                role="button"
                tabIndex={0}
                aria-label={`Flip ${m.label} card`}
                className={`metric ${m.color} ${isFlipped ? 'is-flipped' : ''}`}
                onClick={() => toggleFlip(m.id)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    toggleFlip(m.id)
                  }
                }}
              >
                <span className="card-head">
                  <span>
                    {m.label}
                    <small className="flip-hint">{isFlipped ? ' · Flipped ↺' : ' · Flip ↻'}</small>
                  </span>
                  <button
                    type="button"
                    className="icon-detail-btn"
                    aria-label={`Open ${m.label} details`}
                    onClick={e => {
                      e.stopPropagation()
                      setPanel(m.id)
                    }}
                  >
                    →
                  </button>
                </span>
                {!isFlipped ? (
                  <>
                    <strong>{m.value}</strong>
                    {!focus && (
                      <>
                        <span className="chart" aria-hidden="true">
                          {m.bars.map((h, i) => (
                            <i key={i} style={{ height: `${h}%`, opacity: 0.5 + i / 24 }} />
                          ))}
                        </span>
                        <span className="card-foot">
                          <span>{m.description}</span>
                          <span
                            className="detail-trigger"
                            onClick={e => {
                              e.stopPropagation()
                              setPanel(m.id)
                            }}
                          >
                            View details →
                          </span>
                        </span>
                      </>
                    )}
                  </>
                ) : (
                  <div className="card-back">
                    {m.id === 'cvd' && m.cvdMedian ? (
                      <>
                        <div className="card-back-top">
                          <strong>{m.value}</strong>
                          <span className="exo-tag">ExoCharts Median View</span>
                        </div>
                        <CvdMedianChart profile={m.cvdMedian} />
                        <p className="plain-explain">{m.cvdMedian.summary}</p>
                      </>
                    ) : (
                      <>
                        <div className="card-back-top">
                          <strong>{m.value}</strong>
                          <span className="exo-tag">Plain English</span>
                        </div>
                        <p className="plain-explain">{m.plainSummary ?? m.detail}</p>
                        {m.id === 'oi' && live.oiRegime.activeRow && (
                          <div className={`regime-mini-pill ${live.oiRegime.activeRow.sentiment.toLowerCase()}`}>
                            {live.oiRegime.activeRow.marketTitle} — {live.oiRegime.activeRow.sentiment}
                          </div>
                        )}
                      </>
                    )}
                    {!focus && (
                      <span className="card-foot">
                        <span>Tap to flip back ↺</span>
                        <span
                          className="detail-trigger"
                          onClick={e => {
                            e.stopPropagation()
                            setPanel(m.id)
                          }}
                        >
                          View details →
                        </span>
                      </span>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className={`synthesis-grid ${focus ? 'is-focus' : ''}`}>
          <button className="pulse" onClick={() => setPanel('pulse')}>
            <span className="pulse-head">
              <span>
                <span className="pulse-icon">•</span> Market Pulse ({confirmationMode} confirmation)
              </span>
              <span className="observation">{live.pulse.observation}</span>
            </span>
            <strong>{live.pulse.headline}</strong>
            <span className="pulse-copy">{live.pulse.copy}</span>
            <span className="oi-mini-note">{confirmationInfo.status} · {confirmationInfo.progress}</span>
            <span className="oi-mini-note">{confirmationInfo.detail}</span>
            <span className="oi-mini-note">{confirmationInfo.reason}</span>
            <span className="pulse-link">
              Explore the evidence <span>→</span>
            </span>
          </button>

          {!focus && (
            <section className="oi-matrix-section" aria-label="Open Interest Cheat Sheet Calculator">
              <div className="oi-matrix-header">
                <div>
                  <p className="eyebrow">OPEN INTEREST CALCULATOR · {confirmationMode.toUpperCase()} CONFIRMATION</p>
                  <h2>Price, Volume &amp; Open Interest Matrix</h2>
                </div>
                <div className="oi-live-verdict">
                  {live.oiRegime.activeRow ? (
                    <span className={`verdict-pill ${live.oiRegime.activeRow.sentiment.toLowerCase()}`}>
                      {live.oiRegime.activeRow.marketTitle} · {live.oiRegime.activeRow.sentiment}
                    </span>
                  ) : (
                    <span className="verdict-pill neutral">{confirmationInfo.status}</span>
                  )}
                </div>
              </div>
              <p className="oi-mini-note">{confirmationInfo.progress}</p>
              <p className="oi-mini-note">{confirmationInfo.detail}</p>
              <p className="oi-mini-note">{confirmationInfo.reason}</p>
              <p className="oi-mini-note">
                {observed === null ? 'No closed window yet' : live.confirmation.status === 'insufficient' ? 'Last observed window (feed interrupted, not live)' : 'Latest closed window'}
              </p>

              <div className="oi-live-strip">
                <div className="oi-signal-pill">
                  <small>Price</small>
                  <strong className={observed?.priceDirection === 'rising' ? 'up' : observed?.priceDirection === 'declining' ? 'down' : ''}>
                    {observed === null ? 'Awaiting a closed window' : observed.priceDirection === 'rising' ? '↑ rising' : observed.priceDirection === 'declining' ? '↓ declining' : '→ flat'}
                  </strong>
                </div>
                <div className="oi-signal-pill">
                  <small>Volume</small>
                  <strong className={observed?.volumeDirection === 'increasing' ? 'up' : observed?.volumeDirection === 'decreasing' ? 'down' : ''}>
                    {observed === null ? 'Awaiting a closed window' : observed.volumeDirection === 'increasing' ? '↑ increasing' : observed.volumeDirection === 'decreasing' ? '↓ decreasing' : '→ flat'}
                  </strong>
                </div>
                <div className="oi-signal-pill">
                  <small>Open interest</small>
                  <strong className={observed?.oiDirection === 'increasing' ? 'up' : observed?.oiDirection === 'decreasing' ? 'down' : ''}>
                    {observed === null ? 'Awaiting a closed window' : observed.oiDirection === 'increasing' ? '↑ increasing' : observed.oiDirection === 'decreasing' ? '↓ decreasing' : '→ flat'}
                  </strong>
                </div>
                <div className="oi-signal-pill verdict-cell">
                  <small>Market</small>
                  <strong>
                    {live.oiRegime.activeRow
                      ? `${live.oiRegime.activeRow.marketTitle} - ${live.oiRegime.activeRow.sentiment}`
                      : 'Baseline...'}
                  </strong>
                </div>
              </div>

              {live.oiRegime.activeRow && !showFullMatrix && (
                <div className="oi-active-summary">
                  <span className="live-match-badge">{regimeBadge}</span>
                  <p>{live.oiRegime.activeRow.plainEnglish}</p>
                </div>
              )}

              <div className="oi-matrix-toggle-bar">
                <span className="oi-mini-note">{live.oiRegime.continuationNote}</span>
                <button
                  type="button"
                  className="matrix-toggle-btn"
                  aria-expanded={showFullMatrix}
                  onClick={() => setShowFullMatrix(prev => !prev)}
                >
                  {showFullMatrix ? 'Hide reference table ↑' : 'Cheat sheet (4 regimes) ↓'}
                </button>
              </div>

              {showFullMatrix && (
                <div className="oi-cheat-table">
                  <div className="oi-table-cols" aria-hidden="true">
                    <span>Price</span>
                    <span>Volume</span>
                    <span>Open interest</span>
                    <span>Market</span>
                  </div>
                  {OI_CHEAT_SHEET_ROWS.map(row => {
                    const isActive = live.oiRegime.activeRowId === row.id
                    return (
                      <div key={row.id} className={`oi-cheat-row ${isActive ? 'active' : ''}`}>
                        <div className="oi-row-signals">
                          <span className={`sig ${row.priceLabel === 'rising' ? 'up' : 'down'}`}>
                            <i>{row.priceLabel === 'rising' ? '↑' : '↓'}</i> {row.priceLabel}
                          </span>
                          <span className={`sig ${row.volumeLabel === 'increasing' ? 'up' : 'down'}`}>
                            <i>{row.volumeLabel === 'increasing' ? '↑' : '↓'}</i> {row.volumeLabel}
                          </span>
                          <span className={`sig ${row.oiLabel === 'increasing' ? 'up' : 'down'}`}>
                            <i>{row.oiLabel === 'increasing' ? '↑' : '↓'}</i> {row.oiLabel}
                          </span>
                          <span className="sig-market">
                            <strong>{row.marketTitle}</strong> -{' '}
                            <em className={row.sentiment.toLowerCase()}>{row.sentiment}</em>
                            {isActive && <span className="live-match-badge">{regimeBadge}</span>}
                          </span>
                        </div>
                        <p className="oi-row-desc">{row.plainEnglish}</p>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          )}
        </div>

        {!focus && (
          <div className="bottom-row">
            <div className="note">
              <span className="note-icon">ⓘ</span>
              <div>
                <strong>Context, not a signal</strong>
                <p>
                  {live.gap
                    ? 'Incomplete coverage: session starts when the page opens with no backfill. Network interruptions or sleep can cause gaps.'
                    : 'Live OKX public feed since session anchor. Order-flow metrics provide market context, not trading recommendations.'}
                </p>
              </div>
            </div>
            <button className="event-preview" onClick={() => setPanel('events')}>
              <span className="event-icon">ϟ</span>
              <span>
                <strong>Market events</strong>
                <small>
                  {visibleEvents.length === 0
                    ? 'No events in your inbox'
                    : `${visibleEvents.length} ${visibleEvents.length === 1 ? 'event' : 'events'} in your inbox`}
                </small>
              </span>
              <span className="arrow">→</span>
            </button>
          </div>
        )}
        <footer>
          <span>TAKE THE TRADE · OKX LIVE STREAM</span>
          <span>Built for a clearer perspective.</span>
        </footer>
      </main>
      <dialog
        ref={dialog}
        onClose={() => setPanel(null)}
        onClick={e => {
          if (e.target === dialog.current) setPanel(null)
        }}
        aria-labelledby="dialog-title"
      >
        <div className="dialog-content">
          <div className="dialog-head">
            <div>
              <p className="eyebrow">OKX · BTC-USDT-SWAP · {timeframe.toUpperCase()}</p>
              <h2 id="dialog-title">{title}</h2>
            </div>
            <button className="close" onClick={() => setPanel(null)} aria-label="Close dialog">
              ×
            </button>
          </div>
          {activeMetric && (
            <>
              <p className={`detail-value ${activeMetric.color}`}>{activeMetric.value}</p>
              {activeMetric.id === 'cvd' && activeMetric.cvdMedian && (
                <div className="detail-box">
                  <strong>CVD Median Profile (ExoCharts view)</strong>
                  <CvdMedianChart profile={activeMetric.cvdMedian} />
                </div>
              )}
              <p>{activeMetric.detail}</p>
              {activeMetric.id === 'liquidations' && (
                <button type="button" className="secondary" onClick={() => setPanel('events')}>
                  View Market Events
                </button>
              )}
              <div className="detail-box">
                <strong>Source &amp; session coverage</strong>
                <p>
                  Exchange: OKX public WebSocket (`BTC-USDT-SWAP`) · Timeframe: {live.timeframeLabel} · Session anchor: {new Date(live.anchor).toISOString()} · Status: {live.status}
                </p>
                <p>
                  {live.gap
                    ? 'Incomplete coverage: session began when the page opened with no historical backfill, and disconnects or background tab throttling can introduce gaps.'
                    : 'Continuous coverage since session anchor.'}
                </p>
              </div>
            </>
          )}
          {panel === 'pulse' && (
            <>
              <p className="detail-value">{live.pulse.headline}</p>
              <p>{live.pulse.copy}</p>
              <div className="detail-box">
                <strong>Observed evidence ({live.pulse.ruleId})</strong>
                <p>{live.pulse.evidence}</p>
                <p>
                  Deterministic rule evaluation over closed {confirmationMode} confirmation windows of live OKX data ({confirmationInfo.status}). Interpretive context only; no probabilities or trading advice are generated.
                </p>
              </div>
            </>
          )}
          {panel === 'events' && (
            <div className="event-toolbar">
              <div>
                <strong>Event history</strong>
                <span className="muted"> · {visibleEvents.length} {visibleEvents.length === 1 ? 'event' : 'events'}</span>
              </div>
              {visibleEvents.length > 0 && (
                <button type="button" className="secondary" onClick={clearMarketEvents}>
                  Clear Market Events
                </button>
              )}
            </div>
          )}
          {panel === 'events' && visibleEvents.length > 0 && (
            <p className="event-helper">Clears this event list only. Live totals and calculations are unchanged; new events will still appear.</p>
          )}
          {panel === 'events' &&
            (visibleEvents.length === 0 ? (
              <div className="empty">
                <strong>All quiet here</strong>
                <p>No events to show. New market events will appear here.</p>
              </div>
            ) : (
              visibleEvents.map(ev => (
                <div key={ev.id} className="detail-box">
                  <span className="event-tag">{ev.tag}</span>
                  <h3>{ev.title}</h3>
                  <p className={`detail-value ${ev.color}`}>{ev.value}</p>
                  <p>{ev.description}</p>
                  <button
                    className="secondary"
                    onClick={() => setDismissedIds(prev => [...prev, ev.id])}
                  >
                    Dismiss event
                  </button>
                </div>
              ))
            ))}
          {panel === 'settings' && (
            <>
              <p>Adjust the view for a quieter overview.</p>
              <label className="setting">
                <span>
                  <strong>Focus mode</strong>
                  <small>Hide charts and secondary context on the overview.</small>
                </span>
                <input type="checkbox" checked={focus} onChange={e => setFocus(e.target.checked)} />
              </label>
              <div className="detail-box" role="radiogroup" aria-label="Signal confirmation">
                <strong>Signal confirmation</strong>
                <p>
                  Pulse and the regime matrix use closed windows of this length, independent of the chart timeframe. Confirmation needs two matching closes.
                </p>
                <label className="setting">
                  <span>
                    <strong>Balanced</strong>
                    <small>2 × 5m closes</small>
                  </span>
                  <input type="radio" name="confirmation-mode" value="5m" checked={confirmationMode === '5m'} onChange={() => setConfirmationMode('5m')} />
                </label>
                <label className="setting">
                  <span>
                    <strong>Slow</strong>
                    <small>2 × 15m closes</small>
                  </span>
                  <input type="radio" name="confirmation-mode" value="15m" checked={confirmationMode === '15m'} onChange={() => setConfirmationMode('15m')} />
                </label>
                <p>
                  Changing this restarts confirmation. Two matching valid closes are needed; a strong label also needs a prior valid window for volume. Windows are fixed UTC blocks: for 5m, 12:05–12:10 and 12:10–12:15 UTC are two closed windows. The block in progress is never evaluated and no live candle is used.
                </p>
                <p>
                  Uncalibrated defaults: price must move at least the larger of {SIGNAL_RULES.minimumPricePct}% or {SIGNAL_RULES.priorRangeFraction * 100}% of the previous window&apos;s range; open interest must change at least {SIGNAL_RULES.minimumOiPct}%; a strong label also needs volume up at least {SIGNAL_RULES.minimumVolumeChangePct}%.
                </p>
                <p>
                  Open interest is checked every {SIGNAL_RULES.oiRefreshMs / 1000} seconds over public REST and on each WebSocket update. Unchanged open interest is normal. Values older than {SIGNAL_RULES.maximumOiAgeMs / 1000} seconds are not used. Actual feed gaps restart confirmation; switching tabs alone does not.
                </p>
                <p>
                  Large reported liquidation alerts start at ${LIQUIDATION_LARGE_USD.toLocaleString('en-US')}, a starting default rather than a calibrated market-wide threshold. Liquidation alerts never change the confirmed regime.
                </p>
                <p>Status: {confirmationInfo.status} · {confirmationInfo.progress}</p>
              </div>
              <div className="detail-box">
                <strong>Data health &amp; connection</strong>
                <p>Status: {live.status} · Timeframe: {live.timeframeLabel} · Confirmation: {confirmationMode} · Feed: OKX BTC-USDT-SWAP</p>
                <p>
                  Session anchor: {new Date(live.anchor).toISOString()}
                  {live.updated ? ` · Last trade: ${new Date(live.updated).toISOString()}` : ' · Waiting for first trade'}
                </p>
              </div>
            </>
          )}
        </div>
      </dialog>
      <MyTradePanel
        open={tradeOpen}
        onClose={() => setTradeOpen(false)}
        draft={trade.draft}
        setDraft={trade.setDraft}
        result={trade.result}
        livePrice={live.snapshot.price}
        timeframeLabel={live.timeframeLabel}
        confirmationLabel={`${confirmationInfo.status}, ${confirmationMode} confirmation. ${confirmationInfo.progress}`}
      />
    </div>
  )
}

export default App

