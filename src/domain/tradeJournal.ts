import type { TimeframeId } from '../data/okx'
import type { MarketStoryEvaluation } from './marketStory'
import type { ConfirmationMode, ConfirmationView } from './signalConfirmation'
import type { CheckStatus, MarketSnapshot, TradeCheckResult, TradeSide } from './tradeCheck'
import type { OiRegimeEvaluation, PulseEvaluation } from './tradeEngine'
import type { Metric } from '../fixtures/demo'

export type TradeOutcome = 'open' | 'win' | 'loss' | 'breakeven'

export type SnapshotCardSummary = {
  id: Metric['id']
  label: string
  value: string
  description: string
  plainSummary: string | null
}

export type SnapshotBucketSummary = {
  index: number
  startIso: string
  endIso: string
  isDeveloping: boolean
  priceOpen: number | null
  priceClose: number | null
  priceHigh: number | null
  priceLow: number | null
  deltaBtc: number | null
  cvdBtc: number | null
  volumeBtc: number | null
  oiState: string
  oiChangeBtc: number | null
  oiEndBtc: number | null
  longLiqUsd: number
  shortLiqUsd: number
  phaseId: string
  phaseLabel: string
  divergence: string | null
  absorption: string | null
  structureBreak: string | null
  liquiditySweep: string | null
}

export type PageDataSnapshot = {
  schemaVersion: 1
  capturedAtMs: number
  capturedAtIso: string
  exchange: 'OKX'
  instrument: 'BTC-USDT-SWAP'
  connectionStatus: string
  coverageComplete: boolean
  timeframe: TimeframeId
  timeframeLabel: string
  confirmationMode: ConfirmationMode
  confirmationStatus: string
  confirmationProgress: string
  confirmationDetail: string
  confirmationReason: string
  market: {
    price: number | null
    priceFormatted: string | null
    vwap6h: number | null
    atr15mPct: number | null
    trend6hPct: number | null
    fundingRate: number | null
    longShortRatio: number | null
    longShortRatio1hAvg: number | null
    confirmedWindowPriceStart: number | null
    confirmedWindowPriceEnd: number | null
    confirmedWindowDeltaBtc: number | null
    confirmedWindowCvdBtc: number | null
    confirmedWindowVolumeBtc: number | null
    latestBucketDeltaBtc: number | null
    latestBucketCvdBtc: number | null
    latestBucketVolumeBtc: number | null
    latestBucketOiEndBtc: number | null
    latestBucketOiChangeBtc: number | null
    oiStale: boolean
    recentLongLiq15mUsd: number
    recentShortLiq15mUsd: number
  }
  cards: SnapshotCardSummary[]
  pulse: {
    ruleId: string
    observation: string
    headline: string
    copy: string
    evidence: string
  }
  oiRegime: {
    regimeId: string | null
    marketTitle: string | null
    sentiment: 'Bullish' | 'Bearish' | null
    plainEnglish: string | null
  }
  story: {
    headline: string
    subheadline: string
    tone: string
    windowHigh: number | null
    windowLow: number | null
    smartRsi: {
      value: number
      priceRsi: number
      volumeRsi: number | null
      zone: string
      label: string
      flowConfirmed: boolean
      summary: string
    } | null
    structure: {
      bias: string
      shortLabel: string
      lastEvent: string | null
      lastEventLevel: number | null
      recentSweep: string | null
      recentSweepLevel: number | null
      orderBlock: string | null
      summary: string
    }
    windowDivergence: {
      kind: string
      label: string
      headline: string
      evidence: string
    } | null
    chapters: Array<{
      phaseId: string
      label: string
      count: number
      isDeveloping: boolean
    }>
    buckets: SnapshotBucketSummary[]
  }
  events: Array<{
    id: string
    kind: string
    tag: string
    title: string
    value: string
    timeIso: string
  }>
  myTrade: {
    side: TradeSide | null
    entryInput: string
    stopInput: string
    leverageInput: string
    mode: 'planning' | 'position' | null
    referencePrice: number | null
    summary: {
      good: number
      against: number
      caution: number
      headline: string
    } | null
    checks: Array<{
      id: string
      title: string
      status: CheckStatus
      headline: string
      evidence: string
    }>
  }
}

