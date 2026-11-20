import { describe, expect, it } from 'vitest'
import { evaluateMarketStory } from './marketStory'
import { SignalConfirmation } from './signalConfirmation'
import { evaluateTradeCheck, type MarketSnapshot } from './tradeCheck'
import { evaluateOiRegime } from './tradeEngine'
import {
  JOURNAL_COLUMNS,
  buildPageDataSnapshot,
  computeJournalPnl,
  createJournalEntry,
  journalEntryToRow,
  serializeJournalCsv,
  serializeJournalJson,
  serializeJournalTsv,
} from './tradeJournal'

function makeSampleSnapshot() {
  const now = Date.UTC(2026, 10, 15, 14, 30, 0)
  const marketSnapshot: MarketSnapshot = {
    price: 80_000,
    flowPrice: 80_000,
    priceStart: 79_500,
    deltaBtc: 14.5,
    cvdBtc: 42.25,
    volumeBtc: 120,
    oiRegimeId: 'strong-uptrend',
    vwap: 79_400,
    atrPct: 0.45,
    rsi: 62.4,
    structureBreak: 'bullish-bos',
    structureLevel: 79_800,
    liquiditySweep: null,
    sweepLevel: null,
    fundingRate: 0.0001,
    lsRatio: 1.85,
    lsRatioAvg: 1.8,
    trendPct: 1.25,
    recentLongLiqUsd: 12_000,
    recentShortLiqUsd: 85_000,
    timeframeLabel: '5m confirmation',
  }

  const confirmation = new SignalConfirmation('5m', now).view(now, true)
  const oiRegime = evaluateOiRegime({
    priceStart: 79_500,
    priceEnd: 80_000,
    volumeSeriesBtc: [80, 120],
    oiStartBtc: 30_000,
    oiEndBtc: 30_250,
  })
  const story = evaluateMarketStory({
    buckets: [
      {
        start: now - 300_000,
        end: now,
        priceOpen: 79_500,
        priceClose: 80_000,
        priceHigh: 80_100,
        priceLow: 79_450,
        deltaBtc: 14.5,
        cvdBtc: 42.25,
        volumeBtc: 120,
        oiChangeBtc: 250,
        oiEndBtc: 30_250,
        longLiqUsd: 0,
        shortLiqUsd: 85_000,
        isDeveloping: true,
      },
    ],
    vwap: 79_400,
    timeframeLabel: '5 minutes',
  })

  const tradeResult = evaluateTradeCheck(
    { side: 'long', entry: 80_000, stop: 79_200, leverage: 10 },
    marketSnapshot,
  )

  return buildPageDataSnapshot({
    now,
    status: 'Connected',
    priceFormatted: '$80,000.00',
    timeframe: '5m',
    timeframeLabel: '5 minutes',
    gap: false,
    oiStale: false,
    confirmationMode: '5m',
    confirmationStatus: 'Confirmed',
    confirmationProgress: 'Strong uptrend: 2 of 2 matching 5m closes',
    confirmationDetail: 'Valid windows 2 · rejected 0',
    confirmationReason: 'All confirmation rules met.',
    metrics: [
      {
        id: 'delta',
        label: 'Volume Delta',
        value: '+14.50 BTC',
        description: 'Buyers hitting the ask',
        plainSummary: 'Buyers are more aggressive.',
        detail: 'Detail',
        color: 'teal',
        bars: [50, 80],
      },
      {
        id: 'cvd',
        label: 'Cumulative Volume Delta',
        value: '+42.25 BTC',
        description: 'Net buying',
        plainSummary: 'Buyers winning.',
        detail: 'Detail',
        color: 'blue',
        bars: [40, 90],
      },
      {
        id: 'oi',
        label: 'Open Interest',
        value: '30,250.00 BTC',
        description: '+0.83% (5m)',
        plainSummary: 'New money entering.',
        detail: 'Detail',
        color: 'amber',
        bars: [50, 70],
      },
      {
        id: 'liquidations',
        label: 'Liquidations',
        value: '$85.0K',
        description: '100% shorts squeezed',
        plainSummary: 'Shorts squeezed.',
        detail: 'Detail',
        color: 'rose',
        bars: [10, 80],
      },
    ],
    pulse: confirmation.pulse,
    oiRegime,
    story,
    snapshot: marketSnapshot,
    confirmation,
    events: [
      {
        id: 'ev-1',
        kind: 'liquidation',
        tag: 'LIQUIDATION',
        title: 'Short liquidation',
        value: '$85.0K',
        time: now - 10_000,
      },
    ],
    draft: {
      side: 'long',
      entry: '80000',
      stop: '79200',
      leverage: '10',
    },
    tradeResult,
  })
}

