import { describe, expect, it } from 'vitest'
import { evaluateMarketStory, type RawStoryBucketInput } from './marketStory'

const baseTime = Date.UTC(2026, 10, 13, 12, 0, 0)
const min = 60_000

function makeBucket(index: number, overrides: Partial<RawStoryBucketInput> = {}): RawStoryBucketInput {
  return {
    start: baseTime + index * min,
    end: baseTime + (index + 1) * min,
    priceOpen: 80_000,
    priceClose: 80_000,
    deltaBtc: 0,
    cvdBtc: 0,
    volumeBtc: 10,
    oiChangeBtc: 0,
    oiEndBtc: 30_000,
    longLiqUsd: 0,
    shortLiqUsd: 0,
    isDeveloping: false,
    ...overrides,
  }
}

describe('evaluateMarketStory', () => {
  it('returns waiting state when buckets have no price or flow data', () => {
    const story = evaluateMarketStory({
      buckets: [
        makeBucket(0, { priceOpen: null, priceClose: null, deltaBtc: null, cvdBtc: null, oiChangeBtc: null }),
      ],
      timeframeLabel: '1 minute',
    })
    expect(story.hasLiveData).toBe(false)
    expect(story.headline).toBe('Waiting for live market story')
    expect(story.buckets[0].phaseId).toBe('waiting')
    expect(story.buckets[0].oiState).toBe('missing')
    expect(story.chapters).toHaveLength(0)
  })

  it('tracks chapter transitions from balanced to buyers advancing to possible absorption', () => {
    const story = evaluateMarketStory({
      buckets: [
        makeBucket(0, { priceOpen: 80_000, priceClose: 80_002, deltaBtc: 0.01, cvdBtc: 0.01, volumeBtc: 10 }),
        makeBucket(1, { priceOpen: 80_002, priceClose: 80_060, deltaBtc: 8.5, cvdBtc: 8.51, volumeBtc: 20, oiChangeBtc: 15 }),
        makeBucket(2, { priceOpen: 80_060, priceClose: 80_120, deltaBtc: 9.2, cvdBtc: 17.71, volumeBtc: 22, oiChangeBtc: 18 }),
        makeBucket(3, { priceOpen: 80_120, priceClose: 80_122, deltaBtc: 11.0, cvdBtc: 28.71, volumeBtc: 25, oiChangeBtc: 2, isDeveloping: true }),
      ],
      vwap: 80_030,
      timeframeLabel: '1 minute',
    })

    expect(story.hasLiveData).toBe(true)
    expect(story.chapters.map(c => c.phaseId)).toEqual([
      'balanced',
      'buyers-advancing',
      'sell-absorption',
    ])
    expect(story.chapters[1].count).toBe(2)
    expect(story.chapters[2].isCurrent).toBe(true)
    expect(story.headline).toContain('Buyers pushing — price starting to stall')
    expect(story.buckets[1].oiState).toBe('opening')
    expect(story.vwapY).not.toBeNull()
  })

  it('detects bearish divergence (hollow rise) when price rises while net market orders are negative', () => {
    const story = evaluateMarketStory({
      buckets: [
        makeBucket(0, { priceOpen: 80_000, priceClose: 80_035, deltaBtc: -4.2, cvdBtc: -4.2, volumeBtc: 12 }),
        makeBucket(1, { priceOpen: 80_035, priceClose: 80_075, deltaBtc: -5.8, cvdBtc: -10.0, volumeBtc: 15, isDeveloping: true }),
      ],
      timeframeLabel: '5 minutes',
    })

    expect(story.buckets[0].divergence).toBe('bearish')
    expect(story.buckets[1].divergence).toBe('bearish')
    expect(story.windowDivergence).not.toBeNull()
    expect(story.windowDivergence?.kind).toBe('bearish')
    expect(story.headline).toContain('bearish divergence')
  })

  it('detects bullish divergence (hollow drop) when price falls while net market orders are positive', () => {
    const story = evaluateMarketStory({
      buckets: [
        makeBucket(0, { priceOpen: 80_000, priceClose: 79_960, deltaBtc: 5.5, cvdBtc: 5.5, volumeBtc: 14 }),
        makeBucket(1, { priceOpen: 79_960, priceClose: 79_920, deltaBtc: 6.1, cvdBtc: 11.6, volumeBtc: 16, isDeveloping: true }),
      ],
      timeframeLabel: '5 minutes',
    })

    expect(story.buckets[0].divergence).toBe('bullish')
    expect(story.buckets[1].divergence).toBe('bullish')
    expect(story.windowDivergence).not.toBeNull()
    expect(story.windowDivergence?.kind).toBe('bullish')
    expect(story.headline).toContain('bullish divergence')
  })

  it('computes Smart RSI across buckets and flags overbought exhaustion vs oversold absorption', () => {
    const overboughtStory = evaluateMarketStory({
      buckets: [
        makeBucket(0, { priceOpen: 80_000, priceClose: 80_100, deltaBtc: 5, volumeBtc: 20 }),
        makeBucket(1, { priceOpen: 80_100, priceClose: 80_250, deltaBtc: 6, volumeBtc: 25 }),
        makeBucket(2, { priceOpen: 80_250, priceClose: 80_420, deltaBtc: 8, volumeBtc: 30 }),
        makeBucket(3, { priceOpen: 80_420, priceClose: 80_580, deltaBtc: -2, volumeBtc: 18, isDeveloping: true }),
      ],
      priorCloses: [79_800, 79_900, 80_000],
      timeframeLabel: '5 minutes',
    })

    expect(overboughtStory.smartRsi).not.toBeNull()
    expect(overboughtStory.smartRsi?.zone).toBe('overbought')
    expect(overboughtStory.smartRsi?.shortLabel).toBe('Overbought (Exhausting)')
    expect(overboughtStory.smartRsi?.flowConfirmed).toBe(false)
    expect(overboughtStory.buckets[3].rsiZone).toBe('overbought')

    const oversoldStory = evaluateMarketStory({
      buckets: [
        makeBucket(0, { priceOpen: 80_000, priceClose: 79_850, deltaBtc: -8, volumeBtc: 22 }),
        makeBucket(1, { priceOpen: 79_850, priceClose: 79_680, deltaBtc: -9, volumeBtc: 26 }),
        makeBucket(2, { priceOpen: 79_680, priceClose: 79_500, deltaBtc: -7, volumeBtc: 24 }),
        makeBucket(3, { priceOpen: 79_500, priceClose: 79_350, deltaBtc: 4.5, volumeBtc: 28, isDeveloping: true }),
      ],
      priorCloses: [80_300, 80_150, 80_000],
      timeframeLabel: '5 minutes',
    })

    expect(oversoldStory.smartRsi).not.toBeNull()
    expect(oversoldStory.smartRsi?.zone).toBe('oversold')
    expect(oversoldStory.smartRsi?.shortLabel).toBe('Oversold (Absorbing)')
    expect(oversoldStory.smartRsi?.tone).toBe('teal')
    expect(oversoldStory.buckets[3].rsiZone).toBe('oversold')
  })

  it('detects LuxAlgo-style BOS, CHoCH, liquidity sweeps, and volumetric order blocks on closed buckets only', () => {
    // Closed bucket 2 sweeps below prior 79,900 low to 79,820 and closes at 79,940;
    // Closed bucket 3 breaks above 80,110 for Bullish CHoCH;
    // Developing bucket 4 does not prematurely trigger or overwrite structure events before close.
    const story = evaluateMarketStory({
      buckets: [
        makeBucket(0, { priceOpen: 80_100, priceClose: 80_000, priceHigh: 80_110, priceLow: 79_990 }),
        makeBucket(1, { priceOpen: 80_000, priceClose: 79_900, priceHigh: 80_010, priceLow: 79_900 }),
        makeBucket(2, {
          priceOpen: 79_900,
          priceClose: 79_940,
          priceHigh: 79_960,
          priceLow: 79_820,
          deltaBtc: 6,
          volumeBtc: 25,
        }),
        makeBucket(3, {
          priceOpen: 79_940,
          priceClose: 80_180,
          priceHigh: 80_190,
          priceLow: 79_935,
          deltaBtc: 12,
          volumeBtc: 32,
          isDeveloping: false,
        }),
        makeBucket(4, {
          priceOpen: 80_180,
          priceClose: 80_150,
          priceHigh: 80_260,
          priceLow: 80_140,
          deltaBtc: -1,
          volumeBtc: 10,
          isDeveloping: true,
        }),
      ],
      timeframeLabel: '5 minutes',
    })

    expect(story.buckets[2].liquiditySweep).toBe('bullish-sweep')
    expect(story.buckets[2].structureLevel).toBe(79_900)
    expect(story.buckets[3].structureBreak).toBe('bullish-choch')
    expect(story.buckets[4].liquiditySweep).toBeNull()
    expect(story.buckets[4].structureBreak).toBeNull()
    expect(story.structure.bias).toBe('bullish')
    expect(story.structure.lastEvent).toBe('bullish-choch')
    expect(story.structure.orderBlock).not.toBeNull()
    expect(story.structure.orderBlock?.kind).toBe('bullish')
  })
})
