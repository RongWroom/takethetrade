import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  evaluateFootprint,
  evaluateFpbsStats,
  evaluateSessionProfile,
  evaluateTradeSizeFlow,
  FOOTPRINT_STEP_OPTIONS,
  formatFpbsCsv,
  SVP_RANGE_OPTIONS,
  type FootprintCandle,
  type FootprintStepOption,
  type FootprintTrade,
  type SvpRangeId,
  type TradeSizeScope,
} from '../domain/footprint'
import type { OkxCandlePoint, OkxTakerVolumeBucket } from '../data/okx'
import type { SvpHistoryData } from './LiveOverview'

export type FolderTone = 'teal' | 'rose' | 'amber' | 'blue'

export type FolderTabDef<T extends string> = {
  id: T
  tabId: string
  panelId: string
  label: string
  badge: string
  tone: FolderTone
}

export function FolderShell<T extends string>({
  label,
  tabs,
  activeId,
  onSelect,
  children,
}: {
  label: string
  tabs: readonly FolderTabDef<T>[]
  activeId: T
  onSelect: (id: T) => void
  children: ReactNode
}) {
  const tabRefs = useRef<Partial<Record<T, HTMLButtonElement | null>>>({})

  const selectTab = (id: T, shouldFocus = false) => {
    onSelect(id)
    const el = tabRefs.current[id]
    if (el) {
      if (shouldFocus) el.focus()
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const idx = tabs.findIndex(t => t.id === activeId)
    if (idx < 0 || tabs.length === 0) return
    let nextIdx: number | null = null
    if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length
    else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') nextIdx = 0
    else if (e.key === 'End') nextIdx = tabs.length - 1
    if (nextIdx === null) return
    e.preventDefault()
    selectTab(tabs[nextIdx].id, true)
  }

  return (
    <div className="folder-shell">
      <div className="folder-tablist" role="tablist" aria-label={label} onKeyDown={handleKeyDown}>
        {tabs.map(tab => {
          const isSelected = tab.id === activeId
          return (
            <button
              key={tab.id}
              ref={el => {
                tabRefs.current[tab.id] = el
              }}
              type="button"
              role="tab"
              id={tab.tabId}
              className="folder-tab"
              aria-selected={isSelected}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => selectTab(tab.id)}
            >
              <span className="folder-tab-label">{tab.label}</span>
              <span className={`folder-tab-badge tone-${tab.tone}`}>{tab.badge}</span>
            </button>
          )
        })}
      </div>
      <div className="folder-deck">{children}</div>
    </div>
  )
}

function formatTimeUtc(ms: number): string {
  return new Date(ms).toISOString().slice(11, 16)
}

function formatPriceDollar(price: number | null): string {
  if (price === null || !Number.isFinite(price)) return '—'
  return `$${Math.round(price).toLocaleString('en-US')}`
}

function formatPriceUsdt(price: number | null): string {
  if (price === null || !Number.isFinite(price)) return '—'
  return `$${Math.round(price).toLocaleString('en-US')} USDT`
}

function formatSignedBtc(btc: number): string {
  const sign = btc > 0 ? '+' : btc < 0 ? '-' : ''
  return `${sign}${Math.abs(btc).toFixed(2)}`
}

function formatVolCell(btc: number): string {
  if (btc <= 0) return '·'
  if (btc >= 10) return btc.toFixed(1)
  return btc.toFixed(2)
}

function formatBtcAmount(btc: number): string {
  if (btc >= 1000) return Math.round(btc).toLocaleString('en-US')
  if (btc >= 100) return btc.toFixed(1)
  return btc.toFixed(2)
}

function formatSignedUsd(usd: number): string {
  const sign = usd >= 0 ? '+' : '-'
  return `${sign}$${Math.abs(Math.round(usd)).toLocaleString('en-US')}`
}

function describeValuePosition(candle: FootprintCandle): string {
  if (candle.close === null || candle.vahPrice === null || candle.valPrice === null) {
    return 'Waiting for trades'
  }
  const closeRow = Math.floor(candle.close / candle.stepUsd) * candle.stepUsd
  if (closeRow > candle.vahPrice) return 'Holding above value'
  if (closeRow < candle.valPrice) return 'Below value zone'
  return 'Inside value zone'
}

