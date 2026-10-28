# Milestones

- M0 — Repository and quality gates: foundation implemented; user approved continuation. Fresh npm ci, lint, typecheck, unit test infrastructure, production build, and desktop/tablet Chromium smoke tests passed. Tablet emulation does not replace iPad Safari testing.
- M1 — Static design prototype: prototype implemented; user approved visual direction. Demo fixtures, metric details, event inbox, session focus mode and responsive layouts are available. Desktop/tablet Chromium interaction and width checks pass. Actual iPad/iPhone Safari and manual device assessment remains outstanding. Loading and error previews are available in Settings.
- M2 — Provider spike: in progress. Bybit documentation is reachable; its REST endpoint returns a provider-side geographic 403 from this cloud machine. OKX public trades and open interest were observed across two connections; OKX agreement requires user review and clarification of UK eligibility; the user confirmed personal use only; backfill reconciliation, automatic reconnection and liquidation coverage remain unverified.
- M3 — Trade engine: offline replay implemented with exact satoshi arithmetic, deduplication, session boundaries and gap flags; unit tests pass. Provider normalization, automatic gap detection and live integration remain outstanding.
- M4 — Live overview: OKX trade stream, header price, minute delta and session CVD unified directly into the primary visual design (demo mode toggle removed). Controlled browser checks pass, including disconnect and resubscription while retaining the coverage warning.
- M5 — Open interest and liquidation cards: live OKX open-interest quantity, session percentage change, staleness labels, `liquidation-orders` normalization, and live event inbox implemented in the primary card layout.
- M6 — Market Pulse: deterministic rule evaluation (`evaluateMarketPulse`) with `"Insufficient data"` baseline fallback and live evidence drawer integrated into the Market Pulse card.
- M7 — Deep Dive and preferences: not started.
- M8 — Optional liquidity experiment: not started.