export type JournalEntry = {
  id: string
  createdAtMs: number
  createdAtIso: string
  outcome: TradeOutcome
  exitPrice: string
  notes: string
  snapshot: PageDataSnapshot
}

export type JournalPnlEvaluation = {
  entryPriceUsed: number | null
  exitPriceNum: number | null
  leverageNum: number | null
  priceMovePct: number | null
  leveragedPnlPct: number | null
}

function parseCleanPositive(raw: string): number | null {
  const cleaned = raw.replace(/[,\s$x×]/gi, '')
  if (!cleaned) return null
  const num = Number(cleaned)
  return Number.isFinite(num) && num > 0 ? num : null
}

/** Computes directional % price move and optional leveraged return % for a journal entry. */
export function computeJournalPnl(entry: JournalEntry): JournalPnlEvaluation {
  const { myTrade, market } = entry.snapshot
  const entryFromInput = parseCleanPositive(myTrade.entryInput)
  const entryPriceUsed = entryFromInput ?? myTrade.referencePrice ?? market.price
  const exitPriceNum = parseCleanPositive(entry.exitPrice)
  const leverageNum = parseCleanPositive(myTrade.leverageInput)

  if (!myTrade.side || entryPriceUsed === null || entryPriceUsed <= 0 || exitPriceNum === null) {
    return {
      entryPriceUsed,
      exitPriceNum,
      leverageNum,
      priceMovePct: null,
      leveragedPnlPct: null,
    }
  }

  const direction = myTrade.side === 'long' ? 1 : -1
  const rawMovePct = ((exitPriceNum - entryPriceUsed) / entryPriceUsed) * 100 * direction
  const priceMovePct = Number(rawMovePct.toFixed(2))
  const leveragedPnlPct = leverageNum !== null ? Number((rawMovePct * leverageNum).toFixed(2)) : null

  return {
    entryPriceUsed,
    exitPriceNum,
    leverageNum,
    priceMovePct,
    leveragedPnlPct,
  }
}

export type BuildPageSnapshotParams = {
  now?: number
  status: string
  priceFormatted: string | null
  timeframe: TimeframeId
  timeframeLabel: string
  gap: boolean
  oiStale: boolean
  confirmationMode: ConfirmationMode
  confirmationStatus: string
  confirmationProgress: string
  confirmationDetail: string
  confirmationReason: string
  metrics: readonly Metric[]
  pulse: PulseEvaluation
  oiRegime: OiRegimeEvaluation
  story: MarketStoryEvaluation
  snapshot: MarketSnapshot
  confirmation: ConfirmationView
  events: ReadonlyArray<{
    id: string
    kind: string
    tag: string
    title: string
    value: string
    time: number
  }>
  draft: {
    side: TradeSide | null
    entry: string
    stop: string
    leverage: string
  }
  tradeResult: TradeCheckResult | null
}