describe('tradeJournal domain', () => {
  it('captures complete page data snapshot and computes directional PnL for long and short trades', () => {
    const snap = makeSampleSnapshot()
    expect(snap.instrument).toBe('BTC-USDT-SWAP')
    expect(snap.market.price).toBe(80_000)
    expect(snap.cards).toHaveLength(4)
    expect(snap.myTrade.side).toBe('long')
    expect(snap.myTrade.checks.length).toBeGreaterThan(5)

    const longWin = createJournalEntry(snap, {
      id: 'entry-1',
      outcome: 'win',
      exitPrice: '81,600',
      notes: 'Clean BOS + positive delta',
    })
    const longPnl = computeJournalPnl(longWin)
    expect(longPnl.entryPriceUsed).toBe(80_000)
    expect(longPnl.exitPriceNum).toBe(81_600)
    expect(longPnl.priceMovePct).toBeCloseTo(2.0)
    expect(longPnl.leveragedPnlPct).toBeCloseTo(20.0)

    const shortSnap = {
      ...snap,
      myTrade: { ...snap.myTrade, side: 'short' as const, entryInput: '80000', leverageInput: '5' },
    }
    const shortLoss = createJournalEntry(shortSnap, {
      id: 'entry-2',
      outcome: 'loss',
      exitPrice: '80800',
    })
    const shortPnl = computeJournalPnl(shortLoss)
    expect(shortPnl.priceMovePct).toBeCloseTo(-1.0)
    expect(shortPnl.leveragedPnlPct).toBeCloseTo(-5.0)
  })

  it('serializes matching column counts across JOURNAL_COLUMNS, CSV, and TSV', () => {
    const snap = makeSampleSnapshot()
    const entry = createJournalEntry(snap, {
      id: 'entry-csv',
      outcome: 'win',
      exitPrice: '81000',
      notes: 'Note with, comma and "quotes"\nand newline',
    })

    const row = journalEntryToRow(entry)
    expect(row).toHaveLength(JOURNAL_COLUMNS.length)
    expect(row[0]).toBe('entry-csv')
    expect(row[6]).toBe('long')
    expect(row[10]).toBe('win')
    expect(row[12]).toBe('1.25')
    expect(row[13]).toBe('12.50')

    const csv = serializeJournalCsv([entry])
    expect(csv).toContain('Entry ID,Captured UTC,Instrument')
    expect(csv).toContain('"Note with, comma and ""quotes""\nand newline"')

    const tsvWithHeader = serializeJournalTsv([entry], true)
    const tsvLines = tsvWithHeader.split('\n')
    expect(tsvLines).toHaveLength(2)
    expect(tsvLines[0].split('\t')).toHaveLength(JOURNAL_COLUMNS.length)
    expect(tsvLines[1].split('\t')).toHaveLength(JOURNAL_COLUMNS.length)

    const tsvRowOnly = serializeJournalTsv([entry], false)
    expect(tsvRowOnly.split('\n')).toHaveLength(1)
    expect(tsvRowOnly.split('\t')).toHaveLength(JOURNAL_COLUMNS.length)
  })

  it('serializes LLM-ready JSON with win rate summary and full snapshot payload', () => {
    const snap = makeSampleSnapshot()
    const e1 = createJournalEntry(snap, { id: 'e1', outcome: 'win', exitPrice: '81000' })
    const e2 = createJournalEntry(snap, { id: 'e2', outcome: 'loss', exitPrice: '79200' })
    const e3 = createJournalEntry(snap, { id: 'e3', outcome: 'open' })

    const json = serializeJournalJson([e1, e2, e3])
    const parsed = JSON.parse(json)
    expect(parsed.schema).toBe('takethetrade.journal.v1')
    expect(parsed.stats).toEqual({
      totalEntries: 3,
      open: 1,
      wins: 1,
      losses: 1,
      breakevens: 0,
      noTrade: 0,
      winRatePct: 50,
    })
    expect(parsed.entries).toHaveLength(3)
    expect(parsed.entries[0].pnl.priceMovePct).toBe(1.25)
    expect(parsed.entries[0].snapshot.story.buckets).toHaveLength(1)
  })
})
