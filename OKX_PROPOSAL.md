# Take The Trade — OKX API Use Proposal

Draft prepared in response to OKX's request for a clear proposal covering the
product model, user account model, endpoints and market data used, charging
plans, and security and compliance controls.

**Prepared by:** [Name]
**Contact:** [Email]
**Jurisdiction:** United Kingdom
**Date:** [Date]

## 1. Product model

Take The Trade is a read-only order-flow analytics dashboard for a single
instrument, the OKX `BTC-USDT-SWAP` perpetual future. It is currently a
working personal prototype and is being prepared for release as a commercial
web application.

The application displays, in the user's browser:

- Live last trade price
- Volume delta and cumulative volume delta (CVD) aggregated from the public
  trades stream
- Open interest, with a session percentage change and explicit staleness
  labels
- Liquidation events on BTC-USDT-SWAP, presented alongside the documented
  caveat that the channel does not represent all liquidations
- Funding rate, long/short account ratio, and taker volume statistics
- A deterministic, rules-based "Market Pulse" summary over closed 5- or
  15-minute UTC windows
- A read-only "My Trade" checklist that compares a user-entered intended
  trade (side, optional entry, stop, leverage) against live market context,
  including an explicitly labelled *approximate* isolated-margin liquidation
  distance
- A market events inbox

The application has **no trading functionality**. It cannot place, modify, or
cancel orders, holds no user funds, and provides no portfolio management or
execution services.

**Intended use case:** retail and semi-professional traders who already trade
BTC perpetual futures and want a focused order-flow view when forming their
own decisions. The product presents market data and transparent rule-based
summaries; it does not issue trading signals as a service, manage money, or
execute on any user's behalf.

## 2. User OKX accounts

**Users do not connect their own OKX accounts.** The application requests no
API keys, performs no OAuth, and consumes only unauthenticated public
endpoints. Each user's browser opens its own connection directly to OKX; the
operator's servers do not relay or store market data.

Account linking is a possible future feature (for example, to let users
overlay their own positions on the same context). If pursued, OKX would be
re-engaged before any private or authenticated endpoint is enabled, and the
relevant agreement terms would be reviewed at that time.

## 3. OKX endpoints and market data used

All usage is unauthenticated. Per-user request rates are modest and within
documented public limits.

### WebSocket — `wss://ws.okx.com/ws/v5/public`

One connection per user browser, one subscribe message of four channels:

| Channel              | Parameters              | Use                                        |
|----------------------|-------------------------|--------------------------------------------|
| `trades`             | `instId=BTC-USDT-SWAP`  | Price, volume delta, CVD, Market Pulse     |
| `open-interest`      | `instId=BTC-USDT-SWAP`  | Open-interest card and change metrics      |
| `liquidation-orders` | `instType=SWAP`         | Liquidation events (filtered to BTC-USDT-SWAP client-side) |
| `funding-rate`       | `instId=BTC-USDT-SWAP`  | Funding display and crowding check         |

### REST — `https://www.okx.com/api/v5/`

| Endpoint                                                        | Frequency                                   |
|-----------------------------------------------------------------|---------------------------------------------|
| `GET /public/open-interest?instType=SWAP&instId=BTC-USDT-SWAP`  | Every 30 s (supplements WS OI)              |
| `GET /public/funding-rate?instId=BTC-USDT-SWAP`                 | On load and every 5 min (WS fallback)       |
| `GET /market/candles?instId=BTC-USDT-SWAP&bar=15m&limit=24`     | On load and every 5 min (VWAP/ATR context)  |
| `GET /market/candles?instId=BTC-USDT-SWAP&bar=1H&limit=7`       | On load and every 5 min (trend context)     |
| `GET /market/candles?instId=BTC-USDT-SWAP&bar={1m,5m,15m,30m,1H}&limit=26` | Only when the user changes chart timeframe |
| `GET /rubik/stat/contracts/long-short-account-ratio-contract?instId=BTC-USDT-SWAP&period=5m&limit=13` | On load and every 5 min |
| `GET /rubik/stat/taker-volume-contract?instId=BTC-USDT-SWAP&period={5m,15m,30m,1H}&unit=1&limit=12` | Only on timeframe change |
| `GET /rubik/stat/contracts/open-interest-volume?ccy=BTC&period={5m,15m,30m,1H}` | Only on timeframe change |

