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

function bucketStructureText(b: StoryBucketPoint): { text: string; tone: 'up' | 'down' | '' } {
  if (b.isDeveloping) {
    return { text: 'Developing (confirms on close)', tone: '' }
  }
  if (b.liquiditySweep === 'bullish-sweep') {
    const lvl = b.structureLevel !== null ? ` ($${Math.round(b.structureLevel).toLocaleString('en-US')})` : ''
    return { text: `⚡ Bullish Sweep${lvl}`, tone: 'up' }
  }
  if (b.liquiditySweep === 'bearish-sweep') {
    const lvl = b.structureLevel !== null ? ` ($${Math.round(b.structureLevel).toLocaleString('en-US')})` : ''
    return { text: `⚡ Bearish Sweep${lvl}`, tone: 'down' }
  }
  if (b.structureBreak) {
    const map = {
      'bullish-bos': { label: 'Bullish BOS', tone: 'up' as const },
      'bearish-bos': { label: 'Bearish BOS', tone: 'down' as const },
      'bullish-choch': { label: 'Bullish CHoCH', tone: 'up' as const },
      'bearish-choch': { label: 'Bearish CHoCH', tone: 'down' as const },
    }[b.structureBreak]
    const lvl = b.structureLevel !== null ? ` ($${Math.round(b.structureLevel).toLocaleString('en-US')})` : ''
    return { text: `${map.label}${lvl}`, tone: map.tone }
  }
  return { text: 'In range', tone: '' }
}

