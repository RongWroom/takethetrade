# Trade calculations

The offline replay engine consumes one exchange and symbol in a UTC session with explicit start, end and bucket duration in milliseconds. Intervals are half-open: start inclusive, end exclusive. Quantities are positive BTC decimal strings with at most eight decimal places, converted exactly to integer satoshis. Converting exchange contract quantities to BTC is an adapter responsibility and has not yet been implemented or verified.

For each bucket, buy and sell are sums of taker-side quantities; volume is buy plus sell, delta is buy minus sell, and CVD is the cumulative sum of delta from the session start. A new replay session resets CVD. Duplicate IDs with identical normalized contents are ignored; conflicting IDs are rejected. Event order does not affect results. Invalid or mismatched trades are rejected. Known gaps are supplied explicitly; affected buckets and all later CVD values in the session are marked incomplete. An empty bucket is not evidence of full feed coverage: callers must report known gaps.

The engine has no feed connection, persistence, automatic gap detection or UI integration. Test fixtures are synthetic and do not establish provider coverage.

## My Trade context calculations (`src/domain/tradeCheck.ts`)

The read-only **My Trade** evaluator (`evaluateTradeCheck`) compares a user-described `TradeIntent` (`side: 'long' | 'short'`, optional `entry`, `stop`, and `leverage`) against a `MarketSnapshot`:

- **6h VWAP (`calcVwap`)**: volume-weighted average of typical candle price `(high + low + close) / 3` across the last 24 × 15m candles.
- **15m ATR% (`calcAtrPct`)**: mean true range `max(H - L, |H - prevClose|, |L - prevClose|)` across 15m candles, expressed as a percentage of the latest close.
- **Approximate isolated liquidation price (`approxLiquidationPrice`)**: `entry * (1 - 1 / leverage + 0.004)` for longs and `entry * (1 + 1 / leverage - 0.004)` for shorts, using OKX's tier-1 maintenance margin ratio (`0.4%`). Excludes fees, funding, and higher-tier margin brackets, and is explicitly labelled approximate.
- **Missing inputs**: any check whose required market data is `null` returns status `'unknown'` rather than guessing or reporting a false green check.