Estimated steady-state REST load per active user is roughly 3–6
requests/minute; the WebSocket sends four subscribe operations per
connection, far below the documented 480/connection/hour limit. Keepalive
pings follow OKX's documented ping/pong contract.

## 4. Charging users

The intent is to monetize the application; the pricing model has not been
decided (subscription, freemium, and one-time purchase are all under
consideration). This proposal is being submitted **before** any commercial
launch specifically because section 9.4 of the OKX API Agreement restricts
market data to personal, non-commercial use and requires prior written
consent to display it to third parties. No users are charged today and the
prototype is not publicly distributed.

## 5. Security and compliance controls

**Credential surface.** The application handles no OKX credentials, no user
accounts on OKX, and no private API keys — the entire credential-attack
surface is absent by design. All transport to OKX is TLS
(`wss://`/`https://`); certificate validation is never bypassed.

**Data handling.** The application stores no market data server-side.
User-entered trade details (side, entry, stop, leverage) are stored only in
the user's own browser `localStorage` and are never transmitted to the
operator or any third party.

**Data integrity and honest presentation.** The product is deliberately
conservative about data quality:

- Feed interruptions set an explicit gap flag; affected windows and all
  downstream CVD values are marked incomplete and a coverage warning is
  shown rather than silently continuing.
- Open interest older than 90 seconds is labelled stale and excluded from
  confirmation logic.
- Market Pulse only evaluates *closed* UTC windows and falls back to
  "Insufficient data" when coverage is incomplete.
- Any check whose inputs are unavailable returns "unknown" instead of
  guessing.
- The liquidation-distance estimate is labelled approximate and documented
  as excluding fees, funding, and higher margin tiers.
- Users are told the `liquidation-orders` channel does not represent all
  liquidations.

**Rate-limit and terms compliance.** Request rates are designed within
documented public limits (Section 3). The application does not attempt to
bypass geographic or contractual restrictions; UK eligibility is one of the
questions in Section 7. The developer has reviewed the OKX API Agreement,
including section 9.4, and earlier prototype testing was suspended pending
this clarification.

**Disclosures.** The product is presented as an analytics tool, not
financial advice. Rule thresholds are described to users as uncalibrated
defaults. Before any commercial launch, terms of use and a
not-financial-advice disclaimer will be in place; UK regulatory status
(e.g. FCA financial-promotion perimeter for an analytics-only product that
neither executes nor arranges trades) is being assessed and any required
changes will be made before charging users.

## 6. AI systems

**None.** All derived outputs (Market Pulse, regime matrix, My Trade
checklist) are deterministic rules over published market data — fixed
thresholds and arithmetic, with no machine-learning models, no LLM
features, and no automated decision-making about users. Any future change
in this area would be disclosed to OKX before release.

## 7. Trading strategies and risk framework

**Trading strategies:** the operator runs no automated trading strategies
and the product executes no orders. There is no strategy traffic on the
API.

**Risk management framework (product-side):**

- Read-only scope eliminates execution, custody, and key-management risk.
- Gap detection, staleness thresholds, closed-window confirmation, and
  explicit "unknown"/"Insufficient data" states prevent the product from
  presenting stale or partial data as authoritative (Section 5).
- No leverage, sizing, or order recommendations are generated; the My Trade
  panel only restates user-entered numbers against public context.

## 8. Requests to OKX

1. **Eligibility:** confirmation that a UK-based developer and UK/other
   eligible-jurisdiction end users may access these public endpoints for
   this use.
2. **Section 9.4 consent:** written consent, or guidance on the correct
   licensing path, to display OKX public market data to third parties
   inside a commercial application.
3. **Architecture confirmation:** whether the client-direct model (each
   user's browser connecting to OKX public endpoints itself; the operator
   relaying nothing) is acceptable to OKX for a commercial product, or
   whether a different integration or licence is required.
4. **Attribution and display requirements:** any required attribution,
   branding, or disclaimer wording when presenting OKX market data.
5. **Fees and process:** any applicable market-data licence fees,
   paperwork, or review steps, and the expected timeline.

The developer is happy to provide a live demonstration, source-level detail
on normalization and rate limiting, or further compliance information on
request.