export function MarketStory({
  story,
  timeframeShort,
  confirmedTitle,
  confirmedSentiment,
  confirmationStatus,
  focus = false,
  onOpenGuide,
}: {
  story: MarketStoryEvaluation
  timeframeShort: string
  confirmedTitle: string | null
  confirmedSentiment: 'Bullish' | 'Bearish' | null
  confirmationStatus: string
  focus?: boolean
  onOpenGuide?: () => void
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
            {onOpenGuide && (
              <button
                type="button"
                className="ms-guide-btn"
                onClick={onOpenGuide}
                aria-label="How it works"
                title="How it works"
              >
                ?
              </button>
            )}
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

        <div className="ms-header-pills">
          <div
            className={`ms-rsi-pill ${story.smartRsi ? `tone-${story.smartRsi.tone}` : 'is-warming'}`}
            aria-label="Smart RSI gauge"
            title={story.smartRsi ? story.smartRsi.summary : 'Collecting price and volume buckets to calculate Smart RSI'}
          >
            <div className="ms-rsi-top">
              <small>Smart RSI</small>
              <span className={`ms-rsi-badge ${story.smartRsi ? `zone-${story.smartRsi.zone}` : ''}`}>
                {story.smartRsi ? story.smartRsi.shortLabel : 'Warming'}
              </span>
            </div>
            <div className="ms-rsi-row">
              <strong>{story.smartRsi ? story.smartRsi.value.toFixed(1) : '—'}</strong>
              <div className="ms-rsi-bar" aria-hidden="true">
                <span className="ms-rsi-zone-os" />
                <span className="ms-rsi-zone-ob" />
                {story.smartRsi && (
                  <i
                    className="ms-rsi-thumb"
                    style={{ left: `${Math.min(Math.max(story.smartRsi.value, 2), 98)}%` }}
                  />
                )}
              </div>
            </div>
          </div>

          <div
            className={`ms-structure-pill tone-${story.structure.tone}`}
            aria-label="LuxAlgo market structure and liquidity sweeps"
            title={story.structure.summary}
          >
            <div className="ms-rsi-top">
              <small>Structure</small>
              <span className={`ms-rsi-badge bias-${story.structure.bias}`}>
                {story.structure.bias === 'bullish'
                  ? 'Bullish'
                  : story.structure.bias === 'bearish'
                    ? 'Bearish'
                    : 'Neutral'}
              </span>
            </div>
            <div className="ms-structure-row">
              <strong>{story.structure.shortLabel}</strong>
              {story.structure.orderBlock && (
                <small className={`ms-ob-inline ${story.structure.orderBlock.kind}`}>
                  {story.structure.orderBlock.kind === 'bullish' ? 'Demand OB' : 'Supply OB'}
                </small>
              )}
            </div>
          </div>

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
        </div>
      </div>

      {story.windowDivergence ? (
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
      ) : (
        <div className="ms-divergence-banner is-calm" aria-hidden="true">
          <div className="ms-div-badge">
            <span>✓</span> Flow aligned
          </div>
          <div className="ms-div-copy">
            <strong>Price and order flow are moving in sync</strong>
            <span>No multi-bucket price vs. cumulative delta divergence detected in this window.</span>
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
                  {story.structure.orderBlock && (
                    <rect
                      x={Math.max(0, xForIndex(story.structure.orderBlock.bucketIndex) - 3)}
                      y={Math.min(story.structure.orderBlock.topY, story.structure.orderBlock.bottomY)}
                      width={Math.min(100, 103 - xForIndex(story.structure.orderBlock.bucketIndex))}
                      height={Math.max(4, Math.abs(story.structure.orderBlock.bottomY - story.structure.orderBlock.topY))}
                      className={`ms-ob-zone ${story.structure.orderBlock.kind}`}
                    />
                  )}
                  {story.structure.lastEventLevelY !== null && story.structure.lastEventBucketIndex !== null && (
                    <line
                      x1={Math.max(0, xForIndex(story.structure.lastEventBucketIndex) - 8)}
                      y1={story.structure.lastEventLevelY}
                      x2="100"
                      y2={story.structure.lastEventLevelY}
                      className={`ms-structure-line ${
                        story.structure.lastEvent === 'bullish-bos' || story.structure.lastEvent === 'bullish-choch'
                          ? 'bullish'
                          : 'bearish'
                      }`}
                      strokeDasharray="1.5 1.5"
                    />
                  )}
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
                {story.structure.orderBlock && (
                  <span
                    className={`ms-ob-tag ${story.structure.orderBlock.kind}`}
                    style={{
                      top: `${Math.min(
                        Math.max((story.structure.orderBlock.topY + story.structure.orderBlock.bottomY) / 2, 14),
                        86,
                      )}%`,
                    }}
                  >
                    {story.structure.orderBlock.label}
                  </span>
                )}
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
                            className={`ms-price-node tone-${b.phaseTone} ${b.divergence ? 'has-divergence' : ''} ${b.absorption ? 'has-absorption' : ''} ${b.rsiZone !== 'neutral' ? `rsi-${b.rsiZone}` : ''}`}
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
                      {b.liquiditySweep && (
                        <span
                          className={`ms-marker sweep ${b.liquiditySweep === 'bullish-sweep' ? 'bullish' : 'bearish'}`}
                          title={
                            b.liquiditySweep === 'bullish-sweep'
                              ? 'Bullish liquidity sweep (stop hunt below low)'
                              : 'Bearish liquidity sweep (stop hunt above high)'
                          }
                        >
                          ⚡ Sweep
                        </span>
                      )}
                      {!b.liquiditySweep && b.structureBreak && (
                        <span
                          className={`ms-marker structure ${
                            b.structureBreak === 'bullish-bos' || b.structureBreak === 'bullish-choch'
                              ? 'bullish'
                              : 'bearish'
                          }`}
                          title={bucketStructureText(b).text}
                        >
                          {b.structureBreak === 'bullish-choch'
                            ? 'CHoCH ↑'
                            : b.structureBreak === 'bearish-choch'
                              ? 'CHoCH ↓'
                              : b.structureBreak === 'bullish-bos'
                                ? 'BOS ↑'
                                : 'BOS ↓'}
                        </span>
                      )}
                      {!b.isDeveloping && !b.liquiditySweep && !b.structureBreak && b.divergence && (
                        <span
                          className={`ms-marker divergence ${b.divergence}`}
                          title={b.divergence === 'bearish' ? 'Bearish divergence (hollow rise)' : 'Bullish divergence (hollow drop)'}
                        >
                          ◇ Div
                        </span>
                      )}
                      {!b.isDeveloping && !b.liquiditySweep && !b.structureBreak && !b.divergence && b.absorption && (
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
                      {!b.isDeveloping &&
                        !b.liquiditySweep &&
                        !b.structureBreak &&
                        !b.divergence &&
                        !b.absorption &&
                        !hasLiq &&
                        b.rsiZone !== 'neutral' &&
                        b.rsi !== null && (
                          <span
                            className={`ms-marker rsi ${b.rsiZone}`}
                            title={
                              b.rsiZone === 'overbought'
                                ? `Smart RSI ${b.rsi.toFixed(1)} (Overbought ≥ 70)`
                                : `Smart RSI ${b.rsi.toFixed(1)} (Oversold ≤ 30)`
                            }
                          >
                            {b.rsiZone === 'overbought' ? '▲' : '▼'} RSI {b.rsi.toFixed(0)}
                          </span>
                        )}
                      {(b.isDeveloping
                        ? !hasLiq
                        : !b.liquiditySweep &&
                          !b.structureBreak &&
                          !b.divergence &&
                          !b.absorption &&
                          !hasLiq &&
                          b.rsiZone === 'neutral') && <span className="ms-marker-empty">·</span>}
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
                  <small>Smart RSI</small>{' '}
                  <strong
                    className={
                      inspected.rsiZone === 'oversold'
                        ? 'up'
                        : inspected.rsiZone === 'overbought'
                          ? 'down'
                          : ''
                    }
                  >
                    {inspected.rsi !== null
                      ? `${inspected.rsi.toFixed(1)} (${
                          inspected.rsiZone === 'overbought'
                            ? 'Overbought'
                            : inspected.rsiZone === 'oversold'
                              ? 'Oversold'
                              : 'Balanced'
                        })`
                      : 'Warming'}
                  </strong>
                </span>
                <span>
                  <small>Structure</small>{' '}
                  <strong className={bucketStructureText(inspected).tone}>
                    {bucketStructureText(inspected).text}
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