export function buildPageDataSnapshot(params: BuildPageSnapshotParams): PageDataSnapshot {
  const capturedAtMs = params.now ?? Date.now()
  const capturedAtIso = new Date(capturedAtMs).toISOString()
  const latestBucket =
    params.story.buckets.length > 0 ? params.story.buckets[params.story.buckets.length - 1] : null

  return {
    schemaVersion: 1,
    capturedAtMs,
    capturedAtIso,
    exchange: 'OKX',
    instrument: 'BTC-USDT-SWAP',
    connectionStatus: params.status,
    coverageComplete: !params.gap,
    timeframe: params.timeframe,
    timeframeLabel: params.timeframeLabel,
    confirmationMode: params.confirmationMode,
    confirmationStatus: params.confirmationStatus,
    confirmationProgress: params.confirmationProgress,
    confirmationDetail: params.confirmationDetail,
    confirmationReason: params.confirmationReason,
    market: {
      price: params.snapshot.price,
      priceFormatted: params.priceFormatted,
      vwap6h: params.snapshot.vwap,
      atr15mPct: params.snapshot.atrPct,
      trend6hPct: params.snapshot.trendPct,
      fundingRate: params.snapshot.fundingRate,
      longShortRatio: params.snapshot.lsRatio,
      longShortRatio1hAvg: params.snapshot.lsRatioAvg,
      confirmedWindowPriceStart: params.confirmation.snapshot.priceStart,
      confirmedWindowPriceEnd: params.confirmation.snapshot.priceEnd,
      confirmedWindowDeltaBtc: params.confirmation.snapshot.deltaBtc,
      confirmedWindowCvdBtc: params.confirmation.snapshot.cvdBtc,
      confirmedWindowVolumeBtc: params.confirmation.snapshot.volumeBtc,
      latestBucketDeltaBtc: latestBucket?.deltaBtc ?? null,
      latestBucketCvdBtc: latestBucket?.cvdBtc ?? null,
      latestBucketVolumeBtc: latestBucket?.volumeBtc ?? null,
      latestBucketOiEndBtc: latestBucket?.oiEndBtc ?? null,
      latestBucketOiChangeBtc: latestBucket?.oiChangeBtc ?? null,
      oiStale: params.oiStale,
      recentLongLiq15mUsd: params.snapshot.recentLongLiqUsd,
      recentShortLiq15mUsd: params.snapshot.recentShortLiqUsd,
    },
    cards: params.metrics.map(m => ({
      id: m.id,
      label: m.label,
      value: m.value,
      description: m.description,
      plainSummary: m.plainSummary ?? null,
    })),
    pulse: {
      ruleId: params.pulse.ruleId,
      observation: params.pulse.observation,
      headline: params.pulse.headline,
      copy: params.pulse.copy,
      evidence: params.pulse.evidence,
    },
    oiRegime: {
      regimeId: params.oiRegime.activeRowId,
      marketTitle: params.oiRegime.activeRow?.marketTitle ?? null,
      sentiment: params.oiRegime.activeRow?.sentiment ?? null,
      plainEnglish: params.oiRegime.activeRow?.plainEnglish ?? null,
    },
    story: {
      headline: params.story.headline,
      subheadline: params.story.subheadline,
      tone: params.story.tone,
      windowHigh: params.story.priceMax,
      windowLow: params.story.priceMin,
      smartRsi: params.story.smartRsi
        ? {
            value: params.story.smartRsi.value,
            priceRsi: params.story.smartRsi.priceRsi,
            volumeRsi: params.story.smartRsi.volumeRsi,
            zone: params.story.smartRsi.zone,
            label: params.story.smartRsi.label,
            flowConfirmed: params.story.smartRsi.flowConfirmed,
            summary: params.story.smartRsi.summary,
          }
        : null,
      structure: {
        bias: params.story.structure.bias,
        shortLabel: params.story.structure.shortLabel,
        lastEvent: params.story.structure.lastEvent,
        lastEventLevel: params.story.structure.lastEventLevel,
        recentSweep: params.story.structure.recentSweep?.kind ?? null,
        recentSweepLevel: params.story.structure.recentSweep?.level ?? null,
        orderBlock: params.story.structure.orderBlock?.label ?? null,
        summary: params.story.structure.summary,
      },
      windowDivergence: params.story.windowDivergence
        ? {
            kind: params.story.windowDivergence.kind,
            label: params.story.windowDivergence.label,
            headline: params.story.windowDivergence.headline,
            evidence: params.story.windowDivergence.evidence,
          }
        : null,
      chapters: params.story.chapters.map(ch => ({
        phaseId: ch.phaseId,
        label: ch.label,
        count: ch.count,
        isDeveloping: ch.isDeveloping,
      })),
      buckets: params.story.buckets.map(b => ({
        index: b.index,
        startIso: new Date(b.start).toISOString(),
        endIso: new Date(b.end).toISOString(),
        isDeveloping: b.isDeveloping,
        priceOpen: b.priceOpen,
        priceClose: b.priceClose,
        priceHigh: b.priceHigh,
        priceLow: b.priceLow,
        deltaBtc: b.deltaBtc,
        cvdBtc: b.cvdBtc,
        volumeBtc: b.volumeBtc,
        oiState: b.oiState,
        oiChangeBtc: b.oiChangeBtc,
        oiEndBtc: b.oiEndBtc,
        longLiqUsd: b.longLiqUsd,
        shortLiqUsd: b.shortLiqUsd,
        phaseId: b.phaseId,
        phaseLabel: b.phaseLabel,
        divergence: b.divergence,
        absorption: b.absorption,
        structureBreak: b.structureBreak,
        liquiditySweep: b.liquiditySweep,
      })),
    },
    events: params.events.map(ev => ({
      id: ev.id,
      kind: ev.kind,
      tag: ev.tag,
      title: ev.title,
      value: ev.value,
      timeIso: new Date(ev.time).toISOString(),
    })),
    myTrade: {
      side: params.draft.side,
      entryInput: params.draft.entry,
      stopInput: params.draft.stop,
      leverageInput: params.draft.leverage,
      mode: params.tradeResult?.mode ?? null,
      referencePrice: params.tradeResult?.referencePrice ?? params.snapshot.price,
      summary: params.tradeResult?.summary ?? null,
      checks:
        params.tradeResult?.checks.map(c => ({
          id: c.id,
          title: c.title,
          status: c.status,
          headline: c.headline,
          evidence: c.evidence,
        })) ?? [],
    },
  }
}