export function FootprintTab({
  trades,
  backfill,
  svpHistory,
  timeframeShort,
  timeframeLabel,
  bucketMs,
  status,
  updated,
}: {
  trades: readonly FootprintTrade[]
  backfill?: {
    candles: readonly OkxCandlePoint[]
    takerBuckets: readonly OkxTakerVolumeBucket[]
  }
  svpHistory?: SvpHistoryData
  timeframeShort: string
  timeframeLabel: string
  bucketMs: number
  status: string
  updated: number | null
}) {
  const [activeFolder, setActiveFolder] = useState<'ladder' | 'tsize' | 'svp' | 'fpbs'>('ladder')
  const [stepOption, setStepOption] = useState<FootprintStepOption>('auto')
  const [svpRange, setSvpRange] = useState<SvpRangeId>('24h')
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const [sizeScope, setSizeScope] = useState<TradeSizeScope>('window')
  const [fallbackNow, setFallbackNow] = useState(() => Date.now())
  const supportsFocusGroup = typeof HTMLElement !== 'undefined' && 'focusGroup' in HTMLElement.prototype
  const svpToolbarRef = useRef<HTMLDivElement>(null)
  const [svpToolbarFocusIdx, setSvpToolbarFocusIdx] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setFallbackNow(Date.now()), 5000)
    return () => clearInterval(id)
  }, [])

  const now = Math.max(updated ?? 0, fallbackNow)
  const evaluation = evaluateFootprint({
    trades,
    now,
    bucketMs,
    stepOption,
    backfill,
  })

  const latestActiveIdx = (() => {
    for (let i = evaluation.candles.length - 1; i >= 0; i--) {
      if (evaluation.candles[i].tradeCount > 0) return i
    }
    return evaluation.candles.length - 1
  })()

  const activeIdx = selectedIdx !== null && evaluation.candles[selectedIdx] ? selectedIdx : latestActiveIdx
  const inspected = evaluation.candles[activeIdx] ?? evaluation.candles[evaluation.candles.length - 1]
  const valueZonePosition = describeValuePosition(inspected)

  const sizeStart = sizeScope === 'candle' ? inspected.start : evaluation.candles[0].start
  const sizeEnd = sizeScope === 'candle' ? inspected.end : evaluation.candles[evaluation.candles.length - 1].end
  const sizeFlow = evaluateTradeSizeFlow({ trades, start: sizeStart, end: sizeEnd })
  const sessionProfile = evaluateSessionProfile({
    trades,
    candles: evaluation.candles,
    stepOption,
    rangeId: svpRange,
    now,
    timeframeShort,
    bucketMs,
    backfill,
    svpHistory,
  })
  const onLadderNpocCount = sessionProfile.nakedPocs.filter(n => n.onLadder).length
  const offLadderNpocCount = sessionProfile.nakedPocs.length - onLadderNpocCount
  const fpbs = evaluateFpbsStats(evaluation.candles)

  const handleSvpToolbarKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (supportsFocusGroup) return
    const bar = svpToolbarRef.current
    if (!bar) return
    const items = Array.from(bar.querySelectorAll<HTMLButtonElement>('button'))
    if (items.length === 0) return
    const currentIdx = items.indexOf(e.target as HTMLButtonElement)
    const activeItemIdx = currentIdx >= 0 ? currentIdx : svpToolbarFocusIdx
    const rtl = getComputedStyle(bar).direction === 'rtl'
    let nextIdx: number | null = null
    if (e.key === 'ArrowRight') nextIdx = (activeItemIdx + (rtl ? -1 : 1) + items.length) % items.length
    else if (e.key === 'ArrowLeft') nextIdx = (activeItemIdx + (rtl ? 1 : -1) + items.length) % items.length
    else if (e.key === 'Home') nextIdx = 0
    else if (e.key === 'End') nextIdx = items.length - 1
    if (nextIdx === null) return
    e.preventDefault()
    setSvpToolbarFocusIdx(nextIdx)
    items[nextIdx].focus()
  }

  const handleExportCsv = () => {
    const csv = formatFpbsCsv(fpbs)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `takethetrade-fpbs-${timeframeShort}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  const stepPicker = (
    <div className="fp-step-picker" role="group" aria-label="Select footprint price step">
      {FOOTPRINT_STEP_OPTIONS.map(opt => (
        <button
          key={String(opt.value)}
          type="button"
          className={`fp-step-btn ${stepOption === opt.value ? 'active' : ''}`}
          aria-pressed={stepOption === opt.value}
          onClick={() => setStepOption(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )

  const folderTabs: readonly FolderTabDef<'ladder' | 'tsize' | 'svp' | 'fpbs'>[] = [
    {
      id: 'ladder',
      tabId: 'fp-tab-ladder',
      panelId: 'fp-panel-ladder',
      label: 'Price Ladder (POC)',
      badge:
        inspected.pocPrice !== null
          ? `POC $${Math.round(inspected.pocPrice).toLocaleString('en-US')}`
          : inspected.badge.label,
      tone: inspected.badge.tone,
    },
    {
      id: 'tsize',
      tabId: 'fp-tab-tsize',
      panelId: 'fp-panel-tsize',
      label: 'Whale vs. Retail (TSize)',
      badge: sizeFlow.badge.label,
      tone: sizeFlow.badge.tone,
    },
    {
      id: 'svp',
      tabId: 'fp-tab-svp',
      panelId: 'fp-panel-svp',
      label: 'Session Profile (SVP)',
      badge:
        sessionProfile.sessionPocPrice !== null
          ? `SVP $${Math.round(sessionProfile.sessionPocPrice).toLocaleString('en-US')}`
          : sessionProfile.badge.label,
      tone: sessionProfile.badge.tone,
    },
    {
      id: 'fpbs',
      tabId: 'fp-tab-fpbs',
      panelId: 'fp-panel-fpbs',
      label: 'Bar Stats (FPBS)',
      badge:
        fpbs.totalTradeCount > 0 ? `CVD ${formatSignedBtc(fpbs.windowCvdBtc)} ₿` : fpbs.badge.label,
      tone: fpbs.badge.tone,
    },
  ]

  return (
    <FolderShell
      label="Footprint sections"
      tabs={folderTabs}
      activeId={activeFolder}
      onSelect={setActiveFolder}
    >
      <div
        role="tabpanel"
        id="fp-panel-ladder"
        aria-labelledby="fp-tab-ladder"
        className="folder-panel"
        hidden={activeFolder !== 'ladder'}
      >
        <section className={`fp-card tone-${inspected.badge.tone}`} aria-label="Footprint battleground">
      <div className="fp-header">
        <div className="fp-title-block">
          <div className="fp-eyebrow-row">
            <span className="eyebrow">SECTION 1 · FOOTPRINT BATTLEGROUND ({timeframeShort.toUpperCase()})</span>
            <span className={`fp-verdict-badge tone-${inspected.badge.tone}`}>{inspected.badge.label}</span>
            <span className="fp-meta-chip">
              {timeframeLabel} · ${inspected.stepUsd} steps · {status}
            </span>
          </div>
          <h2 className="fp-headline">{inspected.headline}</h2>
        </div>

        {stepPicker}
      </div>

      <div className="fp-candle-strip" role="group" aria-label="Select candle to inspect">
        {evaluation.candles.map(candle => {
          const isSelected = candle.index === activeIdx
          const deltaTone =
            candle.tradeCount === 0
              ? 'flat'
              : candle.deltaBtc > 0
                ? 'up'
                : candle.deltaBtc < 0
                  ? 'down'
                  : 'flat'
          return (
            <button
              key={candle.start}
              type="button"
              className={`fp-candle-pill ${isSelected ? 'is-selected' : ''} ${candle.isDeveloping ? 'is-developing' : ''}`}
              aria-pressed={isSelected}
              onClick={() => setSelectedIdx(candle.index)}
            >
              <span className="fp-cp-time">
                {candle.isDeveloping ? 'Now · Live' : `${formatTimeUtc(candle.start)} UTC`}
              </span>
              <strong className={`fp-cp-delta ${deltaTone}`}>
                {candle.tradeCount > 0 ? `${formatSignedBtc(candle.deltaBtc)} ₿` : '—'}
              </strong>
              <small className="fp-cp-count">
                {candle.tradeCount} {candle.tradeCount === 1 ? 'trade' : 'trades'}
              </small>
            </button>
          )
        })}
      </div>

      <div className="fp-scoreboard">
        <article className="fp-stat-card">
          <div className="fp-stat-title">
            <span aria-hidden="true">👑</span>
            <span>Point of Control (POC)</span>
          </div>
          <strong className="fp-stat-value">{formatPriceUsdt(inspected.pocPrice)}</strong>
          <div className="fp-stat-foot">
            <span>
              {inspected.tradeCount > 0 ? `${inspected.pocVolumeBtc.toFixed(2)} ₿ traded here` : 'No trades yet'}
            </span>
            <small>Most traded price</small>
          </div>
        </article>

        <article className="fp-stat-card">
          <div className="fp-stat-title">
            <span aria-hidden="true">🎯</span>
            <span>70% Value Zone</span>
          </div>
          <strong className="fp-stat-value">
            {inspected.valPrice !== null && inspected.vahPrice !== null
              ? inspected.valPrice === inspected.vahPrice
                ? formatPriceDollar(inspected.valPrice)
                : `${formatPriceDollar(inspected.valPrice)} – ${formatPriceDollar(inspected.vahPrice)}`
              : '—'}
          </strong>
          <div className="fp-stat-foot">
            <span>{valueZonePosition}</span>
            <small>Where 70% of volume fought</small>
          </div>
        </article>

        <article className="fp-stat-card">
          <div className="fp-stat-title">
            <span aria-hidden="true">⚡</span>
            <span>Intrabar Delta Swing</span>
          </div>
          <strong
            className={`fp-stat-value ${
              inspected.tradeCount === 0
                ? ''
                : inspected.deltaBtc > 0
                  ? 'up'
                  : inspected.deltaBtc < 0
                    ? 'down'
                    : ''
            }`}
          >
            {inspected.tradeCount > 0
              ? `${formatSignedBtc(inspected.deltaBtc)} ₿ · ${inspected.deltaPct >= 0 ? '+' : ''}${Math.round(inspected.deltaPct)}%`
              : '—'}
          </strong>
          <div className="fp-stat-foot">
            <span>
              {inspected.tradeCount > 0
                ? `Peak ${formatSignedBtc(inspected.maxDeltaBtc)} ₿ / Low ${formatSignedBtc(inspected.minDeltaBtc)} ₿`
                : 'Waiting for trades'}
            </span>
            <small>
              {inspected.tradeCount} {inspected.tradeCount === 1 ? 'live trade' : 'live trades'}
            </small>
          </div>
        </article>
      </div>

      {inspected.rows.length === 0 ? (
        <div className="fp-empty">
          <strong>Waiting for live OKX trades in this {timeframeShort} candle</strong>
          <p>
            As market buys and sells stream in, each price step will stack here so you can spot the Point of
            Control (POC), 70% Value Zone, and 3x imbalances at a glance.
          </p>
        </div>
      ) : (
        <div className="fp-ladder-wrap" role="region" aria-label="Footprint price ladder" tabIndex={0}>
          <table className="fp-ladder-table">
            <thead>
              <tr>
                <th scope="col" className="col-sell">
                  SELLERS (HIT BID)
                </th>
                <th scope="col" className="col-price">
                  PRICE LEVEL
                </th>
                <th scope="col" className="col-buy">
                  BUYERS (LIFT ASK)
                </th>
              </tr>
            </thead>
            <tbody>
              {inspected.rows.map(row => (
                <tr
                  key={row.price}
                  className={`fp-row ${row.isPoc ? 'is-poc' : ''} ${row.inValueArea ? 'in-va' : ''} ${row.isCloseRow ? 'is-close' : ''}`}
                >
                  <td className="fp-cell-sell">
                    <div className="fp-side-cell sell">
                      <span
                        className="fp-fill sell"
                        style={{ width: `${row.sellWidthPct}%` }}
                        aria-hidden="true"
                      />
                      <span className="fp-cell-content">
                        {row.imbalance === 'sell' && <span className="fp-imb sell">⚡ 3x</span>}
                        <span className={`fp-vol ${row.sellBtc > 0 ? 'has-vol' : 'is-zero'}`}>
                          {formatVolCell(row.sellBtc)}
                        </span>
                      </span>
                    </div>
                  </td>

                  <th scope="row" className="fp-cell-price">
                    <div className="fp-price-inner">
                      <span className="fp-price-num">{formatPriceDollar(row.price)}</span>
                      <span className="fp-price-tags">
                        {row.isPoc && <span className="fp-tag poc">👑 POC</span>}
                        {row.isCloseRow && (
                          <span className="fp-tag close" title="Latest / close price row">
                            CLOSE
                          </span>
                        )}
                        {row.inValueArea && !row.isPoc && (
                          <span className="fp-tag va" title="Inside 70% Value Area">
                            VA
                          </span>
                        )}
                      </span>
                    </div>
                  </th>

                  <td className="fp-cell-buy">
                    <div className="fp-side-cell buy">
                      <span
                        className="fp-fill buy"
                        style={{ width: `${row.buyWidthPct}%` }}
                        aria-hidden="true"
                      />
                      <span className="fp-cell-content">
                        <span className={`fp-vol ${row.buyBtc > 0 ? 'has-vol' : 'is-zero'}`}>
                          {formatVolCell(row.buyBtc)}
                        </span>
                        {row.imbalance === 'buy' && <span className="fp-imb buy">⚡ 3x</span>}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="fp-takeaway">
        <p className="fp-oneliner">{inspected.oneLiner}</p>
        <div className="fp-legend" aria-label="Footprint legend">
          <span className="fp-legend-chip">👑 POC = Most traded price</span>
          <span className="fp-legend-chip">VA = 70% zone</span>
          <span className="fp-legend-chip">⚡ 3x = 300%+ imbalance</span>
        </div>
      </div>
    </section>
      </div>

      <div
        role="tabpanel"
        id="fp-panel-tsize"
        aria-labelledby="fp-tab-tsize"
        className="folder-panel"
        hidden={activeFolder !== 'tsize'}
      >
    <section className={`fp-card tone-${sizeFlow.badge.tone}`} aria-label="Whale vs Retail flow">
      <div className="fp-header">
        <div className="fp-title-block">
          <div className="fp-eyebrow-row">
            <span className="eyebrow">SECTION 2 · WHALE VS. RETAIL FLOW (TSIZE)</span>
            <span className={`fp-verdict-badge tone-${sizeFlow.badge.tone}`}>{sizeFlow.badge.label}</span>
            <span className="fp-meta-chip">
              {sizeScope === 'candle'
                ? inspected.isDeveloping
                  ? 'Now · Live candle'
                  : `${formatTimeUtc(inspected.start)} UTC candle`
                : `6-bar ${timeframeShort} window`}{' '}
              · {sizeFlow.totalTradeCount} trades
            </span>
          </div>
          <h2 className="fp-headline">{sizeFlow.headline}</h2>
        </div>

        <div className="fp-step-picker" role="group" aria-label="Select size flow scope">
          <button
            type="button"
            className={`fp-step-btn ${sizeScope === 'window' ? 'active' : ''}`}
            aria-pressed={sizeScope === 'window'}
            onClick={() => setSizeScope('window')}
          >
            6-Bar Window
          </button>
          <button
            type="button"
            className={`fp-step-btn ${sizeScope === 'candle' ? 'active' : ''}`}
            aria-pressed={sizeScope === 'candle'}
            onClick={() => setSizeScope('candle')}
          >
            Selected Candle
          </button>
        </div>
      </div>

      <div className="fp-scoreboard">
        <article className="fp-stat-card">
          <div className="fp-stat-title">
            <span aria-hidden="true">🐋</span>
            <span>Whale Net Flow (≥ 1 ₿)</span>
          </div>
          <strong
            className={`fp-stat-value ${
              sizeFlow.whale.tradeCount === 0
                ? ''
                : sizeFlow.whale.deltaBtc > 0
                  ? 'up'
                  : sizeFlow.whale.deltaBtc < 0
                    ? 'down'
                    : ''
            }`}
          >
            {sizeFlow.whale.tradeCount > 0 ? `${formatSignedBtc(sizeFlow.whale.deltaBtc)} ₿` : '—'}
          </strong>
          <div className="fp-stat-foot">
            <span>
              {sizeFlow.whale.tradeCount} whale {sizeFlow.whale.tradeCount === 1 ? 'trade' : 'trades'} ·{' '}
              {sizeFlow.whale.volumeSharePct}% of volume
            </span>
            <small>Orders ≥ 1.00 BTC</small>
          </div>
        </article>

        <article className="fp-stat-card">
          <div className="fp-stat-title">
            <span aria-hidden="true">🐟</span>
            <span>Small Order Flow (&lt; 0.1 ₿)</span>
          </div>
          <strong
            className={`fp-stat-value ${
              sizeFlow.retail.tradeCount === 0
                ? ''
                : sizeFlow.retail.deltaBtc > 0
                  ? 'up'
                  : sizeFlow.retail.deltaBtc < 0
                    ? 'down'
                    : ''
            }`}
          >
            {sizeFlow.retail.tradeCount > 0 ? `${formatSignedBtc(sizeFlow.retail.deltaBtc)} ₿` : '—'}
          </strong>
          <div className="fp-stat-foot">
            <span>
              {sizeFlow.retail.tradeCount} small {sizeFlow.retail.tradeCount === 1 ? 'trade' : 'trades'} ·{' '}
              {sizeFlow.retail.volumeSharePct}% of volume
            </span>
            <small>Orders under 0.10 BTC</small>
          </div>
        </article>

        <article className="fp-stat-card">
          <div className="fp-stat-title">
            <span aria-hidden="true">💥</span>
            <span>Biggest Single Print</span>
          </div>
          <strong
            className={`fp-stat-value ${
              sizeFlow.largestTrade ? (sizeFlow.largestTrade.side === 'buy' ? 'up' : 'down') : ''
            }`}
          >
            {sizeFlow.largestTrade
              ? `${sizeFlow.largestTrade.side === 'buy' ? 'BUY' : 'SELL'} ${sizeFlow.largestTrade.btc.toFixed(2)} ₿`
              : '—'}
          </strong>
          <div className="fp-stat-foot">
            <span>
              {sizeFlow.largestTrade
                ? `At ${formatPriceDollar(sizeFlow.largestTrade.price)} ($${Math.round(sizeFlow.largestTrade.notionalUsd).toLocaleString('en-US')})`
                : 'Waiting for trades'}
            </span>
            <small>Largest execution in scope</small>
          </div>
        </article>
      </div>

      <div className="fp-tier-list" role="region" aria-label="Order size tiers">
        {sizeFlow.tiers.map(tier => {
          const deltaTone =
            tier.tradeCount === 0
              ? 'flat'
              : tier.deltaBtc > 0
                ? 'up'
                : tier.deltaBtc < 0
                  ? 'down'
                  : 'flat'
          return (
            <div key={tier.id} className="fp-tier-row">
              <div className="fp-tier-head">
                <div className="fp-tier-title">
                  <span>
                    <span aria-hidden="true">{tier.icon}</span> <strong>{tier.label}</strong>
                  </span>
                  <small>
                    {tier.tradeCount} {tier.tradeCount === 1 ? 'trade' : 'trades'} ({tier.volumeSharePct}% vol)
                  </small>
                </div>
                <div className="fp-tier-nums">
                  <strong className={`fp-tier-delta ${deltaTone}`}>
                    {tier.tradeCount > 0 ? `${formatSignedBtc(tier.deltaBtc)} ₿` : '—'}
                  </strong>
                  <small>
                    Sell {tier.sellBtc.toFixed(2)} ₿ · Buy {tier.buyBtc.toFixed(2)} ₿
                  </small>
                </div>
              </div>
              <div className="fp-tier-bar" aria-hidden="true">
                <span className="fp-tier-sell" style={{ width: `${tier.sellSharePct}%` }} />
                <span className="fp-tier-buy" style={{ width: `${tier.buySharePct}%` }} />
              </div>
            </div>
          )
        })}
      </div>

      <div className="fp-takeaway">
        <p className="fp-oneliner">{sizeFlow.oneLiner}</p>
        <div className="fp-legend" aria-label="Order size legend">
          <span className="fp-legend-chip">🐋 Whales = ≥ 1 ₿</span>
          <span className="fp-legend-chip">🦈 Mid = 0.1–0.99 ₿</span>
          <span className="fp-legend-chip">🐟 Small = &lt; 0.1 ₿</span>
        </div>
      </div>
    </section>
      </div>

      <div
        role="tabpanel"
        id="fp-panel-svp"
        aria-labelledby="fp-tab-svp"
        className="folder-panel"
        hidden={activeFolder !== 'svp'}
      >
        <section className={`fp-card tone-${sessionProfile.badge.tone}`} aria-label="Session volume profile">
          <div className="fp-header">
            <div className="fp-title-block">
              <div className="fp-eyebrow-row">
                <span className="eyebrow">
                  SECTION 3 · SESSION VOLUME PROFILE ({sessionProfile.rangeLabel.toUpperCase()})
                </span>
                <span className={`fp-verdict-badge tone-${sessionProfile.badge.tone}`}>
                  {sessionProfile.badge.label}
                </span>
                <span className="fp-meta-chip">
                  {sessionProfile.rangeLabel} · {sessionProfile.sourceLabel} · ${sessionProfile.stepUsd} steps
                </span>
              </div>
              <h2 className="fp-headline">{sessionProfile.headline}</h2>
            </div>

            <div
              ref={svpToolbarRef}
              role="toolbar"
              aria-label="Session profile controls"
              aria-controls="fp-svp-ladder"
              className="fp-svp-toolbar"
              onKeyDown={handleSvpToolbarKeyDown}
              {...({ focusgroup: 'toolbar wrap' } as Record<string, string>)}
            >
              <div className="fp-range-picker" role="group" aria-label="Select profile range">
                {SVP_RANGE_OPTIONS.map((opt, idx) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`fp-step-btn ${svpRange === opt.id ? 'active' : ''}`}
                    aria-pressed={svpRange === opt.id}
                    title={opt.description}
                    tabIndex={supportsFocusGroup ? undefined : svpToolbarFocusIdx === idx ? 0 : -1}
                    onFocus={() => {
                      if (!supportsFocusGroup) setSvpToolbarFocusIdx(idx)
                    }}
                    onClick={() => setSvpRange(opt.id)}
                  >
                    {opt.shortLabel}
                  </button>
                ))}
              </div>
              <span role="separator" aria-orientation="vertical" className="fp-toolbar-sep" />
              <div className="fp-step-picker" role="group" aria-label="Select footprint price step">
                {FOOTPRINT_STEP_OPTIONS.map((opt, idx) => {
                  const toolbarIdx = SVP_RANGE_OPTIONS.length + idx
                  return (
                    <button
                      key={String(opt.value)}
                      type="button"
                      className={`fp-step-btn ${stepOption === opt.value ? 'active' : ''}`}
                      aria-pressed={stepOption === opt.value}
                      tabIndex={supportsFocusGroup ? undefined : svpToolbarFocusIdx === toolbarIdx ? 0 : -1}
                      onFocus={() => {
                        if (!supportsFocusGroup) setSvpToolbarFocusIdx(toolbarIdx)
                      }}
                      onClick={() => setStepOption(opt.value)}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="fp-scoreboard">
            <article className="fp-stat-card">
              <div className="fp-stat-title">
                <span aria-hidden="true">👑</span>
                <span>Session POC</span>
              </div>
              <strong className="fp-stat-value">{formatPriceUsdt(sessionProfile.sessionPocPrice)}</strong>
              <div className="fp-stat-foot">
                <span>
                  {sessionProfile.tradeCount > 0
                    ? `${formatBtcAmount(sessionProfile.sessionPocVolumeBtc)} ₿ at POC · ${formatBtcAmount(sessionProfile.totalBtc)} ₿ total`
                    : 'No trades yet'}
                </span>
                <small>{sessionProfile.rangeLabel} fairest price</small>
              </div>
            </article>

            <article className="fp-stat-card">
              <div className="fp-stat-title">
                <span aria-hidden="true">🎯</span>
                <span>Session Value Area (70%)</span>
              </div>
              <strong className="fp-stat-value">
                {sessionProfile.sessionValPrice !== null && sessionProfile.sessionVahPrice !== null
                  ? sessionProfile.sessionValPrice === sessionProfile.sessionVahPrice
                    ? formatPriceDollar(sessionProfile.sessionValPrice)
                    : `${formatPriceDollar(sessionProfile.sessionValPrice)} – ${formatPriceDollar(sessionProfile.sessionVahPrice)}`
                  : '—'}
              </strong>
              <div className="fp-stat-foot">
                <span>
                  {sessionProfile.valueStatus === 'above'
                    ? 'Above Value Area'
                    : sessionProfile.valueStatus === 'below'
                      ? 'Below Value Area'
                      : sessionProfile.valueStatus === 'inside'
                        ? 'Inside Value Area'
                        : 'Waiting for trades'}
                </span>
                <small>Where 70% of {sessionProfile.rangeLabel} traded</small>
              </div>
            </article>

            <article className="fp-stat-card">
              <div className="fp-stat-title">
                <span aria-hidden="true">🧲</span>
                <span>Naked POC Magnets</span>
              </div>
              <strong className={`fp-stat-value ${sessionProfile.nakedPocs.length > 0 ? 'amber' : ''}`}>
                {sessionProfile.nakedPocs.length === 1
                  ? `1 untested (${formatPriceDollar(sessionProfile.nakedPocs[0].price)})`
                  : sessionProfile.nakedPocs.length > 1
                    ? `${sessionProfile.nakedPocs.length} untested · nearest ${formatPriceDollar(sessionProfile.nakedPocs[0].price)}`
                    : sessionProfile.tradeCount > 0
                      ? 'All tested · Clean'
                      : '—'}
              </strong>
              <div className="fp-stat-foot">
                <span>
                  {sessionProfile.nakedPocs.length > 0
                    ? `${sessionProfile.nakedPocs[0].originLabel} · ${formatSignedUsd(sessionProfile.nakedPocs[0].distanceUsd)}${
                        sessionProfile.nakedPocs[0].distancePct !== null
                          ? ` (${sessionProfile.nakedPocs[0].distancePct >= 0 ? '+' : ''}${sessionProfile.nakedPocs[0].distancePct.toFixed(1)}%)`
                          : ''
                      }`
                    : sessionProfile.nakedPocMode === 'daily'
                      ? 'All prior daily POCs visited'
                      : 'No unvisited prior POCs'}
                </span>
                <small>
                  {sessionProfile.nakedPocs.length > 0
                    ? offLadderNpocCount === 0
                      ? `${sessionProfile.nakedPocMode === 'daily' ? 'Daily session nPOCs' : 'Prior bar nPOCs'} · all on ladder`
                      : `${onLadderNpocCount} on ${sessionProfile.rangeLabel} ladder · ${offLadderNpocCount} outside range`
                    : sessionProfile.nakedPocMode === 'daily'
                      ? 'Untested prior daily POCs (12d)'
                      : 'Unvisited prior candle POCs'}
                </small>
              </div>
            </article>
          </div>

          {sessionProfile.prevDayLevels && (
            <section className="fp-prevday-strip" aria-label="Previous day value area reference">
              <div className="fp-prevday-head">
                <div className="fp-prevday-title-row">
                  <span className="eyebrow">
                    YESTERDAY&apos;S VALUE AREA · {sessionProfile.prevDayLevels.dateLabel}
                  </span>
                  <span
                    className={`fp-verdict-badge tone-${
                      sessionProfile.prevDayLevels.pricePosition === 'above-pvah'
                        ? 'teal'
                        : sessionProfile.prevDayLevels.pricePosition === 'below-pval'
                          ? 'rose'
                          : 'blue'
                    }`}
                  >
                    {sessionProfile.prevDayLevels.pricePosition === 'above-pvah'
                      ? 'Above pVAH'
                      : sessionProfile.prevDayLevels.pricePosition === 'below-pval'
                        ? 'Below pVAL'
                        : sessionProfile.prevDayLevels.pricePosition === 'inside-pva'
                          ? 'Inside Prev VA'
                          : 'Prior Session'}
                  </span>
                </div>
                {svpRange !== 'prevDay' && (
                  <button
                    type="button"
                    className="fp-prevday-jump"
                    onClick={() => setSvpRange('prevDay')}
                  >
                    Inspect Prev Day →
                  </button>
                )}
              </div>

              <div className="fp-prevday-levels">
                <div className="fp-prevday-level">
                  <small>pVAL (Prev Low)</small>
                  <strong>{formatPriceDollar(sessionProfile.prevDayLevels.valPrice)}</strong>
                </div>
                <div className="fp-prevday-level is-poc">
                  <small>pPOC (Prev Fair Value)</small>
                  <strong>{formatPriceDollar(sessionProfile.prevDayLevels.pocPrice)}</strong>
                </div>
                <div className="fp-prevday-level">
                  <small>pVAH (Prev High)</small>
                  <strong>{formatPriceDollar(sessionProfile.prevDayLevels.vahPrice)}</strong>
                </div>
              </div>

              <p className="fp-prevday-note">{sessionProfile.prevDayLevels.contextNote}</p>
            </section>
          )}

          {sessionProfile.nakedPocs.length > 0 && (
            <section className="fp-npoc-strip" aria-label="Untested Naked POC magnets">
              <div className="fp-npoc-head">
                <div className="fp-prevday-title-row">
                  <span className="eyebrow">
                    UNTESTED NAKED POC MAGNETS ·{' '}
                    {sessionProfile.nakedPocMode === 'daily'
                      ? 'PRIOR DAILY SESSIONS'
                      : `${timeframeShort.toUpperCase()} BARS`}
                  </span>
                  <span className="fp-verdict-badge tone-amber">
                    {sessionProfile.nakedPocs.length} active
                  </span>
                </div>
                {offLadderNpocCount > 0 &&
                  sessionProfile.nakedPocMode === 'daily' &&
                  svpRange !== '7d' && (
                    <button
                      type="button"
                      className="fp-prevday-jump"
                      onClick={() => setSvpRange('7d')}
                    >
                      Widen to 7D →
                    </button>
                  )}
              </div>

              <div className="fp-npoc-list">
                {sessionProfile.nakedPocs.slice(0, 6).map(magnet => {
                  const dirClass =
                    magnet.directionFromClose === 'above'
                      ? 'above'
                      : magnet.directionFromClose === 'below'
                        ? 'below'
                        : ''
                  const arrow =
                    magnet.directionFromClose === 'above'
                      ? '▲'
                      : magnet.directionFromClose === 'below'
                        ? '▼'
                        : '•'
                  const pctText =
                    magnet.distancePct !== null
                      ? ` (${magnet.distancePct >= 0 ? '+' : ''}${magnet.distancePct.toFixed(1)}%)`
                      : ''
                  return (
                    <div
                      key={`${magnet.kind}-${magnet.candleStart}-${magnet.price}`}
                      className="fp-npoc-item"
                    >
                      <div className="fp-npoc-price-row">
                        <strong>{formatPriceDollar(magnet.price)}</strong>
                        <span className={`fp-npoc-status ${magnet.onLadder ? 'is-on' : 'is-off'}`}>
                          {magnet.onLadder
                            ? 'On ladder'
                            : magnet.directionFromClose === 'above'
                              ? 'Above range'
                              : 'Below range'}
                        </span>
                      </div>
                      <div className="fp-npoc-meta">
                        <span>{magnet.originLabel}</span>
                        <span className={`fp-npoc-dist ${dirClass}`}>
                          {arrow} {formatSignedUsd(magnet.distanceUsd)}
                          {pctText}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
              {sessionProfile.nakedPocs.length > 6 && (
                <span className="fp-meta-chip">
                  +{sessionProfile.nakedPocs.length - 6} older untested daily nPOCs
                </span>
              )}
            </section>
          )}

          <div id="fp-svp-ladder">
            {sessionProfile.rows.length === 0 ? (
              <div className="fp-empty">
                <strong>Waiting for OKX data to build your {sessionProfile.rangeLabel} Session Profile</strong>
                <p>
                  Candles and live trades across the {sessionProfile.rangeLabel} window will stack at each price level
                  to reveal Value Area boundaries (VAH/VAL) and key support/resistance zones.
                </p>
              </div>
            ) : (
              <div className="fp-svp-list" role="region" aria-label="Session volume profile ladder" tabIndex={0}>
                {sessionProfile.rows.map(row => {
                  const deltaTone =
                    row.totalBtc === 0 ? 'flat' : row.deltaBtc > 0 ? 'up' : row.deltaBtc < 0 ? 'down' : 'flat'
                  return (
                    <div
                      key={row.price}
                      className={`fp-svp-row ${row.isSessionPoc ? 'is-poc' : ''} ${row.inValueArea ? 'in-va' : ''} ${row.isNakedPoc ? 'is-npoc' : ''}`}
                    >
                      <div className="fp-svp-price">
                        <span className="fp-price-num">{formatPriceDollar(row.price)}</span>
                        <span className="fp-price-tags">
                          {row.isSessionPoc && <span className="fp-tag poc">👑 POC</span>}
                          {row.isVah && <span className="fp-tag va">VAH</span>}
                          {row.isVal && !row.isVah && <span className="fp-tag va">VAL</span>}
                          {row.isPrevDayVah && (
                            <span className="fp-tag prev-va" title="Previous Day Value Area High">
                              pVAH
                            </span>
                          )}
                          {row.isPrevDayPoc && (
                            <span className="fp-tag prev-poc" title="Previous Day Point of Control">
                              pPOC
                            </span>
                          )}
                          {row.isPrevDayVal && !row.isPrevDayVah && (
                            <span className="fp-tag prev-va" title="Previous Day Value Area Low">
                              pVAL
                            </span>
                          )}
                          {row.isNakedPoc && (
                            <span className="fp-tag npoc" title={row.nakedPocLabels.join(' · ')}>
                              {row.nakedPocCount > 1 ? `🧲 ${row.nakedPocCount} nPOCs` : '🧲 nPOC'}
                            </span>
                          )}
                          {row.isLatestRow && <span className="fp-tag close">NOW</span>}
                        </span>
                      </div>

                      <div className="fp-svp-bar-wrap" aria-hidden="true">
                        <div className="fp-svp-bar" style={{ width: `${row.totalWidthPct}%` }}>
                          <span className="fp-svp-sell" style={{ width: `${row.sellSharePct}%` }} />
                          <span className="fp-svp-buy" style={{ width: `${row.buySharePct}%` }} />
                        </div>
                      </div>

                      <div className="fp-svp-stats">
                        <strong>{row.totalBtc > 0 ? `${formatBtcAmount(row.totalBtc)} ₿` : '·'}</strong>
                        <small className={deltaTone}>
                          {row.totalBtc > 0 ? `${formatSignedBtc(row.deltaBtc)} ₿` : '—'}
                        </small>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="fp-takeaway">
            <p className="fp-oneliner">{sessionProfile.oneLiner}</p>
            <div className="fp-legend" aria-label="Session profile legend">
              <span className="fp-legend-chip">👑 POC = {sessionProfile.rangeLabel} peak volume</span>
              <span className="fp-legend-chip">VAH/VAL = 70% value bounds</span>
              <span className="fp-legend-chip">pVA = Yesterday&apos;s levels</span>
              <span className="fp-legend-chip">
                🧲 nPOC = {sessionProfile.nakedPocMode === 'daily' ? 'Untested daily POC' : 'Untested bar POC'}
              </span>
            </div>
          </div>
        </section>
      </div>

      <div
        role="tabpanel"
        id="fp-panel-fpbs"
        aria-labelledby="fp-tab-fpbs"
        className="folder-panel"
        hidden={activeFolder !== 'fpbs'}
      >
        <section className={`fp-card tone-${fpbs.badge.tone}`} aria-label="Footprint bar statistics">
          <div className="fp-header">
            <div className="fp-title-block">
              <div className="fp-eyebrow-row">
                <span className="eyebrow">SECTION 4 · 6-BAR STATS STRIP (EXOCHART FPBS)</span>
                <span className={`fp-verdict-badge tone-${fpbs.badge.tone}`}>{fpbs.badge.label}</span>
                <span className="fp-meta-chip">
                  6 × {timeframeShort} bars · {fpbs.totalTradeCount}{' '}
                  {fpbs.totalTradeCount === 1 ? 'trade' : 'trades'}
                </span>
              </div>
              <h2 className="fp-headline">{fpbs.headline}</h2>
            </div>

            <button type="button" className="fp-export-btn" onClick={handleExportCsv}>
              Export CSV ↓
            </button>
          </div>

          <div className="fp-scoreboard">
            <article className="fp-stat-card">
              <div className="fp-stat-title">
                <span aria-hidden="true">📈</span>
                <span>6-Bar Running CVD</span>
              </div>
              <strong
                className={`fp-stat-value ${
                  fpbs.totalTradeCount === 0
                    ? ''
                    : fpbs.windowCvdBtc > 0
                      ? 'up'
                      : fpbs.windowCvdBtc < 0
                        ? 'down'
                        : ''
                }`}
              >
                {fpbs.totalTradeCount > 0 ? `${formatSignedBtc(fpbs.windowCvdBtc)} ₿` : '—'}
              </strong>
              <div className="fp-stat-foot">
                <span>
                  {fpbs.windowVolumeBtc.toFixed(2)} ₿ window vol ({fpbs.windowDeltaPct >= 0 ? '+' : ''}
                  {Math.round(fpbs.windowDeltaPct)}%)
                </span>
                <small>Cumulative net delta</small>
              </div>
            </article>

            <article className="fp-stat-card">
              <div className="fp-stat-title">
                <span aria-hidden="true">🪤</span>
                <span>Intrabar Traps &amp; Walls</span>
              </div>
              <strong className={`fp-stat-value ${fpbs.trapOrWallCount > 0 ? 'amber' : ''}`}>
                {fpbs.totalTradeCount === 0
                  ? '—'
                  : fpbs.trapOrWallCount > 0
                    ? `${fpbs.trapOrWallCount} ${fpbs.trapOrWallCount === 1 ? 'bar flagged' : 'bars flagged'}`
                    : 'Clean flow · 0 traps'}
              </strong>
              <div className="fp-stat-foot">
                <span>
                  {fpbs.latestTrapOrWall
                    ? `${fpbs.latestTrapOrWall.isDeveloping ? 'Now' : formatTimeUtc(fpbs.latestTrapOrWall.start)}: ${fpbs.latestTrapOrWall.signalLabel}`
                    : 'Delta & price moving in sync'}
                </span>
                <small>Delta flips &amp; passive walls</small>
              </div>
            </article>

            <article className="fp-stat-card">
              <div className="fp-stat-title">
                <span aria-hidden="true">🔥</span>
                <span>Peak Conviction Bar</span>
              </div>
              <strong
                className={`fp-stat-value ${
                  fpbs.peakConvictionCol
                    ? fpbs.peakConvictionCol.deltaBtc > 0
                      ? 'up'
                      : fpbs.peakConvictionCol.deltaBtc < 0
                        ? 'down'
                        : ''
                    : ''
                }`}
              >
                {fpbs.peakConvictionCol
                  ? `${formatSignedBtc(fpbs.peakConvictionCol.deltaBtc)} ₿ (${fpbs.peakConvictionCol.deltaPct >= 0 ? '+' : ''}${Math.round(fpbs.peakConvictionCol.deltaPct)}%)`
                  : '—'}
              </strong>
              <div className="fp-stat-foot">
                <span>
                  {fpbs.peakConvictionCol
                    ? `${fpbs.peakConvictionCol.isDeveloping ? 'Now · Live' : `${formatTimeUtc(fpbs.peakConvictionCol.start)} UTC`} · ${fpbs.peakConvictionCol.volumeBtc.toFixed(2)} ₿ vol`
                    : 'Waiting for trades'}
                </span>
                <small>Strongest single-bar push</small>
              </div>
            </article>
          </div>

          <div className="fp-fpbs-wrap" role="region" aria-label="FPBS stats matrix" tabIndex={0}>
            <table className="fp-fpbs-table">
              <thead>
                <tr>
                  <th scope="col" className="fp-fpbs-metric-col">
                    METRIC
                  </th>
                  {fpbs.columns.map(col => (
                    <th
                      key={col.start}
                      scope="col"
                      className={col.isDeveloping ? 'is-live' : ''}
                    >
                      {col.isDeveloping ? 'Now · Live' : formatTimeUtc(col.start)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Volume</th>
                  {fpbs.columns.map(col => (
                    <td key={col.start} className="fp-fpbs-cell">
                      <span
                        className="fp-fpbs-heat neutral"
                        style={{ width: `${col.volumeIntensityPct}%` }}
                        aria-hidden="true"
                      />
                      <span className="fp-fpbs-val">
                        {col.tradeCount > 0 ? `${col.volumeBtc.toFixed(2)} ₿` : '—'}
                      </span>
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Delta</th>
                  {fpbs.columns.map(col => {
                    const tone =
                      col.tradeCount === 0
                        ? ''
                        : col.deltaBtc > 0
                          ? 'up'
                          : col.deltaBtc < 0
                            ? 'down'
                            : ''
                    return (
                      <td key={col.start} className="fp-fpbs-cell">
                        <span
                          className={`fp-fpbs-heat ${tone}`}
                          style={{ width: `${col.deltaIntensityPct}%` }}
                          aria-hidden="true"
                        />
                        <span className={`fp-fpbs-val ${tone}`}>
                          {col.tradeCount > 0 ? `${formatSignedBtc(col.deltaBtc)} ₿` : '—'}
                        </span>
                      </td>
                    )
                  })}
                </tr>
                <tr>
                  <th scope="row">Delta %</th>
                  {fpbs.columns.map(col => {
                    const tone =
                      col.tradeCount === 0
                        ? ''
                        : col.deltaPct > 0
                          ? 'up'
                          : col.deltaPct < 0
                            ? 'down'
                            : ''
                    return (
                      <td key={col.start} className="fp-fpbs-cell">
                        <span className={`fp-fpbs-val ${tone}`}>
                          {col.tradeCount > 0
                            ? `${col.deltaPct >= 0 ? '+' : ''}${Math.round(col.deltaPct)}%`
                            : '—'}
                        </span>
                      </td>
                    )
                  })}
                </tr>
                <tr>
                  <th scope="row">Max Δ (Peak)</th>
                  {fpbs.columns.map(col => (
                    <td key={col.start} className="fp-fpbs-cell">
                      <span className={`fp-fpbs-val ${col.tradeCount > 0 && col.maxDeltaBtc > 0 ? 'up' : ''}`}>
                        {col.tradeCount > 0 ? `+${col.maxDeltaBtc.toFixed(2)} ₿` : '—'}
                      </span>
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Min Δ (Low)</th>
                  {fpbs.columns.map(col => (
                    <td key={col.start} className="fp-fpbs-cell">
                      <span className={`fp-fpbs-val ${col.tradeCount > 0 && col.minDeltaBtc < 0 ? 'down' : ''}`}>
                        {col.tradeCount > 0 ? `${formatSignedBtc(col.minDeltaBtc)} ₿` : '—'}
                      </span>
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Running CVD</th>
                  {fpbs.columns.map(col => {
                    const hasCvd = !(col.tradeCount === 0 && col.cvdBtc === 0)
                    const tone = !hasCvd ? '' : col.cvdBtc > 0 ? 'up' : col.cvdBtc < 0 ? 'down' : ''
                    return (
                      <td key={col.start} className="fp-fpbs-cell">
                        <span className={`fp-fpbs-val ${tone}`}>
                          {hasCvd ? `${formatSignedBtc(col.cvdBtc)} ₿` : '—'}
                        </span>
                      </td>
                    )
                  })}
                </tr>
                <tr>
                  <th scope="row">POC &amp; Signal</th>
                  {fpbs.columns.map(col => (
                    <td key={col.start} className="fp-fpbs-cell">
                      <div className="fp-fpbs-sig-cell">
                        <span className="fp-fpbs-poc">{formatPriceDollar(col.pocPrice)}</span>
                        <span className={`fp-fpbs-sig tone-${col.signalTone}`}>{col.signalLabel}</span>
                      </div>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          <div className="fp-takeaway">
            <p className="fp-oneliner">{fpbs.oneLiner}</p>
            <div className="fp-legend" aria-label="FPBS stats legend">
              <span className="fp-legend-chip">Delta % = Net conviction</span>
              <span className="fp-legend-chip">Max/Min Δ = Intrabar extremes</span>
              <span className="fp-legend-chip">🪤/🧱 = Flip or absorption</span>
            </div>
          </div>
        </section>
      </div>
    </FolderShell>
  )
}
