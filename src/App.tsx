import { useEffect, useRef, useState } from 'react'
import { OI_CHEAT_SHEET_ROWS, type CvdMedianProfile } from './domain/tradeEngine'
import { useLiveMarketData } from './features/LiveOverview'
import type { Metric } from './fixtures/demo'

type Panel = Metric['id'] | 'pulse' | 'events' | 'settings' | null

function formatSignedBtcNum(n: number): string {
  if (Math.abs(n) < 1e-6) return '0.00 BTC'
  const sign = n < 0 ? '-' : '+'
  const abs = Math.abs(n)
  return `${sign}${abs.toFixed(2)} BTC`
}

function CvdMedianChart({ profile }: { profile: CvdMedianProfile }) {
  return (
    <div className="cvd-median-wrap">
      <div className="cvd-median-stats">
        <span className="above-stat">
          ▲ Above median: <strong>{profile.aboveVolumeBtc.toFixed(2)} BTC</strong> ({profile.aboveCount}m)
        </span>
        <span className="median-badge">Median {formatSignedBtcNum(profile.medianBtc)}</span>
        <span className="below-stat">
          ▼ Below median: <strong>{profile.belowVolumeBtc.toFixed(2)} BTC</strong> ({profile.belowCount}m)
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
  const [dismissedIds, setDismissedIds] = useState<string[]>([])
  const [flippedCards, setFlippedCards] = useState<Record<string, boolean>>({})
  const dialog = useRef<HTMLDialogElement>(null)
  const live = useLiveMarketData()

  const activeMetric = typeof panel === 'string' ? live.metrics.find(m => m.id === panel) ?? null : null
  const visibleEvents = live.events.filter(ev => !dismissedIds.includes(ev.id))

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
        </nav>
        <span className="demo-pill">
          <span /> {live.status}
        </span>
      </header>
      <main id="overview" className="container">
        <div className="intro">
          <div>
            <p className="eyebrow">YOUR MARKET OVERVIEW</p>
            <h1>Clarity in the flow.</h1>
            <p className="muted">Plain-English translations of what buyers and sellers are doing right now.</p>
          </div>
          <div className="market">
            <span>
              BTC-USDT-SWAP <span className="demo-label">OKX LIVE</span>
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
            Session {new Date(live.anchor).toISOString().slice(11, 16)} UTC · tap any box to flip it over
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
                    <small className="flip-hint">{isFlipped ? ' · Flipped ↺' : ' · Tap to flip ↻'}</small>
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
                        <span>Tap box to flip back ↺</span>
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
        <button className="pulse" onClick={() => setPanel('pulse')}>
          <span className="pulse-head">
            <span>
              <span className="pulse-icon">•</span> Market Pulse (Plain English)
            </span>
            <span className="observation">{live.pulse.observation}</span>
          </span>
          <strong>{live.pulse.headline}</strong>
          <span className="pulse-copy">{live.pulse.copy}</span>
          <span className="pulse-link">
            Explore the evidence <span>→</span>
          </span>
        </button>

        {!focus && (
          <section className="oi-matrix-section" aria-label="Open Interest Cheat Sheet Calculator">
            <div className="oi-matrix-header">
              <div>
                <p className="eyebrow">OPEN INTEREST CALCULATOR</p>
                <h2>Price, Volume &amp; Open Interest Matrix</h2>
              </div>
              <div className="oi-live-verdict">
                {live.oiRegime.activeRow ? (
                  <span className={`verdict-pill ${live.oiRegime.activeRow.sentiment.toLowerCase()}`}>
                    Live: {live.oiRegime.activeRow.marketTitle} · {live.oiRegime.activeRow.sentiment}
                  </span>
                ) : (
                  <span className="verdict-pill neutral">Waiting for price &amp; OI movement</span>
                )}
              </div>
            </div>

            <div className="oi-live-strip">
              <div className="oi-signal-pill">
                <small>Price</small>
                <strong className={live.oiRegime.priceDirection === 'rising' ? 'up' : live.oiRegime.priceDirection === 'declining' ? 'down' : ''}>
                  {live.oiRegime.priceDirection === 'rising' ? '↑ rising' : live.oiRegime.priceDirection === 'declining' ? '↓ declining' : '→ flat'}
                </strong>
              </div>
              <div className="oi-signal-pill">
                <small>Volume</small>
                <strong className={live.oiRegime.volumeDirection === 'increasing' ? 'up' : live.oiRegime.volumeDirection === 'decreasing' ? 'down' : ''}>
                  {live.oiRegime.volumeDirection === 'increasing' ? '↑ increasing' : live.oiRegime.volumeDirection === 'decreasing' ? '↓ decreasing' : '→ flat'}
                </strong>
              </div>
              <div className="oi-signal-pill">
                <small>Open interest</small>
                <strong className={live.oiRegime.oiDirection === 'increasing' ? 'up' : live.oiRegime.oiDirection === 'decreasing' ? 'down' : ''}>
                  {live.oiRegime.oiDirection === 'increasing' ? '↑ increasing' : live.oiRegime.oiDirection === 'decreasing' ? '↓ decreasing' : '→ flat'}
                </strong>
              </div>
              <div className="oi-signal-pill verdict-cell">
                <small>Market</small>
                <strong>
                  {live.oiRegime.activeRow
                    ? `${live.oiRegime.activeRow.marketTitle} - ${live.oiRegime.activeRow.sentiment}`
                    : 'Calculating baseline...'}
                </strong>
              </div>
            </div>

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
                        {isActive && <span className="live-match-badge">LIVE NOW</span>}
                      </span>
                    </div>
                    <p className="oi-row-desc">{row.plainEnglish}</p>
                    <p className="oi-row-sub">{row.explanation}</p>
                  </div>
                )
              })}
            </div>

            <div className="oi-continuation-note">
              <span className="note-icon">ⓘ</span>
              <p>{live.oiRegime.continuationNote}</p>
            </div>
          </section>
        )}

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
              <p className="eyebrow">OKX · BTC-USDT-SWAP</p>
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
              <div className="detail-box">
                <strong>Source &amp; session coverage</strong>
                <p>
                  Exchange: OKX public WebSocket (`BTC-USDT-SWAP`) · Session anchor: {new Date(live.anchor).toISOString()} · Status: {live.status}
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
                  Deterministic rule evaluation from live OKX session inputs. Interpretive context only; no probabilities or trading advice are generated.
                </p>
              </div>
            </>
          )}
          {panel === 'events' &&
            (visibleEvents.length === 0 ? (
              <div className="empty">
                <strong>All quiet here</strong>
                <p>No exceptional liquidation clusters or delta spikes recorded in this session.</p>
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
              <div className="detail-box">
                <strong>Data health &amp; connection</strong>
                <p>Status: {live.status} · Feed: OKX BTC-USDT-SWAP public WebSocket</p>
                <p>
                  Session anchor: {new Date(live.anchor).toISOString()}
                  {live.updated ? ` · Last trade: ${new Date(live.updated).toISOString()}` : ' · Waiting for first trade'}
                </p>
              </div>
            </>
          )}
        </div>
      </dialog>
    </div>
  )
}

export default App