export function createJournalEntry(
  snapshot: PageDataSnapshot,
  options?: { id?: string; outcome?: TradeOutcome; exitPrice?: string; notes?: string },
): JournalEntry {
  return {
    id: options?.id ?? `ttt-${snapshot.capturedAtMs}-${Math.random().toString(36).slice(2, 7)}`,
    createdAtMs: snapshot.capturedAtMs,
    createdAtIso: snapshot.capturedAtIso,
    outcome: options?.outcome ?? 'open',
    exitPrice: options?.exitPrice ?? '',
    notes: options?.notes ?? '',
    snapshot,
  }
}

const CHECK_COLUMN_SPECS: ReadonlyArray<{ id: string; header: string }> = [
  { id: 'flow', header: 'Check: Flow' },
  { id: 'divergence', header: 'Check: Divergence' },
  { id: 'absorption', header: 'Check: Absorption' },
  { id: 'regime', header: 'Check: Regime' },
  { id: 'location', header: 'Check: Location' },
  { id: 'rsi', header: 'Check: Smart RSI' },
  { id: 'structure', header: 'Check: Structure' },
  { id: 'crowding', header: 'Check: Crowding' },
  { id: 'trend', header: 'Check: 1h Trend' },
  { id: 'liquidations', header: 'Check: Liquidations' },
  { id: 'stop', header: 'Check: Stop' },
  { id: 'liq-distance', header: 'Check: Liq Distance' },
]

export const JOURNAL_COLUMNS: readonly string[] = [
  'Entry ID',
  'Captured UTC',
  'Instrument',
  'Timeframe',
  'Confirmation Mode',
  'Confirmation Status',
  'Side',
  'Entry Price',
  'Stop Price',
  'Leverage',
  'Outcome',
  'Exit Price',
  'Move %',
  'Leveraged Return %',
  'Notes',
  'Market Price',
  '6h VWAP',
  '15m ATR %',
  '6h Trend %',
  'Smart RSI',
  'Smart RSI Zone',
  'Structure Bias',
  'Structure Signal',
  'Order Block',
  'Window Divergence',
  'Confirmed Regime',
  'Regime Sentiment',
  'Market Pulse Headline',
  'Market Story Headline',
  'Story Progression',
  'Card: Volume Delta',
  'Card: CVD',
  'Card: Open Interest',
  'Card: Liquidations',
  'Long Liqs 15m (USD)',
  'Short Liqs 15m (USD)',
  'Funding Rate',
  'Long/Short Ratio',
  'Checks In Favour',
  'Checks Against',
  'Checks Caution',
  'Check Summary',
  ...CHECK_COLUMN_SPECS.map(c => c.header),
]

function numStr(n: number | null | undefined, dp?: number): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return ''
  return dp !== undefined ? n.toFixed(dp) : String(n)
}

function cardValue(cards: readonly SnapshotCardSummary[], id: Metric['id']): string {
  return cards.find(c => c.id === id)?.value ?? ''
}

