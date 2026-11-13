# Take The Trade

A read-only Bitcoin perpetual-futures order-flow dashboard. The overview connects directly to the public OKX `BTC-USDT-SWAP` WebSocket stream (`trades`, `open-interest`, `liquidation-orders`, and `funding-rate`) and displays live price in the header, four interactive order-flow cards (Volume Delta, Cumulative Volume Delta, Open Interest, and Liquidations), a deterministic Market Pulse summary, a read-only **My Trade** slide-out drawer for evaluating a planned or held trade against live market context, and a quiet Market Events inbox. No trading functionality is implemented. Live coverage begins when the page opens, has no historical backfill on the 1m stream, and can miss events during disconnects or browser sleep.

## Development

Use Node.js 24 and npm. From the repository root:

```sh
npm ci
npx playwright install chromium
npm run dev
```

Run quality checks with `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e`. Playwright may require system dependencies; see its installation documentation if browser startup reports missing libraries. On this cloud machine, use `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e` to use the installed browser. The smoke suite uses Chromium at desktop and tablet viewport sizes; it does not replace testing in iPad Safari.

See [MILESTONES.md](MILESTONES.md) for progress. Each milestone requires review before the next begins.

## Signal confirmation

Market Pulse and the regime matrix use closed, fixed UTC windows of 5 or 15 minutes, chosen in Settings and independent of the chart timeframe. Trade coverage must reach both ends of each window, and open interest is held from its last OKX update (WebSocket on change, plus a public REST refresh every 30 seconds) and not used once older than 90 seconds. Two matching valid closes are required to confirm; a strong label also needs volume to rise at least 10% against a prior valid window. These thresholds are uncalibrated defaults rather than tested market-wide values. Interruptions of the feed restart confirmation; switching browser tabs alone does not. Live price, delta and liquidation figures are unaffected by this logic.

## Provider diagnostic

The isolated OKX spike uses Python 3 and the `websockets` package version 15 or later. Run `python scripts/okx_spike.py` where those prerequisites are installed. It connects twice for 12 seconds each and reports public sample messages and counts. This does not connect the dashboard to live data; see [DATA_SOURCES.md](DATA_SOURCES.md) for findings and limitations.
