import { useEffect, useRef, useState } from 'react'
import { useLiveMarketData } from './features/LiveOverview'
import type { Metric } from './fixtures/demo'

type Panel = Metric['id'] | 'pulse' | 'events' | 'settings' | null

function App() {
  const [panel, setPanel] = useState<Panel>(null)
  const [focus, setFocus] = useState(false)
  const [dismissedIds, setDismissedIds] = useState<string[]>([])
  const dialog = useRef<HTMLDialogElement>(null)
  const live = useLiveMarketData()

  const activeMetric = typeof panel === 'string' ? live.metrics.find(m => m.id === panel) ?? null : null
  const visibleEvents = live.events.filter(ev => !dismissedIds.includes(ev.id))

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
            <p className="muted">A quieter view of the forces moving Bitcoin.</p>
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
            Session {new Date(live.anchor).toISOString().slice(11, 16)} UTC · tap a card for details
          </span>
        </div>
        <div className="grid">
          {live.metrics.map(m => (
            <button
              key={m.id}
              className={`metric ${m.color}`}
              onClick={() => setPanel(m.id)}
              aria-label={`Open ${m.label} details`}
            >
              <span className="card-head">
                {m.label}
                <span aria-hidden="true">→</span>
              </span>
              <strong>{m.value}</strong>
              {!focus && (
                <>
                  <span className="chart" aria-hidden="true">
                    {m.bars.map((h, i) => (
                      <i key={i} style={{ height: `${h}%`, opacity: 0.5 + i / 24 }} />
                    ))}
                  </span>
                  <span className="card-foot">
                    {m.description}
                    <span>View details →</span>
                  </span>
                </>
              )}
            </button>
          ))}
        </div>
        <button className="pulse" onClick={() => setPanel('pulse')}>
          <span className="pulse-head">
            <span>
              <span className="pulse-icon">•</span> Market Pulse
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
              <p>{activeMetric.detail}</p>
              <div className="detail-box">
                <strong>Source & session coverage</strong>
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
                <strong>Data health & connection</strong>
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

