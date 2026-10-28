# Take The Trade

A read-only Bitcoin order-flow dashboard design prototype. Demo mode uses illustrative fixtures. The experimental live mode connects to the public OKX BTC-USDT swap trade stream and displays a last trade price, minute delta, session CVD and open-interest quantity. No trading functionality is implemented. Live coverage is incomplete: the session starts when the page opens, has no backfill and can miss trades during disconnects or browser sleep. Review OKX’s API terms and eligibility before using live mode. Focus mode and event dismissal last for the current session.

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
