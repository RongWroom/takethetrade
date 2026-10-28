# Take The Trade

A read-only Bitcoin perpetual-futures order-flow dashboard. The overview connects directly to the public OKX `BTC-USDT-SWAP` WebSocket stream (`trades`, `open-interest`, and `liquidation-orders`) and displays live price in the header, four interactive order-flow cards (Volume Delta, Cumulative Volume Delta, Open Interest, and Liquidations), a deterministic Market Pulse summary, and a quiet Market Events inbox. No trading functionality is implemented. Live coverage begins when the page opens, has no historical backfill, and can miss events during disconnects or browser sleep.

## Development

Use Node.js 24 and npm. From the repository root:

```sh
npm ci
npx playwright install chromium
npm run dev
```

Run quality checks with `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e`. Playwright may require system dependencies; see its installation documentation if browser startup reports missing libraries. On this cloud machine, use `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e` to use the installed browser. The smoke suite uses Chromium at desktop and tablet viewport sizes; it does not replace testing in iPad Safari.

See [MILESTONES.md](MILESTONES.md) for progress. Each milestone requires review before the next begins.

## Provider diagnostic

The isolated OKX spike uses Python 3 and the `websockets` package version 15 or later. Run `python scripts/okx_spike.py` where those prerequisites are installed. It connects twice for 12 seconds each and reports public sample messages and counts. This does not connect the dashboard to live data; see [DATA_SOURCES.md](DATA_SOURCES.md) for findings and limitations.
