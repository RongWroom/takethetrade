# Provider feasibility

M2 is in progress. No provider has been selected and no live data is connected.

On 28 October 2026, requests to Bybit public documentation and API and OKX documentation and API returned a cloud proxy CONNECT 403. These responses do not establish exchange accessibility, UK eligibility, or terms. The environment draft requests access to the candidates' documentation, public API and WebSocket hosts. After the settings are applied, retry access and verify current official documentation and terms before subscribing.

Still to establish: UK availability and permitted use; BTC perpetual symbol and units; trade aggressor side and timestamps; open-interest update cadence; liquidation coverage; rate limits; backfill; and reconnect behaviour. A successful handshake alone is insufficient. Do not bypass geographic or contractual restrictions.

## Bybit documentation review

After network settings were applied, the public documentation returned HTTP 200. The official [trade stream](https://bybit-exchange.github.io/docs/v5/websocket/public/trade) documents `publicTrade.BTCUSDT`, trade ID, matched timestamp, price, size and `S` as taker Buy/Sell. The [linear ticker](https://bybit-exchange.github.io/docs/v5/websocket/public/ticker) documents open interest and snapshot/delta semantics; its stated derivatives push frequency is 100 ms, not a guarantee that OI itself changes at that frequency. The [all-liquidation stream](https://bybit-exchange.github.io/docs/v5/websocket/public/all-liquidation) states a 500 ms push frequency and identifies `Buy` as a liquidated long, with bankruptcy price. These are provider statements, not independently verified coverage or unit conversions.

The Bybit REST time endpoint returned an upstream CloudFront 403 stating that access is blocked from the cloud machine's country. This does not determine access from a UK user. A direct Node WebSocket attempt reported an error; its proxy routing and the provider response were not established, so it is not proof of a WebSocket geographic restriction. No live trade stream or reconnect test has succeeded. Do not bypass geographic restrictions. UK eligibility, terms, rate limits, backfill, unit conversion and live coverage remain to be checked.

## OKX spike — 28 October 2026

The public instrument endpoint reports `BTC-USDT-SWAP` as live and linear, with `ctVal=0.01` BTC per contract. The [official API documentation](https://www.okx.com/docs-v5/en/) says the `trades` channel aggregates matches by taker order, price and source; `side` is the taker's side and swap `sz` is in contracts. The open-interest channel pushes updates every three seconds when changed, with contract and currency quantities. Its liquidation-orders channel explicitly does not represent all liquidations.

A public WebSocket session to `wss://ws.okx.com/ws/v5/public` subscribed successfully to trades, open interest and liquidation orders. Two sequential 12-second connections received 59 and 319 trade entries and 2 and 1 open-interest entries respectively. Both buy and sell were observed during preliminary sampling. No liquidation events arrived during these short windows, so their format and coverage were not verified live. Disconnecting and opening a second connection worked; automatic recovery after interruption, missed data, backfill and rate-limit behaviour remain untested. `scripts/okx_spike.py` reproduces this bounded diagnostic using Python websockets >=15.

The machine's network location is not evidence of UK availability. Current UK eligibility and terms for accessing and using this data remain unverified; the accessible general terms redirected to a US page. No provider is selected until those questions and the missing feed checks are resolved.

### Agreement and recovery research

The [OKX API Agreement](https://www.okx.com/en-gb/help/okx-api-agreement), reviewed 28 October 2026, states that API use signifies agreement, that even unauthenticated public market data is covered, and that eligibility includes a verified account and jurisdictional requirements (sections 2 and 3.2). Section 9.4 limits market data to personal non-commercial use and says displaying it to any third party requires prior written consent. This is material to the two-user prototype; OKX's confirmation of UK eligibility and whether the intended two-user use is permitted is needed before selection. Section 3.5 excludes an agent accepting terms on a user's behalf. Earlier public tests preceded discovery of these conditions; no further API calls should be made until the user has reviewed them and eligibility/use is clarified.

The public documentation says trade history covers the last three months with pagination, up to 100 records per request and 20 requests per two seconds per IP. It returns individual trade IDs, taker side, contract quantities and timestamps, while the WebSocket trades channel aggregates matches and returns the last ID in each aggregate. A reliable deduplication and backfill reconciliation strategy is not yet demonstrated. Documentation sets a connection limit of three requests per second per IP, 480 subscribe/unsubscribe/login requests per connection per hour, and describes ping/pong and reconnection after inactivity. Recovery and gap repair remain untested.


On a later retry, the Python diagnostic again received public trade and open-interest messages, plus a liquidation event for another instrument. Cloud Chromium reported `ERR_CERT_AUTHORITY_INVALID` through the configured proxy; the live dashboard consequently showed disconnected. This does not establish whether a normal user browser can connect. TLS verification was retained. The user confirmed personal use and acceptance of the OKX terms.
