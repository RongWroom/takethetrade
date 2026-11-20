import { useEffect, useRef, useState } from 'react'
import { getTimeframeOption, TIMEFRAME_OPTIONS, type TimeframeId } from './data/okx'
import { OI_CHEAT_SHEET_ROWS, type CvdMedianProfile } from './domain/tradeEngine'
import { useLiveMarketData } from './features/LiveOverview'
import { LIQUIDATION_LARGE_USD, SIGNAL_RULES } from './domain/signalConfirmation'
import { describeConfirmation } from './features/confirmationLabels'
import { FolderShell, FootprintTab, type FolderTabDef, type FolderTone } from './features/FootprintTab'
import { ReferenceLevels } from './features/ReferenceLevels'
import { useReferenceLevels } from './features/useReferenceLevels'
import { MarketStory } from './features/MarketStory'
import { MyTradePanel } from './features/MyTradePanel'
import { useConfirmationPreference } from './features/useConfirmationPreference'
import { useTradeCheck } from './features/useTradeCheck'
import { useTradeJournal } from './features/useTradeJournal'
import { buildPageDataSnapshot } from './domain/tradeJournal'
import type { Metric } from './fixtures/demo'

type Panel = Metric['id'] | 'pulse' | 'events' | 'settings' | 'guide' | null

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

function toFolderTone(tone: string | undefined): FolderTone {
  if (tone === 'teal' || tone === 'rose' || tone === 'amber' || tone === 'blue') return tone
  return 'blue'
}

