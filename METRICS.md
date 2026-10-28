# Trade calculations

The offline replay engine consumes one exchange and symbol in a UTC session with explicit start, end and bucket duration in milliseconds. Intervals are half-open: start inclusive, end exclusive. Quantities are positive BTC decimal strings with at most eight decimal places, converted exactly to integer satoshis. Converting exchange contract quantities to BTC is an adapter responsibility and has not yet been implemented or verified.

For each bucket, buy and sell are sums of taker-side quantities; volume is buy plus sell, delta is buy minus sell, and CVD is the cumulative sum of delta from the session start. A new replay session resets CVD. Duplicate IDs with identical normalized contents are ignored; conflicting IDs are rejected. Event order does not affect results. Invalid or mismatched trades are rejected. Known gaps are supplied explicitly; affected buckets and all later CVD values in the session are marked incomplete. An empty bucket is not evidence of full feed coverage: callers must report known gaps.

The engine has no feed connection, persistence, automatic gap detection or UI integration. Test fixtures are synthetic and do not establish provider coverage.