export function journalEntryToRow(entry: JournalEntry): string[] {
  const s = entry.snapshot
  const pnl = computeJournalPnl(entry)
  const checkMap = new Map(s.myTrade.checks.map(c => [c.id, `${c.status.toUpperCase()}: ${c.headline}`]))
  const progression = s.story.chapters.map(ch => `${ch.label} (${ch.count}x${s.timeframe})`).join(' -> ')

  return [
    entry.id,
    entry.createdAtIso,
    s.instrument,
    s.timeframe,
    s.confirmationMode,
    s.confirmationStatus,
    s.myTrade.side ?? '',
    pnl.entryPriceUsed !== null ? String(pnl.entryPriceUsed) : s.myTrade.entryInput,
    s.myTrade.stopInput,
    s.myTrade.leverageInput,
    entry.outcome,
    entry.exitPrice,
    numStr(pnl.priceMovePct, 2),
    numStr(pnl.leveragedPnlPct, 2),
    entry.notes,
    numStr(s.market.price, 2),
    numStr(s.market.vwap6h, 2),
    numStr(s.market.atr15mPct, 2),
    numStr(s.market.trend6hPct, 2),
    numStr(s.story.smartRsi?.value, 1),
    s.story.smartRsi?.zone ?? '',
    s.story.structure.bias,
    s.story.structure.shortLabel,
    s.story.structure.orderBlock ?? '',
    s.story.windowDivergence?.label ?? '',
    s.oiRegime.marketTitle ?? '',
    s.oiRegime.sentiment ?? '',
    s.pulse.headline,
    s.story.headline,
    progression,
    cardValue(s.cards, 'delta'),
    cardValue(s.cards, 'cvd'),
    cardValue(s.cards, 'oi'),
    cardValue(s.cards, 'liquidations'),
    numStr(s.market.recentLongLiq15mUsd, 0),
    numStr(s.market.recentShortLiq15mUsd, 0),
    s.market.fundingRate !== null ? (s.market.fundingRate * 100).toFixed(4) + '%' : '',
    numStr(s.market.longShortRatio, 2),
    s.myTrade.summary ? String(s.myTrade.summary.good) : '',
    s.myTrade.summary ? String(s.myTrade.summary.against) : '',
    s.myTrade.summary ? String(s.myTrade.summary.caution) : '',
    s.myTrade.summary?.headline ?? '',
    ...CHECK_COLUMN_SPECS.map(spec => checkMap.get(spec.id) ?? ''),
  ]
}

function escapeCsvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function escapeTsvCell(value: string): string {
  return value.replace(/[\t\r\n]+/g, ' ').trim()
}

/** RFC 4180 CSV export of journal entries (or a single snapshot entry) with headers. */
export function serializeJournalCsv(entries: readonly JournalEntry[]): string {
  const headerLine = JOURNAL_COLUMNS.map(escapeCsvCell).join(',')
  const lines = entries.map(entry => journalEntryToRow(entry).map(escapeCsvCell).join(','))
  return [headerLine, ...lines].join('\r\n')
}

/** Tab-separated values (TSV) for direct Cmd+V / Ctrl+V pasting into Google Sheets or Excel. */
export function serializeJournalTsv(entries: readonly JournalEntry[], includeHeader = true): string {
  const lines = entries.map(entry => journalEntryToRow(entry).map(escapeTsvCell).join('\t'))
  if (!includeHeader) return lines.join('\n')
  const headerLine = JOURNAL_COLUMNS.map(escapeTsvCell).join('\t')
  return [headerLine, ...lines].join('\n')
}

/** Rich structured JSON payload designed for LLM analysis and programmatic Google Sheets updates. */
export function serializeJournalJson(entries: readonly JournalEntry[]): string {
  const wins = entries.filter(e => e.outcome === 'win').length
  const losses = entries.filter(e => e.outcome === 'loss').length
  const breakevens = entries.filter(e => e.outcome === 'breakeven').length
  const open = entries.filter(e => e.outcome === 'open').length
  const decided = wins + losses

  const payload = {
    schema: 'takethetrade.journal.v1',
    exportedAtIso: new Date().toISOString(),
    stats: {
      totalEntries: entries.length,
      open,
      wins,
      losses,
      breakevens,
      winRatePct: decided > 0 ? Number(((wins / decided) * 100).toFixed(1)) : null,
    },
    entries: entries.map(entry => ({
      id: entry.id,
      createdAtIso: entry.createdAtIso,
      outcome: entry.outcome,
      exitPrice: entry.exitPrice || null,
      notes: entry.notes || null,
      pnl: computeJournalPnl(entry),
      snapshot: entry.snapshot,
    })),
  }

  return JSON.stringify(payload, null, 2)
}