function App() {
  const [activeTab, setActiveTab] = useState<'overview' | 'footprint'>('overview')
  const [overviewFolder, setOverviewFolder] = useState<'story' | 'metrics' | 'pulse' | 'levels'>('story')
  const [panel, setPanel] = useState<Panel>(null)
  const [focus, setFocus] = useState(false)
  const [timeframe, setTimeframe] = useState<TimeframeId>('1m')
  const [showFullMatrix, setShowFullMatrix] = useState(false)
  const [dismissedIds, setDismissedIds] = useState<string[]>([])
  const dialog = useRef<HTMLDialogElement>(null)
  const { mode: confirmationMode, setMode: setConfirmationMode } = useConfirmationPreference()
  const live = useLiveMarketData(timeframe, confirmationMode)
  const referenceLevels = useReferenceLevels(live.svpHistory, live.snapshot.price, live.snapshot.vwap)
  const [tradePanel, setTradePanel] = useState<'plan' | 'journal' | null>(null)
  const trade = useTradeCheck(live.snapshot)
  const journal = useTradeJournal()

  const activeMetric = typeof panel === 'string' ? live.metrics.find(m => m.id === panel) ?? null : null
  const visibleEvents = live.events.filter(ev => !dismissedIds.includes(ev.id))
  const visibleEventIds = visibleEvents.map(ev => ev.id)
  const clearMarketEvents = () => setDismissedIds(prev => Array.from(new Set([...prev, ...visibleEventIds])))
  const confirmationInfo = describeConfirmation(live.confirmation)
  const observed = live.confirmation.observed
  const regimeBadge =
    live.confirmation.status === 'confirmed'
      ? 'CONFIRMED'
      : live.confirmation.confirmed
        ? 'LAST CONFIRMED'
        : 'NO CONFIRMED REGIME'

  const captureCurrentSnapshot = () =>
    buildPageDataSnapshot({
      status: live.status,
      priceFormatted: live.price,
      timeframe: live.timeframe,
      timeframeLabel: live.timeframeLabel,
      gap: live.gap,
      oiStale: live.oiStale,
      confirmationMode,
      confirmationStatus: confirmationInfo.status,
      confirmationProgress: confirmationInfo.progress,
      confirmationDetail: confirmationInfo.detail,
      confirmationReason: confirmationInfo.reason,
      metrics: live.metrics,
      pulse: live.pulse,
      oiRegime: live.oiRegime,
      story: live.story,
      snapshot: live.snapshot,
      confirmation: live.confirmation,
      events: visibleEvents,
      draft: trade.draft,
      tradeResult: trade.result,
    })

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
        : panel === 'guide'
          ? 'How it works'
          : 'Settings'

  const overviewTabs: readonly FolderTabDef<'story' | 'metrics' | 'pulse' | 'levels'>[] = [
    {
      id: 'story',
      tabId: 'ov-tab-story',
      panelId: 'ov-panel-story',
      label: 'Story Timeline',
      badge: live.story.buckets[live.story.buckets.length - 1]?.phaseLabel ?? 'Waiting',
      tone: toFolderTone(live.story.tone),
    },
    {
      id: 'levels',
      tabId: 'ov-tab-levels',
      panelId: 'ov-panel-levels',
      label: 'Levels',
      badge: '',
      tone: 'blue',
    },
    {
      id: 'metrics',
      tabId: 'ov-tab-metrics',
      panelId: 'ov-panel-metrics',
      label: 'Market metrics',
      badge: live.metrics[0]?.value ?? '4 cards',
      tone: toFolderTone(live.metrics[0]?.color ?? 'teal'),
    },
    {
      id: 'pulse',
      tabId: 'ov-tab-pulse',
      panelId: 'ov-panel-pulse',
      label: 'Open interest',
      badge: live.oiRegime.activeRow
        ? `${live.oiRegime.activeRow.marketTitle} · ${live.oiRegime.activeRow.sentiment}`
        : confirmationInfo.status,
      tone: live.oiRegime.activeRow
        ? live.oiRegime.activeRow.sentiment === 'Bullish'
          ? 'teal'
          : 'rose'
        : 'blue',
    },
  ]

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#overview" onClick={() => setActiveTab('overview')}>
          <span className="brand-mark">→</span>
          <span>
            TAKE THE TRADE
            <small>MARKET OBSERVATORY</small>
          </span>
        </a>
        <nav aria-label="Main navigation">
          <button
            type="button"
            className={activeTab === 'overview' ? 'active' : ''}
            aria-current={activeTab === 'overview' ? 'page' : undefined}
            onClick={() => setActiveTab('overview')}
          >
            Overview
          </button>
          <button
            type="button"
            className={activeTab === 'footprint' ? 'active' : ''}
            aria-current={activeTab === 'footprint' ? 'page' : undefined}
            onClick={() => setActiveTab('footprint')}
          >
            Footprint
          </button>
          <button onClick={() => setPanel('events')}>
            Events <span className="nav-count">{visibleEvents.length}</span>
          </button>
          <button onClick={() => setPanel('guide')}>Guide</button>
          <button onClick={() => setPanel('settings')}>Settings</button>
          <button onClick={() => setTradePanel('journal')} aria-haspopup="dialog">Journal</button>
          <button className="nav-trade" onClick={() => setTradePanel('plan')} aria-haspopup="dialog">
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
            <h1>{activeTab === 'footprint' ? 'Trade footprint' : 'Market overview'}</h1>
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
        {activeTab === 'footprint' ? (
          <FootprintTab
            trades={live.trades}
            backfill={live.backfill}
            svpHistory={live.svpHistory}
            referenceLevels={referenceLevels}
            timeframeShort={timeframe}
            timeframeLabel={live.timeframeLabel}
            bucketMs={getTimeframeOption(timeframe).bucketMs}
            status={live.status}
            updated={live.updated}
          />
        ) : (
          <>
            <FolderShell
              label="Overview sections"
              tabs={overviewTabs}
              activeId={overviewFolder}
              onSelect={setOverviewFolder}
            >
              <div
                role="tabpanel"
                id="ov-panel-story"
                aria-labelledby="ov-tab-story"
                className="folder-panel"
                hidden={overviewFolder !== 'story'}
              >
                <MarketStory
                  story={live.story}
                  timeframeShort={timeframe}
                  confirmedTitle={live.oiRegime.activeRow?.marketTitle ?? null}
                  confirmedSentiment={live.oiRegime.activeRow?.sentiment ?? null}
                  confirmationStatus={confirmationInfo.status}
                  focus={focus}
                  onOpenGuide={() => setPanel('guide')}
                />
              </div>
              <div role="tabpanel" id="ov-panel-levels" aria-labelledby="ov-tab-levels"
                className="folder-panel" hidden={overviewFolder !== 'levels'}>
                {overviewFolder === 'levels' && <ReferenceLevels model={referenceLevels} />}
              </div>
              <div
                role="tabpanel"
                id="ov-panel-metrics"
                aria-labelledby="ov-tab-metrics"
                className="folder-panel"
                hidden={overviewFolder !== 'metrics'}
              >
                <div className="folder-surface">
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
                    {live.metrics.map(metric => (
                      <button type="button" key={metric.id}
                        className={`metric ${metric.color}`}
                        onClick={() => setPanel(metric.id)}
                        aria-label={`Open ${metric.label} details`}>
                        <span className="card-head">{metric.label} <span aria-hidden="true">→</span></span>
                        <strong>{metric.value}</strong>
                        {!focus && (
                          <span className="chart" aria-hidden="true">
                            {metric.bars.map((height, i) => <i key={i} style={{ height: `${height}%` }} />)}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div
                role="tabpanel"
                id="ov-panel-pulse"
                aria-labelledby="ov-tab-pulse"
                className="folder-panel"
                hidden={overviewFolder !== 'pulse'}
              >
                <div className="folder-surface">
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
                                : observed
                                  ? 'Mixed / flat'
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
                </div>
              </div>
            </FolderShell>

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
          </>
        )}
        <footer>
          <span>TAKE THE TRADE · OKX LIVE STREAM</span>
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
          {panel === 'guide' && (
            <>
              <div className="detail-box">
                <strong>Read the Market Story</strong>
                <p><strong>Price.</strong> The line shows price over time. The dotted line, when available, shows the 6-hour volume-weighted average price (VWAP).</p>
                <p><strong>Pressure.</strong> Up bars show more volume from trades initiated by buyers. Down bars show more from trades initiated by sellers. Taller bars show a larger difference. Dashed slots show missing data.</p>
                <p><strong>Positions.</strong> Open interest measures outstanding contracts. ▲ increased, ▼ decreased, — little change, · no snapshot.</p>
                <p><strong>Events.</strong> Markers show the time bucket for reported liquidations and app alerts.</p>
              </div>
              <div className="detail-box">
                <strong>Chart annotations</strong>
                <p><strong>Divergence.</strong> Price rose while sell volume exceeded buy volume, or price fell while buy volume exceeded sell volume.</p>
                <p><strong>Possible absorption.</strong> Buy or sell volume is one-sided while price moves little. Shaded supply and demand zones are inferred from price structure.</p>
                <p><strong>Structure and sweeps.</strong> BOS marks a break beyond a recent high or low in the direction of the trend. CHoCH marks a break against the prior trend. A sweep marks a move past a recent level followed by a return inside it.</p>
                <p><strong>Smart RSI.</strong> A momentum reading that combines price RSI and volume-weighted money flow. The display labels readings of 70 or higher overbought and 30 or lower oversold.</p>
              </div>
              <div className="detail-box">
                <strong>Live and closed windows</strong>
                <p>A dashed phase label marks a window still in progress. Market Pulse evaluates completed windows. Select a time bucket to see its readings.</p>
              </div>
            </>
          )}
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
                  Pulse and the regime matrix use closed windows of this length, independent of the chart timeframe. A single completed window that clears the thresholds confirms.
                </p>
                <label className="setting">
                  <span>
                    <strong>Balanced</strong>
                    <small>One 5m close</small>
                  </span>
                  <input type="radio" name="confirmation-mode" value="5m" checked={confirmationMode === '5m'} onChange={() => setConfirmationMode('5m')} />
                </label>
                <label className="setting">
                  <span>
                    <strong>Slow</strong>
                    <small>One 15m close</small>
                  </span>
                  <input type="radio" name="confirmation-mode" value="15m" checked={confirmationMode === '15m'} onChange={() => setConfirmationMode('15m')} />
                </label>
                <p>
                  Closed windows are rebuilt from OKX candles and locally sampled open interest after an interruption, then updated on each live UTC window close (for 5m, 12:05–12:10 and 12:10–12:15 UTC). One completed close that clears the thresholds confirms the regime.
                </p>
                <p>
                  Defaults: price must move at least {SIGNAL_RULES.minimumPricePct}% and open interest at least {SIGNAL_RULES.minimumOiPct}% (either per window or across two consecutive closes in the same direction). Price and open interest determine the regime, with volume (±{SIGNAL_RULES.minimumVolumeChangePct}%) tracked as supporting confirmation.
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
        open={tradePanel !== null}
        mode={tradePanel ?? 'plan'}
        onOpenJournal={() => setTradePanel('journal')}
        onClose={() => setTradePanel(null)}
        draft={trade.draft}
        setDraft={trade.setDraft}
        result={trade.result}
        livePrice={live.snapshot.price}
        timeframeLabel={live.timeframeLabel}
        confirmationLabel={`${confirmationInfo.status}, ${confirmationMode} confirmation. ${confirmationInfo.progress}`}
        captureSnapshot={captureCurrentSnapshot}
        journal={journal}
      />
    </div>
  )
}

export default App
