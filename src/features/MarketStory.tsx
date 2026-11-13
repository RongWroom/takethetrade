import { useState } from 'react'
import type { MarketStoryEvaluation, StoryBucketPoint } from '../domain/marketStory'

function formatTimeUtc(ms: number): string {
  return new Date(ms).toISOString().slice(11, 16)
}

function formatPriceUsdt(px: number | null): string {
  if (px === null || !Number.isFinite(px)) return '—'
  return `${px.toLocaleString('en-US', { maximumFractionDigits: 0 })} USDT`
}

function formatSignedBtcShort(btc: number | null): string {
  if (btc === null || !Number.isFinite(btc)) return 'No flow data'
  const sign = btc > 0 ? '+' : btc < 0 ? '-' : ''
  const abs = Math.abs(btc)
  if (abs === 0) return '0.00 ₿'
  return `${sign}${abs.toFixed(2)} ₿`
}

function formatUsdShort(usd: number): string {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}m`
  if (usd >= 1_000) return `$${Math.round(usd / 1_000)}k`
  return `$${Math.round(usd)}`
}

function oiStateText(b: StoryBucketPoint): string {
  if (b.oiState === 'opening') {
    const delta = b.oiChangeBtc !== null ? ` (+${b.oiChangeBtc.toFixed(1)} ₿)` : ''
    return `Positions opening${delta}`
  }
  if (b.oiState === 'closing') {
    const delta = b.oiChangeBtc !== null ? ` (${b.oiChangeBtc.toFixed(1)} ₿)` : ''
    return `Positions closing${delta}`
  }
  if (b.oiState === 'steady') return 'Positions steady'
  return 'OI snapshot missing'
}

export function MarketStory({
  story,
  timeframeShort,
  confirmedTitle,
  confirmedSentiment,
  confirmationStatus,
  focus = false,
}: {
  story: MarketStoryEvaluation
  timeframeShort: string
  confirmedTitle: string | null
  confirmedSentiment: 'Bullish' | 'Bearish' | null
  confirmationStatus: string
  focus?: boolean
}) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)

  const latestActiveIdx = (() => {
    for (let i = story.buckets.length - 1; i >= 0; i--) {
      if (story.buckets[i].phaseId !== 'waiting') return i
    }
    return story.buckets.length - 1
  })()

  const activeIdx = selectedIdx !== null && story.buckets[selectedIdx] ? selectedIdx : latestActiveIdx
  const inspected = story.buckets[activeIdx] ?? story.buckets[story.buckets.length - 1]

  const count = story.buckets.length
  const xForIndex = (idx: number) => (count <= 1 ? 50 : Number((((idx + 0.5) / count) * 100).toFixed(2)))

  const pricePoints = story.buckets
    .filter((b): b is StoryBucketPoint & { priceY: number } => b.priceY !== null)
    .map(b => ({ x: xForIndex(b.index), y: b.priceY, bucket: b }))

  const polylinePoints = pricePoints.map(p => `${p.x},${p.y}`).join(' ')

  return (
    <section className={`market-story tone-${story.tone}`} aria-label="Market Story visual">
      <div className="ms-header">
        <div className="ms-title-block">
          <div className="ms-eyebrow-row">
            <span className="eyebrow">MARKET STORY · {timeframeShort.toUpperCase()} TIMELINE</span>
            <span className="ms-live-badge" title="Developing live buckets are dashed; confirmed multi-window context is solid">
              <i className="ms-dot" /> Live developing
            </span>
            {confirmedTitle ? (
              <span className={`ms-confirmed-badge ${confirmedSentiment?.toLowerCase() ?? ''}`}>
                Confirmed: {confirmedTitle} ({confirmedSentiment})
              </span>
            ) : (
              <span className="ms-confirmed-badge pending">{confirmationStatus}</span>
            )}
          </div>
          <h2 className="ms-headline">{story.headline}</h2>
          <p className="ms-subheadline">{story.subheadline}</p>
        </div>

        {story.priceMax !== null && story.priceMin !== null && (
          <div className="ms-range-pill" aria-label="Window price range">
            <span>
              <small>Window High</small>
              <strong>{formatPriceUsdt(story.priceMax)}</strong>
            </span>
            <span>
              <small>Window Low</small>
              <strong>{formatPriceUsdt(story.priceMin)}</strong>
            </span>
          </div>
        )}
      </div>

      {story.windowDivergence && (
        <div
          className={`ms-divergence-banner ${story.windowDivergence.kind}`}
          role="status"
          aria-label="Order-flow divergence detected"
        >
          <div className="ms-div-badge">
            <span>◇</span> {story.windowDivergence.label}
          </div>
          <div className="ms-div-copy">
            <strong>{story.windowDivergence.headline}</strong>
            <span>{story.windowDivergence.explanation}</span>
          </div>
        </div>
      )}

      <div className="ms-chapters" aria-label="Market phase sequence">
        <span className="ms-chapters-label">Progression:</span>
        {story.chapters.length === 0 ? (
          <span className="ms-chapter-empty">Collecting initial buckets to trace phase transitions…</span>
        ) : (
          <div className="ms-chapter-list">
            {story.chapters.map((ch, idx) => (
              <div key={ch.id} className="ms-chapter-item">
                {idx > 0 && (
                  <span className="ms-chapter-arrow" aria-hidden="true">
                    →
                  </span>
                )}
                <button
                  type="button"
                  className={`ms-chapter-pill tone-${ch.tone} ${ch.isCurrent ? 'is-current' : ''} ${ch.isDeveloping ? 'is-developing' : ''}`}
                  onClick={() => setSelectedIdx(ch.endBucket)}
                  title={`${formatTimeUtc(ch.startTime)}–${formatTimeUtc(ch.endTime)} UTC (${ch.count} ${ch.count === 1 ? 'bucket' : 'buckets'})`}
                >
                  <span>{ch.label}</span>
                  <small>
                    {ch.count}×{timeframeShort}
                    {ch.isDeveloping ? ' · live' : ''}
                  </small>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {!focus && (
        <>
          <div className="ms-canvas" role="group" aria-label="Aligned price, order-flow pressure, positions, and events lanes">
            {/* Lane 1: Price & Structure */}
            <div className="ms-lane ms-lane-price">
              <div className="ms-lane-label">
                <strong>PRICE</strong>
                <small>vs flow &amp; VWAP</small>
              </div>
              <div className="ms-lane-track ms-price-track">
                <svg className="ms-price-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  {story.vwapY !== null && (
                    <line
                      x1="0"
                      y1={story.vwapY}
                      x2="100"
                      y2={story.vwapY}
                      className="ms-vwap-line"
                      strokeDasharray="2 2"
                    />
                  )}
                  {pricePoints.length >= 2 && <polyline points={polylinePoints} className="ms-price-line" />}
                </svg>
                {story.vwap !== null && story.vwapY !== null && (
                  <span className="ms-vwap-tag" style={{ top: `${Math.min(Math.max(story.vwapY, 12), 84)}%` }}>
                    6h VWAP {formatPriceUsdt(story.vwap)}
                  </span>
                )}
                <div className="ms-columns-overlay">
                  {story.buckets.map(b => {
                    const isSelected = b.index === activeIdx
                    return (
                      <button
                        key={b.start}
                        type="button"
                        className={`ms-col-hit ${isSelected ? 'is-selected' : ''} ${b.isDeveloping ? 'is-developing' : ''}`}
                        aria-label={`Inspect ${formatTimeUtc(b.start)} UTC bucket: ${b.phaseLabel}`}
                        onMouseEnter={() => setSelectedIdx(b.index)}
                        onFocus={() => setSelectedIdx(b.index)}
                        onClick={() => setSelectedIdx(b.index)}
                      >
                        {b.priceY !== null && (
                          <span
                            className={`ms-price-node tone-${b.phaseTone} ${b.divergence ? 'has-divergence' : ''} ${b.absorption ? 'has-absorption' : ''}`}
                            style={{ top: `${b.priceY}%` }}
                          />
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Lane 2: Pressure Ribbon */}
            <div className="ms-lane">
              <div className="ms-lane-label">
                <strong>PRESSURE</strong>
                <small>Taker buy / sell</small>
              </div>
              <div className="ms-lane-track ms-pressure-track">
                <div className="ms-zero-line" aria-hidden="true" />
                {story.buckets.map(b => {
                  const isSelected = b.index === activeIdx
                  return (
                    <div
                      key={b.start}
                      className={`ms-pressure-col ${isSelected ? 'is-selected' : ''} ${b.isDeveloping ? 'is-developing' : ''}`}
                      onMouseEnter={() => setSelectedIdx(b.index)}
                      onClick={() => setSelectedIdx(b.index)}
                    >
                      <div className="ms-pressure-up">
                        {b.pressureDirection === 'buy' && (
                          <i
                            className={`ms-bar-buy ${b.divergence ? 'is-divergent' : ''}`}
                            style={{ height: `${b.pressureHeightPct}%` }}
                          />
                        )}
                      </div>
                      <div className="ms-pressure-down">
                        {b.pressureDirection === 'sell' && (
                          <i
                            className={`ms-bar-sell ${b.divergence ? 'is-divergent' : ''}`}
                            style={{ height: `${b.pressureHeightPct}%` }}
                          />
                        )}
                        {b.pressureDirection === 'flat' && <i className="ms-bar-flat" />}
                        {b.pressureDirection === 'missing' && <i className="ms-bar-missing" title="No trade flow data" />}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Lane 3: Open Interest Positions */}
            <div className="ms-lane">
              <div className="ms-lane-label">
                <strong>POSITIONS</strong>
                <small>Open interest</small>
              </div>
              <div className="ms-lane-track ms-oi-track">
                {story.buckets.map(b => {
                  const isSelected = b.index === activeIdx
                  return (
                    <div
                      key={b.start}
                      className={`ms-oi-cell state-${b.oiState} ${isSelected ? 'is-selected' : ''}`}
                      onMouseEnter={() => setSelectedIdx(b.index)}
                      onClick={() => setSelectedIdx(b.index)}
                      title={oiStateText(b)}
                    >
                      <span className="ms-oi-chip">
                        {b.oiState === 'opening'
                          ? '▲ Open'
                          : b.oiState === 'closing'
                            ? '▼ Close'
                            : b.oiState === 'steady'
                              ? '—'
                              : '·'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Lane 4: Events & Divergences */}
            <div className="ms-lane">
              <div className="ms-lane-label">
                <strong>EVENTS</strong>
                <small>Liqs &amp; signals</small>
              </div>
              <div className="ms-lane-track ms-events-track">
                {story.buckets.map(b => {
                  const isSelected = b.index === activeIdx
                  const hasLiq = b.totalLiqUsd > 0
                  const dominantLiqSide = b.longLiqUsd >= b.shortLiqUsd ? 'long' : 'short'
                  return (
                    <div
                      key={b.start}
                      className={`ms-event-cell ${isSelected ? 'is-selected' : ''}`}
                      onMouseEnter={() => setSelectedIdx(b.index)}
                      onClick={() => setSelectedIdx(b.index)}
                    >
                      {b.divergence && (
                        <span
                          className={`ms-marker divergence ${b.divergence}`}
                          title={b.divergence === 'bearish' ? 'Bearish divergence (hollow rise)' : 'Bullish divergence (hollow drop)'}
                        >
                          ◇ Div
                        </span>
                      )}
                      {!b.divergence && b.absorption && (
                        <span className="ms-marker absorption" title="Possible passive absorption">
                          ◈ Wall
                        </span>
                      )}
                      {hasLiq && (
                        <span
                          className={`ms-marker liq ${dominantLiqSide} ${b.isLargeLiq ? 'is-large' : ''}`}
                          title={`Reported liquidations: ${formatUsdShort(b.totalLiqUsd)}`}
                        >
                          ϟ {formatUsdShort(b.totalLiqUsd)}
                        </span>
                      )}
                      {!b.divergence && !b.absorption && !hasLiq && <span className="ms-marker-empty">·</span>}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Timeline axis */}
            <div className="ms-axis-row" aria-hidden="true">
              <div className="ms-axis-spacer" />
              <div className="ms-axis-times">
                <span>{story.buckets[0] ? `${formatTimeUtc(story.buckets[0].start)} UTC` : '—'}</span>
                <span>{story.buckets[Math.floor(count / 2)] ? `${formatTimeUtc(story.buckets[Math.floor(count / 2)].start)} UTC` : '—'}</span>
                <span>Now ({timeframeShort} developing) →</span>
              </div>
            </div>
          </div>

          {/* Shared Inspector Bar */}
          {inspected && (
            <div className="ms-inspector" aria-live="polite">
              <div className="ms-inspector-top">
                <span className="ms-inspector-time">
                  {formatTimeUtc(inspected.start)}–{formatTimeUtc(inspected.end)} UTC
                  {inspected.isDeveloping ? ' · Developing bucket' : ' · Closed bucket'}
                </span>
                <span className={`ms-phase-tag tone-${inspected.phaseTone}`}>{inspected.phaseLabel}</span>
              </div>
              <div className="ms-inspector-metrics">
                <span>
                  <small>Price</small>{' '}
                  <strong>
                    {formatPriceUsdt(inspected.priceClose)}
                    {inspected.pricePct !== null && (
                      <em className={inspected.pricePct > 0 ? 'up' : inspected.pricePct < 0 ? 'down' : ''}>
                        {' '}
                        ({inspected.pricePct >= 0 ? '+' : ''}
                        {inspected.pricePct.toFixed(2)}%)
                      </em>
                    )}
                  </strong>
                </span>
                <span>
                  <small>Net Pressure</small>{' '}
                  <strong
                    className={
                      inspected.deltaBtc !== null
                        ? inspected.deltaBtc > 0
                          ? 'up'
                          : inspected.deltaBtc < 0
                            ? 'down'
                            : ''
                        : ''
                    }
                  >
                    {formatSignedBtcShort(inspected.deltaBtc)}
                  </strong>
                </span>
                <span>
                  <small>Positions</small> <strong>{oiStateText(inspected)}</strong>
                </span>
                <span>
                  <small>Reported Liqs</small>{' '}
                  <strong>{inspected.totalLiqUsd > 0 ? formatUsdShort(inspected.totalLiqUsd) : 'None'}</strong>
                </span>
              </div>
              <p className="ms-inspector-summary">{inspected.summary}</p>
            </div>
          )}
        </>
      )}
    </section>
  )
}
