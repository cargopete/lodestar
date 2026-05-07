# Token API deficiencies

Auto-appended by the /tokens prototype as it hits gaps in the Token API.

- **Owner:** Andrew Clews (Graph Foundation)
- **Audience:** Pinax / Graph core devs
- **Probed against:** `https://token-api.thegraph.com` v3.16.6+81ab0c8 (2026-04-28)
- **Auth:** `Authorization: Bearer <jwt>` from thegraph.com market

## Pre-build findings (verified 2026-05-05)

| Code | Severity | Detail | What we'd want |
|---|---|---|---|
| `TOKEN_API_NO_LEADERBOARD` | high | `/v1/evm/tokens` requires both `network` and `contract`. There is no list/leaderboard endpoint. Building a "top 250 by mcap" requires a client-maintained seed list of contracts + 250 fan-out calls. | A `/v1/evm/tokens?network=X&order_by=market_cap&limit=250` endpoint, or a `/v1/evm/tokens/top` ranked stream. |
| `TOKEN_API_NO_TOTAL_SUPPLY` | high | `total_supply` is `null` for ~all tokens checked (USDC, WETH, GRT, stETH, PEPE, ARKM). Only `circulating_supply` is reliable. FDV cannot be computed without an on-chain `eth_call` (which violates "Graph stack only"). | Populate `total_supply` from token contract reads on indexer side. |
| `TOKEN_API_NO_PRICE_FIELD` | medium | No `price_usd` on the tokens metadata endpoint. Price discovery requires choosing a canonical pool and fetching OHLC, which means caller must maintain a `(token, canonical_pool)` map. | A `price_usd` field on `/v1/evm/tokens` derived from the deepest pool, with `price_source_pool` for transparency. |
| `TOKEN_API_NO_RATE_LIMIT_HEADERS` | low | No `X-RateLimit-*` or `Retry-After` headers in responses. Caller cannot back off proactively. | Standard `RateLimit-*` headers per IETF draft. |
| `TOKEN_API_OHLC_DUPES` | medium | Pool OHLC returns multiple rows per `datetime` for the same pool (observed on the GRT/WETH 0.3% pool 0x0e2c…b5ed and on the CoW settlement contract 0x9008…ab41 which is exposed as a "pool" but is really a multi-pair settlement contract). | De-dupe server-side by (pool, datetime) and pick the canonical bar. Filter CoW settlement contract from `/v1/evm/pools` by default. |
| `TOKEN_API_POOLS_NO_LIQUIDITY_SORT` | medium | `/v1/evm/pools?input_token=…&output_token=…` returns candidate pools but with no liquidity or volume to sort by. To pick "the canonical pool" you must fan out OHLC per candidate and rank manually. | Add `tvl_usd` and `volume_24h_usd` to the pool list response and allow `order_by=tvl_usd` + `limit`. |
| `TOKEN_API_ICON_COVERAGE_GAP` | low | `icon: { web3icon: '<slug>' }` is a reference into the web3icons library, not a URL. Coverage on a 6-token sample: 5/6 (stETH missing). Long-tail likely worse. | Either return a resolved icon URL, or backfill web3icons for the top-N. |
| `TOKEN_API_COW_AS_POOL` | medium | The CoW Protocol settlement contract `0x9008d19f58aabd9ed0d60971565aa8510560ab41` appears in `/v1/evm/pools` results as a `cow` protocol pool but is actually a single contract that settles many pairs. Querying its OHLC returns a stream of unrelated tickers. Misleading and breaks naive "first pool" selection. | Either represent CoW as a non-pool source or hide the settlement contract behind a different endpoint. |
| `TOKEN_API_HOLDERS_AMOUNT_STRING` | high | `/v1/evm/holders` returns `amount` as a string of *base units* (e.g. `"2950586159470810704448008222"` for 18-decimals GRT). The OpenAPI schema declares it as `number`. Naive deserialization either crashes or shows nonsensical values. | Either ship `amount_decimal` (already-scaled number) and document `amount` as base-units string, or scale on the server. |
| `TOKEN_API_HOLDERS_VALUE_UNRELIABLE` | medium | `/v1/evm/holders.value` field is inconsistent: empirically it equals `amount / 10^18` rather than `amount * price` (no price applied). Burned us on GRT (showed ~$2.95B for the top holder; real value at $0.0258 is $76M). | Document the field's exact derivation, or drop it and let clients compute from price + amount. |
| `TOKEN_API_OHLC_SAMEDAY_DUPES_NEED_LARGE_LIMIT` | medium | OHLC duplicates aren't just minor noise: with small `limit` the API can return *all* same-day rows. We had to bump from `limit=2` to `limit=10` to reliably get yesterday's bar after de-dupe. Without that, 24h % delta cannot be computed. | Server-side de-duplication, or document that `limit` is "raw rows pre-dedupe." |
| `TOKEN_API_ICON_SLUG_NOT_URL` | low | The `icon: { web3icon: '<slug>' }` field is just a slug; clients must construct the SVG URL themselves. The slug is *lowercase* (`"grt"`) but the upstream web3icons GitHub repo serves files in *uppercase* (`GRT.svg`). The `npm` packages (`@web3icons/common`, `@web3icons/core`) don't ship the SVGs at all — only metadata. The only working CDN path: `https://cdn.jsdelivr.net/gh/0xa3k5/web3icons@main/raw-svgs/tokens/branded/<UPPER>.svg`. None of this is documented. | Either return a fully-resolved icon URL, or document the slug-to-URL transform clearly. |
| `TOKEN_API_MISSING_NAME` | low | Some tokens return `name: null` even when `symbol` is populated (observed: MKR on mainnet at `0x9f8f...79a2`). Clients must fall back to symbol. | Backfill `name` from contract `name()` reads where ABI provides it. |
| `TOKEN_API_NO_TOKEN_LEVEL_VOLUME` | medium | OHLC volume is per-pool, not per-token. To produce a meaningful "24h volume" for a token we'd need to fan out OHLC across every pool that token trades in and aggregate, on every directory render. v0 shows only canonical-pool volume, which is misleading for tokens whose deepest liquidity isn't on the chosen pool. | A `/v1/evm/tokens/{contract}/volume?window=24h` aggregate, or `volume_24h_usd` on `/v1/evm/tokens` as the sum across all known pools. |
| `TOKEN_API_OHLC_LIMIT_CAP_100` | medium | `/v1/evm/pools/ohlc?limit=N` is hard-capped at 100 (returns 403 `{"code":"forbidden","message":"Parameter 'limit' exceeds maximum of 100 items."}`). Not surfaced in the OpenAPI schema, which advertises `integer` with no maximum. To draw a 90-day 4h chart (540 bars), clients must paginate or fall back to coarser intervals. Worse: when ~50% of returned rows are same-day duplicates (`TOKEN_API_OHLC_DUPES`), the effective unique-bar yield per call is much lower. | Document the cap in OpenAPI, raise it (e.g. 1000) for chart-friendly windows, and de-dupe server-side so `limit` reflects unique bars. |
| `TOKEN_API_POOLS_FILTER_LEAKS` | high | `/v1/evm/pools?input_token=<X>` leaks **unrelated pools**. Querying with `input_token=GRT` returned pools like DGNX/TUSD and CHI/BID where neither side is GRT. The filter is enforced for some protocols (Uniswap) but not others (DODO, CoW). Markets lists contain garbage rows unless the client re-validates address equality. | Enforce `input_token` / `output_token` filtering uniformly across protocols, or document the soft-filter behavior. |
| `TOKEN_API_NO_OR_FILTER` | low | `/v1/evm/swaps` has separate `input_contract` and `output_contract` filters but no OR/"either side" filter. Clients must issue two parallel calls and merge to get all swaps for a token. Doubles latency and rate-limit consumption on every detail-page render. | Add an `involves_contract` (or `token_contract`) filter that matches either side. |
| `TOKEN_API_NO_PROJECT_URL` | low | `/v1/evm/tokens` returns metadata (name, symbol, decimals, supply, holders) but no project / website URL. Building anything CoinGecko-like requires a hand-curated `(contract, website)` map per chain — fine at 13 tokens, painful at 250, infeasible at long tail. Future monetization (referral / project listing fees) needs this field. | Add a `links` object (`{ website, twitter, github, docs }`) to the tokens response. Could be backfilled from a public registry (CoinGecko's `coins/{id}`, ethereum-lists/contracts, or governance-uploaded metadata via Subgraph Studio's pattern). |
| `TOKEN_API_NO_TAGS` | low | No taxonomy/category field on `/v1/evm/tokens`. Categorical filters (Stablecoin, DEX, Lending, LST, Governance, Memecoin, etc.) are table stakes for any directory UI; clients have to maintain their own. Same registry/governance angle as `TOKEN_API_NO_PROJECT_URL`. | Add a `tags: string[]` array to tokens metadata, sourced from a registry or community-maintained list. |
| `TOKEN_API_NO_HOLDER_TYPE` | high | `/v1/evm/holders` doesn't flag whether each address is a contract or an externally-owned account. Top-N concentration looks alarming (FDUSD ~97%, MATIC ~95%, DYDX ~97%) but most of that supply lives in bridges, staking modules, LP pools, vesting timelocks, and CEX hot wallets, not insider EOAs. Clients have to make a separate `eth_getCode` round-trip per address (we use viem against a public RPC; an extra dependency outside the Graph stack). | Add `is_contract: boolean` to each holder row. Cheap on the indexer side (already indexed), saves clients an RPC trip per address, and lets the API expose a `holder_type` filter (`eoa` / `contract`). Bonus: a free-text label or category (`bridge`, `staking`, `cex`, `dao_treasury`) would close the gap entirely and is well within reach if backfilled from address registries. |

## Runtime log

(appended automatically by `src/lib/tokens/deficiencies.ts` as the prototype runs)
| 2026-05-06T02:02:50.537Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 2 rows but only 1 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-06T02:02:53.024Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for AAVE on mainnet (FDV cannot be computed) |
| 2026-05-06T02:02:53.123Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ENS on mainnet (FDV cannot be computed) |
| 2026-05-06T02:02:53.533Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for  on mainnet (FDV cannot be computed) |
| 2026-05-06T02:02:53.533Z | `TOKEN_API_MISSING_ICON` | icon missing for  on mainnet |
| 2026-05-06T02:02:53.744Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for COMP on mainnet (FDV cannot be computed) |
| 2026-05-06T02:02:54.007Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GRT on mainnet (FDV cannot be computed) |
| 2026-05-06T02:02:54.103Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 2 rows but only 1 distinct datetimes for pool 0x92560c178ce069cc014138ed3c2f5221ba71f58a |
| 2026-05-06T02:02:54.319Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for CRV on mainnet (FDV cannot be computed) |
| 2026-05-06T02:02:54.851Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 2 rows but only 1 distinct datetimes for pool 0xea4ba4ce14fdd287f380b55419b1c5b6c3f22ab6 |
| 2026-05-06T02:02:55.000Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 2 rows but only 1 distinct datetimes for pool 0x0e2c4be9f3408e5b1ff631576d946eb8c224b5ed |
| 2026-05-06T02:02:55.131Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LDO on mainnet (FDV cannot be computed) |
| 2026-05-06T02:02:55.184Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 2 rows but only 1 distinct datetimes for pool 0x4c83a7f819a5c37d64b4c5a2f8238ea082fa1f4e |
| 2026-05-06T02:02:55.289Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WBTC on mainnet (FDV cannot be computed) |
| 2026-05-06T02:02:55.544Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PEPE on mainnet (FDV cannot be computed) |
| 2026-05-06T02:02:56.102Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 2 rows but only 1 distinct datetimes for pool 0x5ab53ee1d50eef2c1dd3d5402789cd27bb52c1bb |
| 2026-05-06T02:02:56.245Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 2 rows but only 1 distinct datetimes for pool 0xa3f558aebaecaf0e11ca4b2199cc5ed341edfd74 |
| 2026-05-06T02:02:56.446Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for USDC on mainnet (FDV cannot be computed) |
| 2026-05-06T02:02:56.658Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 2 rows but only 1 distinct datetimes for pool 0xe8c6c9227491c0a8156a0106a0204d881bb7e531 |
| 2026-05-06T02:02:56.847Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for stETH on mainnet (FDV cannot be computed) |
| 2026-05-06T02:02:56.848Z | `TOKEN_API_MISSING_ICON` | icon missing for stETH on mainnet |
| 2026-05-06T02:02:56.881Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for UNI on mainnet (FDV cannot be computed) |
| 2026-05-06T02:02:56.942Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 2 rows but only 1 distinct datetimes for pool 0x11950d141ecb863f01007add7d1a342041227b58 |
| 2026-05-06T02:02:56.995Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 2 rows but only 1 distinct datetimes for pool 0x99ac8ca7087fa4a2a1fb6357269965a2014abc35 |
| 2026-05-06T02:02:57.416Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LINK on mainnet (FDV cannot be computed) |
| 2026-05-06T02:02:57.886Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 2 rows but only 1 distinct datetimes for pool 0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8 |
| 2026-05-06T02:02:57.890Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 2 rows but only 1 distinct datetimes for pool 0x1d42064fc4beb5f8aaf85f4617ae8b3b5b8bd801 |
| 2026-05-06T02:07:58.337Z | `TOKEN_API_MISSING_NAME` | name is null/empty for MKR on mainnet (contract 0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2) |
| 2026-05-06T02:08:02.782Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WETH on mainnet (FDV cannot be computed) |
| 2026-05-06T02:09:41.906Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x99ac8ca7087fa4a2a1fb6357269965a2014abc35 |
| 2026-05-06T02:09:42.142Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x92560c178ce069cc014138ed3c2f5221ba71f58a |
| 2026-05-06T02:09:42.144Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8 |
| 2026-05-06T02:09:42.146Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x1d42064fc4beb5f8aaf85f4617ae8b3b5b8bd801 |
| 2026-05-06T02:09:43.379Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-06T02:09:43.928Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0xa3f558aebaecaf0e11ca4b2199cc5ed341edfd74 |
| 2026-05-06T02:09:44.353Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xea4ba4ce14fdd287f380b55419b1c5b6c3f22ab6 |
| 2026-05-06T02:09:44.566Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x4c83a7f819a5c37d64b4c5a2f8238ea082fa1f4e |
| 2026-05-06T02:09:44.568Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x0e2c4be9f3408e5b1ff631576d946eb8c224b5ed |
| 2026-05-06T02:09:44.569Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xe8c6c9227491c0a8156a0106a0204d881bb7e531 |
| 2026-05-06T02:09:44.576Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x5ab53ee1d50eef2c1dd3d5402789cd27bb52c1bb |
| 2026-05-06T02:09:44.761Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x11950d141ecb863f01007add7d1a342041227b58 |
| 2026-05-06T02:11:14.763Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 31 rows but only 8 distinct datetimes for pool 0x0e2c4be9f3408e5b1ff631576d946eb8c224b5ed |
| 2026-05-06T02:15:03.453Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): GRT |
| 2026-05-06T02:15:44.877Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 31 rows but only 8 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-06T02:15:44.879Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): USDC |
| 2026-05-06T02:16:16.202Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 31 rows but only 16 distinct datetimes for pool 0x11950d141ecb863f01007add7d1a342041227b58 |
| 2026-05-06T02:16:16.203Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): PEPE |
| 2026-05-06T02:17:25.347Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 31 rows but only 8 distinct datetimes for pool 0xa3f558aebaecaf0e11ca4b2199cc5ed341edfd74 |
| 2026-05-06T02:17:25.348Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): LDO |
| 2026-05-06T10:30:25.563Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 2 rows but only 1 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-06T10:30:26.353Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GRT on mainnet (FDV cannot be computed) |
| 2026-05-06T10:30:26.666Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x0e2c4be9f3408e5b1ff631576d946eb8c224b5ed |
| 2026-05-06T10:32:59.211Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x0e2c4be9f3408e5b1ff631576d946eb8c224b5ed |
| 2026-05-06T10:32:59.369Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 90 rows but only 23 distinct datetimes for pool 0x0e2c4be9f3408e5b1ff631576d946eb8c224b5ed |
| 2026-05-06T10:32:59.370Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): GRT |
| 2026-05-06T10:33:27.554Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PEPE on mainnet (FDV cannot be computed) |
| 2026-05-06T10:33:27.613Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LINK on mainnet (FDV cannot be computed) |
| 2026-05-06T10:33:27.767Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WBTC on mainnet (FDV cannot be computed) |
| 2026-05-06T10:33:27.796Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for  on mainnet (FDV cannot be computed) |
| 2026-05-06T10:33:27.797Z | `TOKEN_API_MISSING_ICON` | icon missing for  on mainnet |
| 2026-05-06T10:33:27.859Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for UNI on mainnet (FDV cannot be computed) |
| 2026-05-06T10:33:27.914Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x11950d141ecb863f01007add7d1a342041227b58 |
| 2026-05-06T10:33:28.043Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LDO on mainnet (FDV cannot be computed) |
| 2026-05-06T10:33:28.062Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8 |
| 2026-05-06T10:33:28.096Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ENS on mainnet (FDV cannot be computed) |
| 2026-05-06T10:33:28.164Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xe8c6c9227491c0a8156a0106a0204d881bb7e531 |
| 2026-05-06T10:33:28.164Z | `TOKEN_API_MISSING_NAME` | name is null/empty for MKR on mainnet (contract 0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2) |
| 2026-05-06T10:33:28.347Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for CRV on mainnet (FDV cannot be computed) |
| 2026-05-06T10:33:28.556Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x4c83a7f819a5c37d64b4c5a2f8238ea082fa1f4e |
| 2026-05-06T10:33:28.590Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x99ac8ca7087fa4a2a1fb6357269965a2014abc35 |
| 2026-05-06T10:33:28.691Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x1d42064fc4beb5f8aaf85f4617ae8b3b5b8bd801 |
| 2026-05-06T10:33:28.796Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0xa3f558aebaecaf0e11ca4b2199cc5ed341edfd74 |
| 2026-05-06T10:33:28.830Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for COMP on mainnet (FDV cannot be computed) |
| 2026-05-06T10:33:28.836Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for AAVE on mainnet (FDV cannot be computed) |
| 2026-05-06T10:33:28.854Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x92560c178ce069cc014138ed3c2f5221ba71f58a |
| 2026-05-06T10:33:31.117Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x5ab53ee1d50eef2c1dd3d5402789cd27bb52c1bb |
| 2026-05-06T10:33:31.215Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xea4ba4ce14fdd287f380b55419b1c5b6c3f22ab6 |
| 2026-05-06T10:33:32.944Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WETH on mainnet (FDV cannot be computed) |
| 2026-05-06T10:33:34.836Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for USDC on mainnet (FDV cannot be computed) |
| 2026-05-06T10:33:35.679Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-06T10:33:45.565Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 90 rows but only 45 distinct datetimes for pool 0x11950d141ecb863f01007add7d1a342041227b58 |
| 2026-05-06T10:33:45.925Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x11950d141ecb863f01007add7d1a342041227b58 |
| 2026-05-06T10:33:45.926Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): PEPE |
| 2026-05-06T10:42:29.791Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-06T10:42:30.268Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 90 rows but only 23 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-06T10:42:32.096Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): USDC |
| 2026-05-06T10:49:55.092Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 2 rows but only 1 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-06T10:49:55.224Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GRT on mainnet (FDV cannot be computed) |
| 2026-05-06T10:49:55.264Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x0e2c4be9f3408e5b1ff631576d946eb8c224b5ed |
| 2026-05-06T10:49:55.272Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x0e2c4be9f3408e5b1ff631576d946eb8c224b5ed |
| 2026-05-06T10:49:55.378Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 90 rows but only 23 distinct datetimes for pool 0x0e2c4be9f3408e5b1ff631576d946eb8c224b5ed |
| 2026-05-06T10:49:57.013Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): GRT |
| 2026-05-06T10:49:57.014Z | `TOKEN_API_POOLS_FILTER_LEAKS` | pools?input_token=0xc944e90c returned 5 unrelated pools (filter not enforced server-side) |
| 2026-05-06T10:51:30.566Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LDO on mainnet (FDV cannot be computed) |
| 2026-05-06T10:51:30.641Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ENS on mainnet (FDV cannot be computed) |
| 2026-05-06T10:51:30.783Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for AAVE on mainnet (FDV cannot be computed) |
| 2026-05-06T10:51:30.791Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for UNI on mainnet (FDV cannot be computed) |
| 2026-05-06T10:51:31.061Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0xa3f558aebaecaf0e11ca4b2199cc5ed341edfd74 |
| 2026-05-06T10:51:31.160Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x92560c178ce069cc014138ed3c2f5221ba71f58a |
| 2026-05-06T10:51:31.309Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x5ab53ee1d50eef2c1dd3d5402789cd27bb52c1bb |
| 2026-05-06T10:51:31.328Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x1d42064fc4beb5f8aaf85f4617ae8b3b5b8bd801 |
| 2026-05-06T10:51:31.402Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for COMP on mainnet (FDV cannot be computed) |
| 2026-05-06T10:51:31.543Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for CRV on mainnet (FDV cannot be computed) |
| 2026-05-06T10:51:31.557Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WBTC on mainnet (FDV cannot be computed) |
| 2026-05-06T10:51:31.584Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PEPE on mainnet (FDV cannot be computed) |
| 2026-05-06T10:51:31.821Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for  on mainnet (FDV cannot be computed) |
| 2026-05-06T10:51:31.821Z | `TOKEN_API_MISSING_ICON` | icon missing for  on mainnet |
| 2026-05-06T10:51:31.827Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xea4ba4ce14fdd287f380b55419b1c5b6c3f22ab6 |
| 2026-05-06T10:51:32.076Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x4c83a7f819a5c37d64b4c5a2f8238ea082fa1f4e |
| 2026-05-06T10:51:32.221Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x11950d141ecb863f01007add7d1a342041227b58 |
| 2026-05-06T10:51:32.236Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WETH on mainnet (FDV cannot be computed) |
| 2026-05-06T10:51:32.350Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LINK on mainnet (FDV cannot be computed) |
| 2026-05-06T10:51:32.750Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x99ac8ca7087fa4a2a1fb6357269965a2014abc35 |
| 2026-05-06T10:51:32.880Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xe8c6c9227491c0a8156a0106a0204d881bb7e531 |
| 2026-05-06T10:51:32.880Z | `TOKEN_API_MISSING_NAME` | name is null/empty for MKR on mainnet (contract 0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2) |
| 2026-05-06T10:51:33.071Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8 |
| 2026-05-06T10:51:34.174Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-06T10:51:35.855Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for USDC on mainnet (FDV cannot be computed) |
| 2026-05-06T10:51:43.321Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8 |
| 2026-05-06T10:51:43.597Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 90 rows but only 23 distinct datetimes for pool 0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8 |
| 2026-05-06T10:51:45.704Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): LINK |
| 2026-05-06T10:51:45.705Z | `TOKEN_API_POOLS_FILTER_LEAKS` | pools?input_token=0x51491077 returned 3 unrelated pools (filter not enforced server-side) |
| 2026-05-06T15:17:42.694Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 2 rows but only 1 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-06T15:17:42.843Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-06T15:17:42.849Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for USDC on mainnet (FDV cannot be computed) |
| 2026-05-06T15:17:42.849Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GRT on mainnet (FDV cannot be computed) |
| 2026-05-06T15:17:42.850Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x1d42064fc4beb5f8aaf85f4617ae8b3b5b8bd801 |
| 2026-05-06T15:17:42.852Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LINK on mainnet (FDV cannot be computed) |
| 2026-05-06T15:17:42.857Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for UNI on mainnet (FDV cannot be computed) |
| 2026-05-06T15:17:42.858Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8 |
| 2026-05-06T15:17:42.858Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x99ac8ca7087fa4a2a1fb6357269965a2014abc35 |
| 2026-05-06T15:17:42.859Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x5ab53ee1d50eef2c1dd3d5402789cd27bb52c1bb |
| 2026-05-06T15:17:42.860Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for AAVE on mainnet (FDV cannot be computed) |
| 2026-05-06T15:17:42.861Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0xa3f558aebaecaf0e11ca4b2199cc5ed341edfd74 |
| 2026-05-06T15:17:42.863Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for  on mainnet (FDV cannot be computed) |
| 2026-05-06T15:17:42.863Z | `TOKEN_API_MISSING_ICON` | icon missing for  on mainnet |
| 2026-05-06T15:17:42.864Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x11950d141ecb863f01007add7d1a342041227b58 |
| 2026-05-06T15:17:42.865Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xe8c6c9227491c0a8156a0106a0204d881bb7e531 |
| 2026-05-06T15:17:42.867Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x92560c178ce069cc014138ed3c2f5221ba71f58a |
| 2026-05-06T15:17:42.867Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for COMP on mainnet (FDV cannot be computed) |
| 2026-05-06T15:17:42.868Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ENS on mainnet (FDV cannot be computed) |
| 2026-05-06T15:17:42.869Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for CRV on mainnet (FDV cannot be computed) |
| 2026-05-06T15:17:42.873Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xea4ba4ce14fdd287f380b55419b1c5b6c3f22ab6 |
| 2026-05-06T15:17:42.876Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x0e2c4be9f3408e5b1ff631576d946eb8c224b5ed |
| 2026-05-06T15:17:42.880Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LDO on mainnet (FDV cannot be computed) |
| 2026-05-06T15:17:42.883Z | `TOKEN_API_MISSING_NAME` | name is null/empty for MKR on mainnet (contract 0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2) |
| 2026-05-06T15:17:42.894Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x4c83a7f819a5c37d64b4c5a2f8238ea082fa1f4e |
| 2026-05-06T15:17:43.320Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WBTC on mainnet (FDV cannot be computed) |
| 2026-05-06T15:17:50.774Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PEPE on mainnet (FDV cannot be computed) |
| 2026-05-06T15:20:26.657Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 2 rows but only 1 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-06T15:20:26.807Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-06T15:20:26.813Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GRT on mainnet (FDV cannot be computed) |
| 2026-05-06T15:20:26.816Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8 |
| 2026-05-06T15:20:26.818Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for UNI on mainnet (FDV cannot be computed) |
| 2026-05-06T15:20:26.819Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WBTC on mainnet (FDV cannot be computed) |
| 2026-05-06T15:20:26.819Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x0e2c4be9f3408e5b1ff631576d946eb8c224b5ed |
| 2026-05-06T15:20:26.820Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x1d42064fc4beb5f8aaf85f4617ae8b3b5b8bd801 |
| 2026-05-06T15:20:26.821Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LDO on mainnet (FDV cannot be computed) |
| 2026-05-06T15:20:26.824Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for AAVE on mainnet (FDV cannot be computed) |
| 2026-05-06T15:20:26.825Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x99ac8ca7087fa4a2a1fb6357269965a2014abc35 |
| 2026-05-06T15:20:26.826Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0xa3f558aebaecaf0e11ca4b2199cc5ed341edfd74 |
| 2026-05-06T15:20:26.829Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xe8c6c9227491c0a8156a0106a0204d881bb7e531 |
| 2026-05-06T15:20:26.830Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for  on mainnet (FDV cannot be computed) |
| 2026-05-06T15:20:26.831Z | `TOKEN_API_MISSING_ICON` | icon missing for  on mainnet |
| 2026-05-06T15:20:26.832Z | `TOKEN_API_MISSING_NAME` | name is null/empty for MKR on mainnet (contract 0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2) |
| 2026-05-06T15:20:26.833Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LINK on mainnet (FDV cannot be computed) |
| 2026-05-06T15:20:26.834Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x11950d141ecb863f01007add7d1a342041227b58 |
| 2026-05-06T15:20:26.836Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x4c83a7f819a5c37d64b4c5a2f8238ea082fa1f4e |
| 2026-05-06T15:20:26.837Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x92560c178ce069cc014138ed3c2f5221ba71f58a |
| 2026-05-06T15:20:26.838Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for CRV on mainnet (FDV cannot be computed) |
| 2026-05-06T15:20:26.839Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PEPE on mainnet (FDV cannot be computed) |
| 2026-05-06T15:20:26.841Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for COMP on mainnet (FDV cannot be computed) |
| 2026-05-06T15:20:26.842Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x5ab53ee1d50eef2c1dd3d5402789cd27bb52c1bb |
| 2026-05-06T15:20:26.844Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for USDC on mainnet (FDV cannot be computed) |
| 2026-05-06T15:20:26.850Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xea4ba4ce14fdd287f380b55419b1c5b6c3f22ab6 |
| 2026-05-06T15:20:26.852Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ENS on mainnet (FDV cannot be computed) |
| 2026-05-06T15:20:29.752Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WETH on mainnet (FDV cannot be computed) |
| 2026-05-06T15:23:58.077Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x99ac8ca7087fa4a2a1fb6357269965a2014abc35 |
| 2026-05-06T15:23:58.082Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8 |
| 2026-05-06T15:23:58.121Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xea4ba4ce14fdd287f380b55419b1c5b6c3f22ab6 |
| 2026-05-06T15:23:58.132Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x0e2c4be9f3408e5b1ff631576d946eb8c224b5ed |
| 2026-05-06T15:23:58.144Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x92560c178ce069cc014138ed3c2f5221ba71f58a |
| 2026-05-06T15:23:58.242Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xe8c6c9227491c0a8156a0106a0204d881bb7e531 |
| 2026-05-06T15:23:58.320Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x1d42064fc4beb5f8aaf85f4617ae8b3b5b8bd801 |
| 2026-05-06T15:23:58.355Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x11950d141ecb863f01007add7d1a342041227b58 |
| 2026-05-06T15:23:58.356Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x4c83a7f819a5c37d64b4c5a2f8238ea082fa1f4e |
| 2026-05-06T15:23:58.356Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xa3f558aebaecaf0e11ca4b2199cc5ed341edfd74 |
| 2026-05-06T15:23:58.357Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x5ab53ee1d50eef2c1dd3d5402789cd27bb52c1bb |
| 2026-05-06T15:23:59.709Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-06T15:28:33.513Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 2 rows but only 1 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-06T15:28:33.728Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x0e2c4be9f3408e5b1ff631576d946eb8c224b5ed |
| 2026-05-06T15:28:33.739Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xe8c6c9227491c0a8156a0106a0204d881bb7e531 |
| 2026-05-06T15:28:33.745Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x92560c178ce069cc014138ed3c2f5221ba71f58a |
| 2026-05-06T15:28:33.768Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xea4ba4ce14fdd287f380b55419b1c5b6c3f22ab6 |
| 2026-05-06T15:28:33.814Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x1d42064fc4beb5f8aaf85f4617ae8b3b5b8bd801 |
| 2026-05-06T15:28:33.815Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8 |
| 2026-05-06T15:28:33.819Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x4c83a7f819a5c37d64b4c5a2f8238ea082fa1f4e |
| 2026-05-06T15:28:33.831Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WETH on mainnet (FDV cannot be computed) |
| 2026-05-06T15:28:33.872Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x99ac8ca7087fa4a2a1fb6357269965a2014abc35 |
| 2026-05-06T15:28:33.874Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-06T15:28:33.875Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xa3f558aebaecaf0e11ca4b2199cc5ed341edfd74 |
| 2026-05-06T15:28:33.877Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x5ab53ee1d50eef2c1dd3d5402789cd27bb52c1bb |
| 2026-05-06T15:28:33.879Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x11950d141ecb863f01007add7d1a342041227b58 |
| 2026-05-06T15:28:34.538Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GRT on mainnet (FDV cannot be computed) |
| 2026-05-06T15:28:34.555Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for  on mainnet (FDV cannot be computed) |
| 2026-05-06T15:28:34.555Z | `TOKEN_API_MISSING_ICON` | icon missing for  on mainnet |
| 2026-05-06T15:28:34.556Z | `TOKEN_API_MISSING_NAME` | name is null/empty for MKR on mainnet (contract 0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2) |
| 2026-05-06T15:28:34.557Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for COMP on mainnet (FDV cannot be computed) |
| 2026-05-06T15:28:34.662Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for UNI on mainnet (FDV cannot be computed) |
| 2026-05-06T15:28:34.919Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LINK on mainnet (FDV cannot be computed) |
| 2026-05-06T15:28:35.154Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ENS on mainnet (FDV cannot be computed) |
| 2026-05-06T15:28:35.211Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for CRV on mainnet (FDV cannot be computed) |
| 2026-05-06T15:28:35.324Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LDO on mainnet (FDV cannot be computed) |
| 2026-05-06T15:28:35.400Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for AAVE on mainnet (FDV cannot be computed) |
| 2026-05-06T15:28:35.491Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WBTC on mainnet (FDV cannot be computed) |
| 2026-05-06T15:28:35.668Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PEPE on mainnet (FDV cannot be computed) |
| 2026-05-06T15:28:41.859Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for USDC on mainnet (FDV cannot be computed) |
| 2026-05-06T15:33:08.484Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x5777d92f208679db4b9778590fa3cab3ac9e2168 |
| 2026-05-06T15:54:17.956Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 90 rows but only 45 distinct datetimes for pool 0xe8c6c9227491c0a8156a0106a0204d881bb7e531 |
| 2026-05-06T15:54:19.187Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): MKR |
| 2026-05-06T15:54:19.188Z | `TOKEN_API_POOLS_FILTER_LEAKS` | pools?input_token=0x9f8f72aa returned 5 unrelated pools (filter not enforced server-side) |
| 2026-05-06T15:55:09.663Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xbe80225f09645f172b079394312220637c440a63 |
| 2026-05-06T15:55:09.740Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xeed4603bc333ef406e5eb691ba66798d5c857d8b |
| 2026-05-06T15:55:09.742Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xd8de6af55f618a7bc69835d55ddc6582220c36c0 |
| 2026-05-06T15:55:09.906Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x7a415b19932c0105c82fdb6b720bb01b0cc2cae3 |
| 2026-05-06T15:55:09.924Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xe41552e6212cb6f7faa381c7bc9434c58bf28ce1 |
| 2026-05-06T15:55:09.942Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xf56d08221b5942c428acc5de8f78489a97fc5599 |
| 2026-05-06T15:55:09.943Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xad6b651df72b443f57b76ff79165ee771272e18e |
| 2026-05-06T15:55:09.957Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x8661ae7918c0115af9e3691662f605e9c550ddc9 |
| 2026-05-06T15:55:09.998Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x9febc984504356225405e26833608b17719c82ae |
| 2026-05-06T15:55:10.012Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x8592064903ef23d34e4d5aaaed40abf6d96af186 |
| 2026-05-06T15:55:10.021Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x73ea3d8ba3d7380201b270ec504b33ed5e478542 |
| 2026-05-06T15:55:10.117Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x840deeef2f115cf50da625f7368c24af6fe74410 |
| 2026-05-06T15:55:10.129Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xcd8286b48936cdac20518247dbd310ab681a9fbf |
| 2026-05-06T15:55:10.150Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xe42318ea3b998e8355a3da364eb9d48ec725eb45 |
| 2026-05-06T15:55:10.167Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xdc2c21f1b54ddaf39e944689a8f90cb844135cc9 |
| 2026-05-06T15:55:10.193Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x3019d4e366576a88d28b623afaf3ecb9ec9d9580 |
| 2026-05-06T15:55:10.227Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x841820459769cd629b10a36fd12e603938cc2679 |
| 2026-05-06T15:55:10.232Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xede8dd046586d22625ae7ff2708f879ef7bdb8cf |
| 2026-05-06T15:55:10.272Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x5b97b125cf8af96834f2d08c8f1291bd47724939 |
| 2026-05-06T15:55:10.381Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 96 rows but only 48 distinct datetimes for pool 0x9188d6690a84023ccfb712f409376587ee3b6b63 |
| 2026-05-06T15:55:10.399Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x5764a6f2212d502bc5970f9f129ffcd61e5d7563 |
| 2026-05-06T15:55:10.416Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x13394005c1012e708fce1eb974f1130fdc73a5ce |
| 2026-05-06T15:55:10.430Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x57af956d3e2cca3b86f3d8c6772c03ddca3eaacb |
| 2026-05-06T15:55:10.548Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x59354356ec5d56306791873f567d61ebf11dfbd5 |
| 2026-05-06T15:55:10.571Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x109830a1aaad605bbf02a9dfa7b0b92ec2fb7daa |
| 2026-05-06T15:55:10.595Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x73a6a761fe483ba19debb8f56ac5bbf14c0cdad1 |
| 2026-05-06T15:55:10.624Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xae614a7a56cb79c04df2aeba6f5dab80a39ca78e |
| 2026-05-06T15:55:10.665Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x553e9c493678d8606d6a5ba284643db2110df823 |
| 2026-05-06T15:55:10.715Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x000ba527862e5b82cff0f7c66b646af023274aa1 |
| 2026-05-06T15:55:10.797Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x4e68ccd3e89f51c3074ca5072bbac773960dfa36 |
| 2026-05-06T15:55:10.806Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x290a6a7460b308ee3f19023d2d00de604bcf5b42 |
| 2026-05-06T15:55:10.840Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x06f00544c0bc62e6db10f46d370dfccdc23d8189 |
| 2026-05-06T15:55:10.843Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for BICO on mainnet (FDV cannot be computed) |
| 2026-05-06T15:55:10.843Z | `TOKEN_API_MISSING_ICON` | icon missing for BICO on mainnet |
| 2026-05-06T15:55:10.868Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xc2e9f25be6257c210d7adf0d4cd6e3e881ba25f8 |
| 2026-05-06T15:55:10.880Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0xc63b0708e2f7e69cb8a1df0e1389a98c35a76d52 |
| 2026-05-06T15:55:10.967Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xfd76be67fff3bac84e3d5444167bbc018f5968b6 |
| 2026-05-06T15:55:10.987Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xac4b3dacb91461209ae9d41ec517c2b9cb1b7daf |
| 2026-05-06T15:55:11.028Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xc3db44adc1fcdfd5671f555236eae49f4a8eea18 |
| 2026-05-06T15:55:11.080Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x4e0924d3a751be199c426d52fb1f2337fa96f736 |
| 2026-05-06T15:55:11.099Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for RPL on mainnet (FDV cannot be computed) |
| 2026-05-06T15:55:11.210Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ezETH on mainnet (FDV cannot be computed) |
| 2026-05-06T15:55:11.210Z | `TOKEN_API_MISSING_ICON` | icon missing for ezETH on mainnet |
| 2026-05-06T15:55:11.213Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SAFE on mainnet (FDV cannot be computed) |
| 2026-05-06T15:55:11.224Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FRAX on mainnet (FDV cannot be computed) |
| 2026-05-06T15:55:11.452Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ARB on mainnet (FDV cannot be computed) |
| 2026-05-06T15:55:11.455Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GNO on mainnet (FDV cannot be computed) |
| 2026-05-06T15:55:11.456Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for DYDX on mainnet (FDV cannot be computed) |
| 2026-05-06T15:55:11.457Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FDUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T15:55:11.465Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for IMX on mainnet (FDV cannot be computed) |
| 2026-05-06T15:55:11.476Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WLD on mainnet (FDV cannot be computed) |
| 2026-05-06T15:55:11.477Z | `TOKEN_API_MISSING_ICON` | icon missing for WLD on mainnet |
| 2026-05-06T15:55:11.491Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PENDLE on mainnet (FDV cannot be computed) |
| 2026-05-06T15:55:11.530Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for weETH on mainnet (FDV cannot be computed) |
| 2026-05-06T15:55:11.530Z | `TOKEN_API_MISSING_ICON` | icon missing for weETH on mainnet |
| 2026-05-06T15:55:11.552Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FLOKI on mainnet (FDV cannot be computed) |
| 2026-05-06T15:55:11.552Z | `TOKEN_API_MISSING_ICON` | icon missing for FLOKI on mainnet |
| 2026-05-06T15:55:11.589Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for CRVUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T15:55:11.603Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T15:55:11.657Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for 1INCH on mainnet (FDV cannot be computed) |
| 2026-05-06T15:55:11.663Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for rETH on mainnet (FDV cannot be computed) |
| 2026-05-06T15:55:11.751Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for cbETH on mainnet (FDV cannot be computed) |
| 2026-05-06T15:55:11.828Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ETHFI on mainnet (FDV cannot be computed) |
| 2026-05-06T15:55:11.829Z | `TOKEN_API_MISSING_ICON` | icon missing for ETHFI on mainnet |
| 2026-05-06T15:55:11.852Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SNX on mainnet (FDV cannot be computed) |
| 2026-05-06T15:55:11.897Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SUSHI on mainnet (FDV cannot be computed) |
| 2026-05-06T15:55:11.934Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ENA on mainnet (FDV cannot be computed) |
| 2026-05-06T15:55:11.935Z | `TOKEN_API_MISSING_ICON` | icon missing for ENA on mainnet |
| 2026-05-06T15:55:11.999Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PYUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T15:55:12.000Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for APE on mainnet (FDV cannot be computed) |
| 2026-05-06T15:55:12.002Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for AXS on mainnet (FDV cannot be computed) |
| 2026-05-06T15:55:12.036Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for wstETH on mainnet (FDV cannot be computed) |
| 2026-05-06T15:55:12.036Z | `TOKEN_API_MISSING_ICON` | icon missing for wstETH on mainnet |
| 2026-05-06T15:55:12.187Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SAND on mainnet (FDV cannot be computed) |
| 2026-05-06T15:55:12.200Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for sfrxETH on mainnet (FDV cannot be computed) |
| 2026-05-06T15:55:12.457Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for BAL on mainnet (FDV cannot be computed) |
| 2026-05-06T15:55:12.458Z | `TOKEN_API_MISSING_ICON` | icon missing for BAL on mainnet |
| 2026-05-06T15:55:12.537Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for MANA on mainnet (FDV cannot be computed) |
| 2026-05-06T15:55:12.584Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for STG on mainnet (FDV cannot be computed) |
| 2026-05-06T15:55:12.619Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for BAT on mainnet (FDV cannot be computed) |
| 2026-05-06T15:55:13.166Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for MATIC on mainnet (FDV cannot be computed) |
| 2026-05-06T15:55:13.900Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for DAI on mainnet (FDV cannot be computed) |
| 2026-05-06T15:55:13.991Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SHIB on mainnet (FDV cannot be computed) |
| 2026-05-06T16:11:26.437Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for USDT on mainnet (FDV cannot be computed) |
| 2026-05-06T16:20:14.483Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GHO on mainnet (FDV cannot be computed) |
| 2026-05-06T16:22:06.088Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 90 rows but only 23 distinct datetimes for pool 0x4e68ccd3e89f51c3074ca5072bbac773960dfa36 |
| 2026-05-06T16:22:14.821Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): USDT |
| 2026-05-06T16:22:53.653Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 90 rows but only 45 distinct datetimes for pool 0x59354356ec5d56306791873f567d61ebf11dfbd5 |
| 2026-05-06T16:22:56.525Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): ARB |
| 2026-05-06T16:22:56.525Z | `TOKEN_API_POOLS_FILTER_LEAKS` | pools?input_token=0xb50721bc returned 3 unrelated pools (filter not enforced server-side) |
| 2026-05-06T16:23:56.635Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x5c95d4b1c3321cf898d25949f41d50be2db5bc1d |
| 2026-05-06T16:32:00.863Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 90 rows but only 23 distinct datetimes for pool 0x13394005c1012e708fce1eb974f1130fdc73a5ce |
| 2026-05-06T16:32:03.026Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): PYUSD |
| 2026-05-06T16:32:03.027Z | `TOKEN_API_POOLS_FILTER_LEAKS` | pools?input_token=0x6c3ea903 returned 3 unrelated pools (filter not enforced server-side) |
| 2026-05-06T16:40:54.123Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 2 rows but only 1 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-06T16:40:54.361Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 90 rows but only 23 distinct datetimes for pool 0x13394005c1012e708fce1eb974f1130fdc73a5ce |
| 2026-05-06T16:40:54.405Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x13394005c1012e708fce1eb974f1130fdc73a5ce |
| 2026-05-06T16:40:55.205Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PYUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T16:40:56.632Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): PYUSD |
| 2026-05-06T16:40:56.633Z | `TOKEN_API_POOLS_FILTER_LEAKS` | pools?input_token=0x6c3ea903 returned 3 unrelated pools (filter not enforced server-side) |
| 2026-05-06T16:42:00.545Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 2 rows but only 1 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-06T16:42:00.915Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x13394005c1012e708fce1eb974f1130fdc73a5ce |
| 2026-05-06T16:42:01.316Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PYUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:01.487Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x840deeef2f115cf50da625f7368c24af6fe74410 |
| 2026-05-06T16:42:01.511Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x553e9c493678d8606d6a5ba284643db2110df823 |
| 2026-05-06T16:42:01.573Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xe8c6c9227491c0a8156a0106a0204d881bb7e531 |
| 2026-05-06T16:42:01.606Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x1d42064fc4beb5f8aaf85f4617ae8b3b5b8bd801 |
| 2026-05-06T16:42:01.710Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x11950d141ecb863f01007add7d1a342041227b58 |
| 2026-05-06T16:42:01.944Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x4e68ccd3e89f51c3074ca5072bbac773960dfa36 |
| 2026-05-06T16:42:02.344Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GNO on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:02.391Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0xc63b0708e2f7e69cb8a1df0e1389a98c35a76d52 |
| 2026-05-06T16:42:02.490Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for CRVUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:02.500Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x109830a1aaad605bbf02a9dfa7b0b92ec2fb7daa |
| 2026-05-06T16:42:02.543Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SUSHI on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:02.544Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for BAL on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:02.545Z | `TOKEN_API_MISSING_ICON` | icon missing for BAL on mainnet |
| 2026-05-06T16:42:02.565Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FLOKI on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:02.565Z | `TOKEN_API_MISSING_ICON` | icon missing for FLOKI on mainnet |
| 2026-05-06T16:42:02.591Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ETHFI on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:02.592Z | `TOKEN_API_MISSING_ICON` | icon missing for ETHFI on mainnet |
| 2026-05-06T16:42:02.627Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for 1INCH on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:02.715Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for COMP on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:02.736Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for UNI on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:02.916Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PEPE on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:04.229Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xeed4603bc333ef406e5eb691ba66798d5c857d8b |
| 2026-05-06T16:42:04.327Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x8592064903ef23d34e4d5aaaed40abf6d96af186 |
| 2026-05-06T16:42:04.493Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x5b97b125cf8af96834f2d08c8f1291bd47724939 |
| 2026-05-06T16:42:04.533Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x9febc984504356225405e26833608b17719c82ae |
| 2026-05-06T16:42:04.742Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xea4ba4ce14fdd287f380b55419b1c5b6c3f22ab6 |
| 2026-05-06T16:42:04.758Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x73a6a761fe483ba19debb8f56ac5bbf14c0cdad1 |
| 2026-05-06T16:42:04.849Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x4c83a7f819a5c37d64b4c5a2f8238ea082fa1f4e |
| 2026-05-06T16:42:04.850Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xdc2c21f1b54ddaf39e944689a8f90cb844135cc9 |
| 2026-05-06T16:42:04.854Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xbe80225f09645f172b079394312220637c440a63 |
| 2026-05-06T16:42:04.857Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xd8de6af55f618a7bc69835d55ddc6582220c36c0 |
| 2026-05-06T16:42:04.865Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x7a415b19932c0105c82fdb6b720bb01b0cc2cae3 |
| 2026-05-06T16:42:04.875Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xc3db44adc1fcdfd5671f555236eae49f4a8eea18 |
| 2026-05-06T16:42:04.900Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xede8dd046586d22625ae7ff2708f879ef7bdb8cf |
| 2026-05-06T16:42:04.988Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xe41552e6212cb6f7faa381c7bc9434c58bf28ce1 |
| 2026-05-06T16:42:05.013Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x59354356ec5d56306791873f567d61ebf11dfbd5 |
| 2026-05-06T16:42:05.014Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x4e0924d3a751be199c426d52fb1f2337fa96f736 |
| 2026-05-06T16:42:05.092Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x57af956d3e2cca3b86f3d8c6772c03ddca3eaacb |
| 2026-05-06T16:42:05.114Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 96 rows but only 48 distinct datetimes for pool 0x9188d6690a84023ccfb712f409376587ee3b6b63 |
| 2026-05-06T16:42:05.115Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x3019d4e366576a88d28b623afaf3ecb9ec9d9580 |
| 2026-05-06T16:42:05.167Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xac4b3dacb91461209ae9d41ec517c2b9cb1b7daf |
| 2026-05-06T16:42:05.233Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xa3f558aebaecaf0e11ca4b2199cc5ed341edfd74 |
| 2026-05-06T16:42:05.248Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x73ea3d8ba3d7380201b270ec504b33ed5e478542 |
| 2026-05-06T16:42:05.266Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xcd8286b48936cdac20518247dbd310ab681a9fbf |
| 2026-05-06T16:42:05.281Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x99ac8ca7087fa4a2a1fb6357269965a2014abc35 |
| 2026-05-06T16:42:05.292Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x8661ae7918c0115af9e3691662f605e9c550ddc9 |
| 2026-05-06T16:42:05.299Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x000ba527862e5b82cff0f7c66b646af023274aa1 |
| 2026-05-06T16:42:05.301Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x5777d92f208679db4b9778590fa3cab3ac9e2168 |
| 2026-05-06T16:42:05.307Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x5c95d4b1c3321cf898d25949f41d50be2db5bc1d |
| 2026-05-06T16:42:05.351Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xae614a7a56cb79c04df2aeba6f5dab80a39ca78e |
| 2026-05-06T16:42:05.385Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xf56d08221b5942c428acc5de8f78489a97fc5599 |
| 2026-05-06T16:42:05.433Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8 |
| 2026-05-06T16:42:05.475Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x841820459769cd629b10a36fd12e603938cc2679 |
| 2026-05-06T16:42:05.477Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x290a6a7460b308ee3f19023d2d00de604bcf5b42 |
| 2026-05-06T16:42:05.478Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x5764a6f2212d502bc5970f9f129ffcd61e5d7563 |
| 2026-05-06T16:42:05.479Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x0e2c4be9f3408e5b1ff631576d946eb8c224b5ed |
| 2026-05-06T16:42:05.542Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xc2e9f25be6257c210d7adf0d4cd6e3e881ba25f8 |
| 2026-05-06T16:42:05.604Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xfd76be67fff3bac84e3d5444167bbc018f5968b6 |
| 2026-05-06T16:42:05.619Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x92560c178ce069cc014138ed3c2f5221ba71f58a |
| 2026-05-06T16:42:05.623Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xe42318ea3b998e8355a3da364eb9d48ec725eb45 |
| 2026-05-06T16:42:05.903Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x5ab53ee1d50eef2c1dd3d5402789cd27bb52c1bb |
| 2026-05-06T16:42:05.904Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x06f00544c0bc62e6db10f46d370dfccdc23d8189 |
| 2026-05-06T16:42:05.965Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for rETH on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:06.205Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ezETH on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:06.205Z | `TOKEN_API_MISSING_ICON` | icon missing for ezETH on mainnet |
| 2026-05-06T16:42:06.206Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for RPL on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:06.220Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for IMX on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:06.353Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SAFE on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:06.404Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FRAX on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:06.432Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GHO on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:06.453Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for DYDX on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:06.594Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PENDLE on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:06.678Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LDO on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:06.696Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for STG on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:06.705Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:06.710Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for cbETH on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:06.713Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ENS on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:06.805Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for sfrxETH on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:06.864Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WLD on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:06.864Z | `TOKEN_API_MISSING_ICON` | icon missing for WLD on mainnet |
| 2026-05-06T16:42:06.898Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FDUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:06.987Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ENA on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:06.987Z | `TOKEN_API_MISSING_ICON` | icon missing for ENA on mainnet |
| 2026-05-06T16:42:07.119Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for AXS on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:07.121Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for  on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:07.121Z | `TOKEN_API_MISSING_ICON` | icon missing for  on mainnet |
| 2026-05-06T16:42:07.122Z | `TOKEN_API_MISSING_NAME` | name is null/empty for MKR on mainnet (contract 0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2) |
| 2026-05-06T16:42:07.339Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for wstETH on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:07.339Z | `TOKEN_API_MISSING_ICON` | icon missing for wstETH on mainnet |
| 2026-05-06T16:42:07.346Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for CRV on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:07.347Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SNX on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:07.349Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ARB on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:07.350Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for AAVE on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:07.351Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SAND on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:07.412Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for weETH on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:07.412Z | `TOKEN_API_MISSING_ICON` | icon missing for weETH on mainnet |
| 2026-05-06T16:42:07.413Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GRT on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:07.437Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for MANA on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:07.487Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for APE on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:07.772Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WBTC on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:08.138Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for BAT on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:09.134Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for MATIC on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:09.267Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-06T16:42:10.316Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for DAI on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:10.334Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LINK on mainnet (FDV cannot be computed) |
| 2026-05-06T16:42:10.775Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SHIB on mainnet (FDV cannot be computed) |
| 2026-05-06T16:55:56.202Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 2 rows but only 1 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-06T16:55:56.994Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8 |
| 2026-05-06T16:55:57.267Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 90 rows but only 23 distinct datetimes for pool 0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8 |
| 2026-05-06T16:55:58.327Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LINK on mainnet (FDV cannot be computed) |
| 2026-05-06T16:55:59.720Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): LINK |
| 2026-05-06T16:55:59.720Z | `TOKEN_API_POOLS_FILTER_LEAKS` | pools?input_token=0x51491077 returned 3 unrelated pools (filter not enforced server-side) |
| 2026-05-06T16:56:17.803Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xf56d08221b5942c428acc5de8f78489a97fc5599 |
| 2026-05-06T16:56:18.173Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x8592064903ef23d34e4d5aaaed40abf6d96af186 |
| 2026-05-06T16:56:18.177Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xeed4603bc333ef406e5eb691ba66798d5c857d8b |
| 2026-05-06T16:56:18.245Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x5b97b125cf8af96834f2d08c8f1291bd47724939 |
| 2026-05-06T16:56:18.422Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xdc2c21f1b54ddaf39e944689a8f90cb844135cc9 |
| 2026-05-06T16:56:18.427Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xe41552e6212cb6f7faa381c7bc9434c58bf28ce1 |
| 2026-05-06T16:56:18.454Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x4c83a7f819a5c37d64b4c5a2f8238ea082fa1f4e |
| 2026-05-06T16:56:18.520Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x5c95d4b1c3321cf898d25949f41d50be2db5bc1d |
| 2026-05-06T16:56:18.524Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x3019d4e366576a88d28b623afaf3ecb9ec9d9580 |
| 2026-05-06T16:56:18.528Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x9febc984504356225405e26833608b17719c82ae |
| 2026-05-06T16:56:18.535Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xea4ba4ce14fdd287f380b55419b1c5b6c3f22ab6 |
| 2026-05-06T16:56:18.543Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xae614a7a56cb79c04df2aeba6f5dab80a39ca78e |
| 2026-05-06T16:56:18.550Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 96 rows but only 48 distinct datetimes for pool 0x9188d6690a84023ccfb712f409376587ee3b6b63 |
| 2026-05-06T16:56:18.551Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x8661ae7918c0115af9e3691662f605e9c550ddc9 |
| 2026-05-06T16:56:18.569Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x5764a6f2212d502bc5970f9f129ffcd61e5d7563 |
| 2026-05-06T16:56:18.583Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xd8de6af55f618a7bc69835d55ddc6582220c36c0 |
| 2026-05-06T16:56:18.592Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x7a415b19932c0105c82fdb6b720bb01b0cc2cae3 |
| 2026-05-06T16:56:18.636Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xcd8286b48936cdac20518247dbd310ab681a9fbf |
| 2026-05-06T16:56:18.660Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xfd76be67fff3bac84e3d5444167bbc018f5968b6 |
| 2026-05-06T16:56:18.752Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x841820459769cd629b10a36fd12e603938cc2679 |
| 2026-05-06T16:56:18.754Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xede8dd046586d22625ae7ff2708f879ef7bdb8cf |
| 2026-05-06T16:56:18.758Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x000ba527862e5b82cff0f7c66b646af023274aa1 |
| 2026-05-06T16:56:18.766Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x59354356ec5d56306791873f567d61ebf11dfbd5 |
| 2026-05-06T16:56:18.779Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x5777d92f208679db4b9778590fa3cab3ac9e2168 |
| 2026-05-06T16:56:18.782Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x0e2c4be9f3408e5b1ff631576d946eb8c224b5ed |
| 2026-05-06T16:56:18.831Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x840deeef2f115cf50da625f7368c24af6fe74410 |
| 2026-05-06T16:56:18.833Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x553e9c493678d8606d6a5ba284643db2110df823 |
| 2026-05-06T16:56:18.835Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x290a6a7460b308ee3f19023d2d00de604bcf5b42 |
| 2026-05-06T16:56:18.853Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xa3f558aebaecaf0e11ca4b2199cc5ed341edfd74 |
| 2026-05-06T16:56:18.855Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x73ea3d8ba3d7380201b270ec504b33ed5e478542 |
| 2026-05-06T16:56:18.876Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x06f00544c0bc62e6db10f46d370dfccdc23d8189 |
| 2026-05-06T16:56:18.886Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xe8c6c9227491c0a8156a0106a0204d881bb7e531 |
| 2026-05-06T16:56:18.897Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x57af956d3e2cca3b86f3d8c6772c03ddca3eaacb |
| 2026-05-06T16:56:18.898Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x99ac8ca7087fa4a2a1fb6357269965a2014abc35 |
| 2026-05-06T16:56:18.902Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0xc63b0708e2f7e69cb8a1df0e1389a98c35a76d52 |
| 2026-05-06T16:56:18.908Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x73a6a761fe483ba19debb8f56ac5bbf14c0cdad1 |
| 2026-05-06T16:56:18.917Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x4e0924d3a751be199c426d52fb1f2337fa96f736 |
| 2026-05-06T16:56:18.929Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x1d42064fc4beb5f8aaf85f4617ae8b3b5b8bd801 |
| 2026-05-06T16:56:18.936Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x92560c178ce069cc014138ed3c2f5221ba71f58a |
| 2026-05-06T16:56:18.946Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x5ab53ee1d50eef2c1dd3d5402789cd27bb52c1bb |
| 2026-05-06T16:56:18.956Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xac4b3dacb91461209ae9d41ec517c2b9cb1b7daf |
| 2026-05-06T16:56:18.956Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xc2e9f25be6257c210d7adf0d4cd6e3e881ba25f8 |
| 2026-05-06T16:56:18.969Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x11950d141ecb863f01007add7d1a342041227b58 |
| 2026-05-06T16:56:18.985Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x13394005c1012e708fce1eb974f1130fdc73a5ce |
| 2026-05-06T16:56:19.063Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xc3db44adc1fcdfd5671f555236eae49f4a8eea18 |
| 2026-05-06T16:56:19.073Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xbe80225f09645f172b079394312220637c440a63 |
| 2026-05-06T16:56:19.088Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x109830a1aaad605bbf02a9dfa7b0b92ec2fb7daa |
| 2026-05-06T16:56:19.119Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xe42318ea3b998e8355a3da364eb9d48ec725eb45 |
| 2026-05-06T16:56:19.241Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for rETH on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:19.242Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GNO on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:19.245Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GHO on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:19.292Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FRAX on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:19.312Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x4e68ccd3e89f51c3074ca5072bbac773960dfa36 |
| 2026-05-06T16:56:19.314Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for RPL on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:19.575Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for sfrxETH on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:19.578Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ezETH on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:19.579Z | `TOKEN_API_MISSING_ICON` | icon missing for ezETH on mainnet |
| 2026-05-06T16:56:19.586Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:19.591Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FDUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:19.604Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SAFE on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:19.607Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for wstETH on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:19.608Z | `TOKEN_API_MISSING_ICON` | icon missing for wstETH on mainnet |
| 2026-05-06T16:56:19.641Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for DYDX on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:19.665Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PENDLE on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:19.683Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LDO on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:19.706Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for BAL on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:19.706Z | `TOKEN_API_MISSING_ICON` | icon missing for BAL on mainnet |
| 2026-05-06T16:56:19.709Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for AXS on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:19.741Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for STG on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:19.779Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for weETH on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:19.779Z | `TOKEN_API_MISSING_ICON` | icon missing for weETH on mainnet |
| 2026-05-06T16:56:19.782Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for  on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:19.783Z | `TOKEN_API_MISSING_ICON` | icon missing for  on mainnet |
| 2026-05-06T16:56:19.783Z | `TOKEN_API_MISSING_NAME` | name is null/empty for MKR on mainnet (contract 0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2) |
| 2026-05-06T16:56:19.796Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ENA on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:19.796Z | `TOKEN_API_MISSING_ICON` | icon missing for ENA on mainnet |
| 2026-05-06T16:56:19.809Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PYUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:19.829Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for CRV on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:19.845Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GRT on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:19.881Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WLD on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:19.882Z | `TOKEN_API_MISSING_ICON` | icon missing for WLD on mainnet |
| 2026-05-06T16:56:19.885Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for cbETH on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:19.895Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ARB on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:19.912Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for COMP on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:19.964Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for CRVUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:19.989Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SUSHI on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:20.015Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for IMX on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:20.095Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FLOKI on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:20.095Z | `TOKEN_API_MISSING_ICON` | icon missing for FLOKI on mainnet |
| 2026-05-06T16:56:20.233Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ENS on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:20.258Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ETHFI on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:20.258Z | `TOKEN_API_MISSING_ICON` | icon missing for ETHFI on mainnet |
| 2026-05-06T16:56:20.263Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SNX on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:20.310Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for 1INCH on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:20.343Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SAND on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:20.430Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for BAT on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:20.455Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for AAVE on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:20.469Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for APE on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:20.509Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WBTC on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:20.752Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PEPE on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:20.796Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for UNI on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:20.835Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for MANA on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:21.060Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for MATIC on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:22.084Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for DAI on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:22.268Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SHIB on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:23.305Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-06T16:56:29.990Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WETH on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:31.584Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for USDC on mainnet (FDV cannot be computed) |
| 2026-05-06T16:56:34.150Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for USDT on mainnet (FDV cannot be computed) |
| 2026-05-06T16:57:36.508Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 90 rows but only 23 distinct datetimes for pool 0x0e2c4be9f3408e5b1ff631576d946eb8c224b5ed |
| 2026-05-06T16:57:38.163Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): GRT |
| 2026-05-06T16:57:38.164Z | `TOKEN_API_POOLS_FILTER_LEAKS` | pools?input_token=0xc944e90c returned 5 unrelated pools (filter not enforced server-side) |
| 2026-05-06T17:10:27.282Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 2 rows but only 1 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-06T17:10:27.881Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x4c83a7f819a5c37d64b4c5a2f8238ea082fa1f4e |
| 2026-05-06T17:10:27.976Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 90 rows but only 23 distinct datetimes for pool 0x4c83a7f819a5c37d64b4c5a2f8238ea082fa1f4e |
| 2026-05-06T17:10:30.354Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for CRV on mainnet (FDV cannot be computed) |
| 2026-05-06T17:10:32.245Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): CRV |
| 2026-05-06T17:10:32.246Z | `TOKEN_API_POOLS_FILTER_LEAKS` | pools?input_token=0xd533a949 returned 5 unrelated pools (filter not enforced server-side) |
| 2026-05-06T17:10:58.596Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x841820459769cd629b10a36fd12e603938cc2679 |
| 2026-05-06T17:10:58.952Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 90 rows but only 45 distinct datetimes for pool 0x841820459769cd629b10a36fd12e603938cc2679 |
| 2026-05-06T17:10:59.113Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WLD on mainnet (FDV cannot be computed) |
| 2026-05-06T17:10:59.114Z | `TOKEN_API_MISSING_ICON` | icon missing for WLD on mainnet |
| 2026-05-06T17:11:01.490Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): WLD |
| 2026-05-06T17:11:01.490Z | `TOKEN_API_POOLS_FILTER_LEAKS` | pools?input_token=0x163f8c24 returned 2 unrelated pools (filter not enforced server-side) |
| 2026-05-06T17:11:12.571Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 90 rows but only 12 distinct datetimes for pool 0xc63b0708e2f7e69cb8a1df0e1389a98c35a76d52 |
| 2026-05-06T17:11:12.609Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0xc63b0708e2f7e69cb8a1df0e1389a98c35a76d52 |
| 2026-05-06T17:11:12.852Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FRAX on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:14.548Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): FRAX |
| 2026-05-06T17:11:14.548Z | `TOKEN_API_POOLS_FILTER_LEAKS` | pools?input_token=0x853d955a returned 5 unrelated pools (filter not enforced server-side) |
| 2026-05-06T17:11:38.603Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xe41552e6212cb6f7faa381c7bc9434c58bf28ce1 |
| 2026-05-06T17:11:38.638Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x5777d92f208679db4b9778590fa3cab3ac9e2168 |
| 2026-05-06T17:11:38.719Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x59354356ec5d56306791873f567d61ebf11dfbd5 |
| 2026-05-06T17:11:38.720Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xea4ba4ce14fdd287f380b55419b1c5b6c3f22ab6 |
| 2026-05-06T17:11:38.730Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xede8dd046586d22625ae7ff2708f879ef7bdb8cf |
| 2026-05-06T17:11:38.733Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xcd8286b48936cdac20518247dbd310ab681a9fbf |
| 2026-05-06T17:11:38.746Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xa3f558aebaecaf0e11ca4b2199cc5ed341edfd74 |
| 2026-05-06T17:11:38.804Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xe42318ea3b998e8355a3da364eb9d48ec725eb45 |
| 2026-05-06T17:11:38.834Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x11950d141ecb863f01007add7d1a342041227b58 |
| 2026-05-06T17:11:38.906Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 96 rows but only 48 distinct datetimes for pool 0x9188d6690a84023ccfb712f409376587ee3b6b63 |
| 2026-05-06T17:11:39.030Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x13394005c1012e708fce1eb974f1130fdc73a5ce |
| 2026-05-06T17:11:39.138Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x92560c178ce069cc014138ed3c2f5221ba71f58a |
| 2026-05-06T17:11:39.188Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xc2e9f25be6257c210d7adf0d4cd6e3e881ba25f8 |
| 2026-05-06T17:11:39.353Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ARB on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:39.380Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:39.396Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LDO on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:39.402Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PENDLE on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:39.482Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ENA on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:39.483Z | `TOKEN_API_MISSING_ICON` | icon missing for ENA on mainnet |
| 2026-05-06T17:11:39.508Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SUSHI on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:39.550Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ETHFI on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:39.550Z | `TOKEN_API_MISSING_ICON` | icon missing for ETHFI on mainnet |
| 2026-05-06T17:11:39.641Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SNX on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:40.348Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for MATIC on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:41.206Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x73ea3d8ba3d7380201b270ec504b33ed5e478542 |
| 2026-05-06T17:11:41.478Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x4e0924d3a751be199c426d52fb1f2337fa96f736 |
| 2026-05-06T17:11:41.506Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xd8de6af55f618a7bc69835d55ddc6582220c36c0 |
| 2026-05-06T17:11:41.530Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xfd76be67fff3bac84e3d5444167bbc018f5968b6 |
| 2026-05-06T17:11:41.558Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x840deeef2f115cf50da625f7368c24af6fe74410 |
| 2026-05-06T17:11:41.590Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x5c95d4b1c3321cf898d25949f41d50be2db5bc1d |
| 2026-05-06T17:11:41.594Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x5764a6f2212d502bc5970f9f129ffcd61e5d7563 |
| 2026-05-06T17:11:41.596Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xdc2c21f1b54ddaf39e944689a8f90cb844135cc9 |
| 2026-05-06T17:11:41.623Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x3019d4e366576a88d28b623afaf3ecb9ec9d9580 |
| 2026-05-06T17:11:41.626Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x5b97b125cf8af96834f2d08c8f1291bd47724939 |
| 2026-05-06T17:11:41.642Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xeed4603bc333ef406e5eb691ba66798d5c857d8b |
| 2026-05-06T17:11:41.750Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x8592064903ef23d34e4d5aaaed40abf6d96af186 |
| 2026-05-06T17:11:41.758Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x0e2c4be9f3408e5b1ff631576d946eb8c224b5ed |
| 2026-05-06T17:11:41.804Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x06f00544c0bc62e6db10f46d370dfccdc23d8189 |
| 2026-05-06T17:11:41.845Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xae614a7a56cb79c04df2aeba6f5dab80a39ca78e |
| 2026-05-06T17:11:41.861Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xe8c6c9227491c0a8156a0106a0204d881bb7e531 |
| 2026-05-06T17:11:41.901Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x99ac8ca7087fa4a2a1fb6357269965a2014abc35 |
| 2026-05-06T17:11:41.926Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x73a6a761fe483ba19debb8f56ac5bbf14c0cdad1 |
| 2026-05-06T17:11:41.975Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x57af956d3e2cca3b86f3d8c6772c03ddca3eaacb |
| 2026-05-06T17:11:41.981Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x553e9c493678d8606d6a5ba284643db2110df823 |
| 2026-05-06T17:11:41.999Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xf56d08221b5942c428acc5de8f78489a97fc5599 |
| 2026-05-06T17:11:42.026Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x7a415b19932c0105c82fdb6b720bb01b0cc2cae3 |
| 2026-05-06T17:11:42.090Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x8661ae7918c0115af9e3691662f605e9c550ddc9 |
| 2026-05-06T17:11:42.113Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x109830a1aaad605bbf02a9dfa7b0b92ec2fb7daa |
| 2026-05-06T17:11:42.203Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x290a6a7460b308ee3f19023d2d00de604bcf5b42 |
| 2026-05-06T17:11:42.205Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xc3db44adc1fcdfd5671f555236eae49f4a8eea18 |
| 2026-05-06T17:11:42.270Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8 |
| 2026-05-06T17:11:42.290Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xbe80225f09645f172b079394312220637c440a63 |
| 2026-05-06T17:11:42.297Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x9febc984504356225405e26833608b17719c82ae |
| 2026-05-06T17:11:42.349Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x000ba527862e5b82cff0f7c66b646af023274aa1 |
| 2026-05-06T17:11:42.353Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x5ab53ee1d50eef2c1dd3d5402789cd27bb52c1bb |
| 2026-05-06T17:11:42.400Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x1d42064fc4beb5f8aaf85f4617ae8b3b5b8bd801 |
| 2026-05-06T17:11:42.498Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x4e68ccd3e89f51c3074ca5072bbac773960dfa36 |
| 2026-05-06T17:11:42.581Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xac4b3dacb91461209ae9d41ec517c2b9cb1b7daf |
| 2026-05-06T17:11:42.619Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GHO on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:42.869Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for RPL on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:42.945Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for rETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:43.004Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for sfrxETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:43.012Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ezETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:43.012Z | `TOKEN_API_MISSING_ICON` | icon missing for ezETH on mainnet |
| 2026-05-06T17:11:43.199Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for BAL on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:43.199Z | `TOKEN_API_MISSING_ICON` | icon missing for BAL on mainnet |
| 2026-05-06T17:11:43.232Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FDUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:43.281Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for STG on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:43.283Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for AXS on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:43.290Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for CRVUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:43.449Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GNO on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:43.516Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SAFE on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:43.528Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for cbETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:43.573Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for AAVE on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:43.627Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for 1INCH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:43.661Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for DYDX on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:43.668Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for IMX on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:43.760Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GRT on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:43.870Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for weETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:43.871Z | `TOKEN_API_MISSING_ICON` | icon missing for weETH on mainnet |
| 2026-05-06T17:11:43.969Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FLOKI on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:43.969Z | `TOKEN_API_MISSING_ICON` | icon missing for FLOKI on mainnet |
| 2026-05-06T17:11:44.016Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for  on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:44.016Z | `TOKEN_API_MISSING_ICON` | icon missing for  on mainnet |
| 2026-05-06T17:11:44.079Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PYUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:44.146Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:44.199Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for COMP on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:44.238Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for MANA on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:44.266Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ENS on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:44.425Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SAND on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:44.507Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WBTC on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:44.518Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for wstETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:44.519Z | `TOKEN_API_MISSING_ICON` | icon missing for wstETH on mainnet |
| 2026-05-06T17:11:44.556Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for APE on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:44.751Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for UNI on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:44.796Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PEPE on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:44.807Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for BAT on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:45.909Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LINK on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:46.440Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for DAI on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:46.813Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SHIB on mainnet (FDV cannot be computed) |
| 2026-05-06T17:11:46.829Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-06T17:11:54.975Z | `TOKEN_API_MISSING_NAME` | name is null/empty for MKR on mainnet (contract 0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2) |
| 2026-05-06T17:12:01.391Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 90 rows but only 23 distinct datetimes for pool 0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8 |
| 2026-05-06T17:12:10.648Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): LINK |
| 2026-05-06T17:12:10.650Z | `TOKEN_API_POOLS_FILTER_LEAKS` | pools?input_token=0x51491077 returned 3 unrelated pools (filter not enforced server-side) |
| 2026-05-06T17:12:52.844Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for USDC on mainnet (FDV cannot be computed) |
| 2026-05-06T17:13:19.115Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for USDT on mainnet (FDV cannot be computed) |
| 2026-05-06T17:14:07.703Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 90 rows but only 45 distinct datetimes for pool 0x290a6a7460b308ee3f19023d2d00de604bcf5b42 |
| 2026-05-06T17:14:09.166Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): MATIC |
| 2026-05-06T17:14:09.166Z | `TOKEN_API_POOLS_FILTER_LEAKS` | pools?input_token=0x7d1afa7b returned 5 unrelated pools (filter not enforced server-side) |
| 2026-05-06T17:17:27.575Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 2 rows but only 1 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-06T17:17:27.801Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for USDC on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.808Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LDO on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.812Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for UNI on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.822Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for  on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.822Z | `TOKEN_API_MISSING_ICON` | icon missing for  on mainnet |
| 2026-05-06T17:17:27.835Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for CRV on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.839Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FDUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.841Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GHO on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.843Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for USDT on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.848Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for CRVUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.858Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x0e2c4be9f3408e5b1ff631576d946eb8c224b5ed |
| 2026-05-06T17:17:27.859Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for cbETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.863Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for rETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.864Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for 1INCH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.868Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x11950d141ecb863f01007add7d1a342041227b58 |
| 2026-05-06T17:17:27.869Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xe8c6c9227491c0a8156a0106a0204d881bb7e531 |
| 2026-05-06T17:17:27.869Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x92560c178ce069cc014138ed3c2f5221ba71f58a |
| 2026-05-06T17:17:27.870Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ezETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.870Z | `TOKEN_API_MISSING_ICON` | icon missing for ezETH on mainnet |
| 2026-05-06T17:17:27.872Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for sfrxETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.876Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for DYDX on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.877Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for RPL on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.877Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 96 rows but only 48 distinct datetimes for pool 0x9188d6690a84023ccfb712f409376587ee3b6b63 |
| 2026-05-06T17:17:27.879Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ARB on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.882Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for BAL on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.882Z | `TOKEN_API_MISSING_ICON` | icon missing for BAL on mainnet |
| 2026-05-06T17:17:27.884Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for weETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.885Z | `TOKEN_API_MISSING_ICON` | icon missing for weETH on mainnet |
| 2026-05-06T17:17:27.885Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0xc63b0708e2f7e69cb8a1df0e1389a98c35a76d52 |
| 2026-05-06T17:17:27.888Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LINK on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.890Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for STG on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.890Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FRAX on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.891Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SNX on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.892Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for AAVE on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.892Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x73ea3d8ba3d7380201b270ec504b33ed5e478542 |
| 2026-05-06T17:17:27.893Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WBTC on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.893Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for AXS on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.895Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x840deeef2f115cf50da625f7368c24af6fe74410 |
| 2026-05-06T17:17:27.896Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PENDLE on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.901Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PEPE on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.905Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x7a415b19932c0105c82fdb6b720bb01b0cc2cae3 |
| 2026-05-06T17:17:27.906Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x9febc984504356225405e26833608b17719c82ae |
| 2026-05-06T17:17:27.909Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for BAT on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.910Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xe42318ea3b998e8355a3da364eb9d48ec725eb45 |
| 2026-05-06T17:17:27.915Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xbe80225f09645f172b079394312220637c440a63 |
| 2026-05-06T17:17:27.919Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x73a6a761fe483ba19debb8f56ac5bbf14c0cdad1 |
| 2026-05-06T17:17:27.920Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for IMX on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.921Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x290a6a7460b308ee3f19023d2d00de604bcf5b42 |
| 2026-05-06T17:17:27.921Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SAND on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.922Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xede8dd046586d22625ae7ff2708f879ef7bdb8cf |
| 2026-05-06T17:17:27.923Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FLOKI on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.924Z | `TOKEN_API_MISSING_ICON` | icon missing for FLOKI on mainnet |
| 2026-05-06T17:17:27.925Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x59354356ec5d56306791873f567d61ebf11dfbd5 |
| 2026-05-06T17:17:27.928Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for APE on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.929Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xcd8286b48936cdac20518247dbd310ab681a9fbf |
| 2026-05-06T17:17:27.930Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xeed4603bc333ef406e5eb691ba66798d5c857d8b |
| 2026-05-06T17:17:27.934Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xc3db44adc1fcdfd5671f555236eae49f4a8eea18 |
| 2026-05-06T17:17:27.935Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xac4b3dacb91461209ae9d41ec517c2b9cb1b7daf |
| 2026-05-06T17:17:27.935Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xd8de6af55f618a7bc69835d55ddc6582220c36c0 |
| 2026-05-06T17:17:27.936Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x13394005c1012e708fce1eb974f1130fdc73a5ce |
| 2026-05-06T17:17:27.936Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8 |
| 2026-05-06T17:17:27.937Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xa3f558aebaecaf0e11ca4b2199cc5ed341edfd74 |
| 2026-05-06T17:17:27.938Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for MATIC on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.939Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xfd76be67fff3bac84e3d5444167bbc018f5968b6 |
| 2026-05-06T17:17:27.940Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GRT on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.940Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GNO on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.941Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x4c83a7f819a5c37d64b4c5a2f8238ea082fa1f4e |
| 2026-05-06T17:17:27.942Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SHIB on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.942Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x553e9c493678d8606d6a5ba284643db2110df823 |
| 2026-05-06T17:17:27.943Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ENA on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.943Z | `TOKEN_API_MISSING_ICON` | icon missing for ENA on mainnet |
| 2026-05-06T17:17:27.945Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SAFE on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.945Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for DAI on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.946Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ETHFI on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.946Z | `TOKEN_API_MISSING_ICON` | icon missing for ETHFI on mainnet |
| 2026-05-06T17:17:27.947Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x57af956d3e2cca3b86f3d8c6772c03ddca3eaacb |
| 2026-05-06T17:17:27.947Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x5ab53ee1d50eef2c1dd3d5402789cd27bb52c1bb |
| 2026-05-06T17:17:27.948Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SUSHI on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.949Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for MANA on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.951Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.952Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for wstETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.952Z | `TOKEN_API_MISSING_ICON` | icon missing for wstETH on mainnet |
| 2026-05-06T17:17:27.953Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x8661ae7918c0115af9e3691662f605e9c550ddc9 |
| 2026-05-06T17:17:27.954Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xe41552e6212cb6f7faa381c7bc9434c58bf28ce1 |
| 2026-05-06T17:17:27.955Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x5764a6f2212d502bc5970f9f129ffcd61e5d7563 |
| 2026-05-06T17:17:27.956Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for COMP on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.958Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x3019d4e366576a88d28b623afaf3ecb9ec9d9580 |
| 2026-05-06T17:17:27.966Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x5777d92f208679db4b9778590fa3cab3ac9e2168 |
| 2026-05-06T17:17:27.967Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ENS on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.967Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WLD on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:27.967Z | `TOKEN_API_MISSING_ICON` | icon missing for WLD on mainnet |
| 2026-05-06T17:17:27.969Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x1d42064fc4beb5f8aaf85f4617ae8b3b5b8bd801 |
| 2026-05-06T17:17:27.976Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xf56d08221b5942c428acc5de8f78489a97fc5599 |
| 2026-05-06T17:17:27.979Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x8592064903ef23d34e4d5aaaed40abf6d96af186 |
| 2026-05-06T17:17:27.987Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x841820459769cd629b10a36fd12e603938cc2679 |
| 2026-05-06T17:17:27.993Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x000ba527862e5b82cff0f7c66b646af023274aa1 |
| 2026-05-06T17:17:27.993Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xae614a7a56cb79c04df2aeba6f5dab80a39ca78e |
| 2026-05-06T17:17:27.995Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-06T17:17:27.995Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x99ac8ca7087fa4a2a1fb6357269965a2014abc35 |
| 2026-05-06T17:17:27.997Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x06f00544c0bc62e6db10f46d370dfccdc23d8189 |
| 2026-05-06T17:17:27.997Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xdc2c21f1b54ddaf39e944689a8f90cb844135cc9 |
| 2026-05-06T17:17:28.003Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xc2e9f25be6257c210d7adf0d4cd6e3e881ba25f8 |
| 2026-05-06T17:17:28.004Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x5b97b125cf8af96834f2d08c8f1291bd47724939 |
| 2026-05-06T17:17:28.280Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PYUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:28.293Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T17:17:28.308Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x4e68ccd3e89f51c3074ca5072bbac773960dfa36 |
| 2026-05-06T17:17:28.312Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x4e0924d3a751be199c426d52fb1f2337fa96f736 |
| 2026-05-06T17:17:28.326Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x5c95d4b1c3321cf898d25949f41d50be2db5bc1d |
| 2026-05-06T17:17:28.333Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xea4ba4ce14fdd287f380b55419b1c5b6c3f22ab6 |
| 2026-05-06T17:17:28.365Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x109830a1aaad605bbf02a9dfa7b0b92ec2fb7daa |
| 2026-05-06T17:17:30.239Z | `TOKEN_API_MISSING_NAME` | name is null/empty for MKR on mainnet (contract 0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2) |
| 2026-05-06T17:23:21.559Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 2 rows but only 1 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-06T17:23:22.194Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 90 rows but only 23 distinct datetimes for pool 0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8 |
| 2026-05-06T17:23:22.378Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8 |
| 2026-05-06T17:23:22.403Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LINK on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:23.547Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for CRV on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:23.596Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x4c83a7f819a5c37d64b4c5a2f8238ea082fa1f4e |
| 2026-05-06T17:23:25.356Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xdc2c21f1b54ddaf39e944689a8f90cb844135cc9 |
| 2026-05-06T17:23:25.441Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xe41552e6212cb6f7faa381c7bc9434c58bf28ce1 |
| 2026-05-06T17:23:25.482Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xd8de6af55f618a7bc69835d55ddc6582220c36c0 |
| 2026-05-06T17:23:25.487Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x73ea3d8ba3d7380201b270ec504b33ed5e478542 |
| 2026-05-06T17:23:25.488Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x5b97b125cf8af96834f2d08c8f1291bd47724939 |
| 2026-05-06T17:23:25.576Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x59354356ec5d56306791873f567d61ebf11dfbd5 |
| 2026-05-06T17:23:25.612Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0xc63b0708e2f7e69cb8a1df0e1389a98c35a76d52 |
| 2026-05-06T17:23:25.659Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x000ba527862e5b82cff0f7c66b646af023274aa1 |
| 2026-05-06T17:23:25.731Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x06f00544c0bc62e6db10f46d370dfccdc23d8189 |
| 2026-05-06T17:23:25.775Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xac4b3dacb91461209ae9d41ec517c2b9cb1b7daf |
| 2026-05-06T17:23:25.786Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x92560c178ce069cc014138ed3c2f5221ba71f58a |
| 2026-05-06T17:23:25.797Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xe8c6c9227491c0a8156a0106a0204d881bb7e531 |
| 2026-05-06T17:23:25.835Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xede8dd046586d22625ae7ff2708f879ef7bdb8cf |
| 2026-05-06T17:23:25.968Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x11950d141ecb863f01007add7d1a342041227b58 |
| 2026-05-06T17:23:26.209Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WBTC on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:26.220Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x4e68ccd3e89f51c3074ca5072bbac773960dfa36 |
| 2026-05-06T17:23:26.348Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:26.524Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ezETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:26.525Z | `TOKEN_API_MISSING_ICON` | icon missing for ezETH on mainnet |
| 2026-05-06T17:23:26.532Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ARB on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:26.577Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for CRVUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:26.607Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ENS on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:26.641Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GRT on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:26.691Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SAND on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:26.740Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for COMP on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:27.131Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for UNI on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:27.152Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x553e9c493678d8606d6a5ba284643db2110df823 |
| 2026-05-06T17:23:27.225Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for MATIC on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:27.341Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x5764a6f2212d502bc5970f9f129ffcd61e5d7563 |
| 2026-05-06T17:23:27.350Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): LINK |
| 2026-05-06T17:23:27.351Z | `TOKEN_API_POOLS_FILTER_LEAKS` | pools?input_token=0x51491077 returned 3 unrelated pools (filter not enforced server-side) |
| 2026-05-06T17:23:27.400Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x8592064903ef23d34e4d5aaaed40abf6d96af186 |
| 2026-05-06T17:23:27.443Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x99ac8ca7087fa4a2a1fb6357269965a2014abc35 |
| 2026-05-06T17:23:27.474Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-06T17:23:27.492Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x840deeef2f115cf50da625f7368c24af6fe74410 |
| 2026-05-06T17:23:27.610Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x3019d4e366576a88d28b623afaf3ecb9ec9d9580 |
| 2026-05-06T17:23:27.614Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x9febc984504356225405e26833608b17719c82ae |
| 2026-05-06T17:23:27.669Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xbe80225f09645f172b079394312220637c440a63 |
| 2026-05-06T17:23:27.748Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x57af956d3e2cca3b86f3d8c6772c03ddca3eaacb |
| 2026-05-06T17:23:27.749Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xae614a7a56cb79c04df2aeba6f5dab80a39ca78e |
| 2026-05-06T17:23:27.842Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xcd8286b48936cdac20518247dbd310ab681a9fbf |
| 2026-05-06T17:23:27.850Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 96 rows but only 48 distinct datetimes for pool 0x9188d6690a84023ccfb712f409376587ee3b6b63 |
| 2026-05-06T17:23:27.851Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xe42318ea3b998e8355a3da364eb9d48ec725eb45 |
| 2026-05-06T17:23:27.855Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xeed4603bc333ef406e5eb691ba66798d5c857d8b |
| 2026-05-06T17:23:27.855Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xfd76be67fff3bac84e3d5444167bbc018f5968b6 |
| 2026-05-06T17:23:27.858Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x0e2c4be9f3408e5b1ff631576d946eb8c224b5ed |
| 2026-05-06T17:23:27.890Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xc3db44adc1fcdfd5671f555236eae49f4a8eea18 |
| 2026-05-06T17:23:27.926Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x8661ae7918c0115af9e3691662f605e9c550ddc9 |
| 2026-05-06T17:23:27.991Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xf56d08221b5942c428acc5de8f78489a97fc5599 |
| 2026-05-06T17:23:28.029Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x13394005c1012e708fce1eb974f1130fdc73a5ce |
| 2026-05-06T17:23:28.060Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x73a6a761fe483ba19debb8f56ac5bbf14c0cdad1 |
| 2026-05-06T17:23:28.111Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x7a415b19932c0105c82fdb6b720bb01b0cc2cae3 |
| 2026-05-06T17:23:28.115Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x5ab53ee1d50eef2c1dd3d5402789cd27bb52c1bb |
| 2026-05-06T17:23:28.126Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x5c95d4b1c3321cf898d25949f41d50be2db5bc1d |
| 2026-05-06T17:23:28.145Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xc2e9f25be6257c210d7adf0d4cd6e3e881ba25f8 |
| 2026-05-06T17:23:28.174Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x4e0924d3a751be199c426d52fb1f2337fa96f736 |
| 2026-05-06T17:23:28.180Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xea4ba4ce14fdd287f380b55419b1c5b6c3f22ab6 |
| 2026-05-06T17:23:28.193Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x841820459769cd629b10a36fd12e603938cc2679 |
| 2026-05-06T17:23:28.283Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x290a6a7460b308ee3f19023d2d00de604bcf5b42 |
| 2026-05-06T17:23:28.388Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xa3f558aebaecaf0e11ca4b2199cc5ed341edfd74 |
| 2026-05-06T17:23:28.394Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x5777d92f208679db4b9778590fa3cab3ac9e2168 |
| 2026-05-06T17:23:28.420Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x109830a1aaad605bbf02a9dfa7b0b92ec2fb7daa |
| 2026-05-06T17:23:28.696Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x1d42064fc4beb5f8aaf85f4617ae8b3b5b8bd801 |
| 2026-05-06T17:23:28.714Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FDUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:28.978Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FRAX on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:29.097Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for IMX on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:29.223Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LDO on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:29.299Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for RPL on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:29.300Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PENDLE on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:29.318Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for weETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:29.319Z | `TOKEN_API_MISSING_ICON` | icon missing for weETH on mainnet |
| 2026-05-06T17:23:29.357Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for sfrxETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:29.360Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for cbETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:29.361Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ETHFI on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:29.361Z | `TOKEN_API_MISSING_ICON` | icon missing for ETHFI on mainnet |
| 2026-05-06T17:23:29.388Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for rETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:29.422Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PYUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:29.473Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ENA on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:29.473Z | `TOKEN_API_MISSING_ICON` | icon missing for ENA on mainnet |
| 2026-05-06T17:23:29.479Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FLOKI on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:29.479Z | `TOKEN_API_MISSING_ICON` | icon missing for FLOKI on mainnet |
| 2026-05-06T17:23:29.481Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SAFE on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:29.501Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GNO on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:29.516Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for 1INCH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:29.548Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:29.557Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for  on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:29.557Z | `TOKEN_API_MISSING_ICON` | icon missing for  on mainnet |
| 2026-05-06T17:23:29.607Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SNX on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:29.632Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for wstETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:29.632Z | `TOKEN_API_MISSING_ICON` | icon missing for wstETH on mainnet |
| 2026-05-06T17:23:29.633Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GHO on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:29.646Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SUSHI on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:29.656Z | `TOKEN_API_MISSING_NAME` | name is null/empty for MKR on mainnet (contract 0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2) |
| 2026-05-06T17:23:29.684Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for STG on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:29.751Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for DYDX on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:29.834Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for BAL on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:29.835Z | `TOKEN_API_MISSING_ICON` | icon missing for BAL on mainnet |
| 2026-05-06T17:23:29.863Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for AXS on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:29.901Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WLD on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:29.901Z | `TOKEN_API_MISSING_ICON` | icon missing for WLD on mainnet |
| 2026-05-06T17:23:29.936Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for AAVE on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:29.984Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for USDC on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:30.096Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for MANA on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:30.139Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for APE on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:30.219Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PEPE on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:30.489Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for BAT on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:31.822Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for DAI on mainnet (FDV cannot be computed) |
| 2026-05-06T17:23:32.659Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SHIB on mainnet (FDV cannot be computed) |
| 2026-05-06T17:26:09.827Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 90 rows but only 45 distinct datetimes for pool 0x290a6a7460b308ee3f19023d2d00de604bcf5b42 |
| 2026-05-06T17:26:12.647Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): MATIC |
| 2026-05-06T17:26:12.649Z | `TOKEN_API_POOLS_FILTER_LEAKS` | pools?input_token=0x7d1afa7b returned 5 unrelated pools (filter not enforced server-side) |
| 2026-05-06T17:33:50.204Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 2 rows but only 1 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-06T17:33:50.732Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8 |
| 2026-05-06T17:33:50.844Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 90 rows but only 23 distinct datetimes for pool 0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8 |
| 2026-05-06T17:33:51.286Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LINK on mainnet (FDV cannot be computed) |
| 2026-05-06T17:33:51.862Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 24 rows but only 6 distinct datetimes for pool 0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8 |
| 2026-05-06T17:33:53.260Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 90 rows but only 23 distinct datetimes for pool 0x0e2c4be9f3408e5b1ff631576d946eb8c224b5ed |
| 2026-05-06T17:33:53.285Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x0e2c4be9f3408e5b1ff631576d946eb8c224b5ed |
| 2026-05-06T17:33:53.353Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 24 rows but only 6 distinct datetimes for pool 0x0e2c4be9f3408e5b1ff631576d946eb8c224b5ed |
| 2026-05-06T17:33:53.892Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GRT on mainnet (FDV cannot be computed) |
| 2026-05-06T17:33:54.298Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): LINK |
| 2026-05-06T17:33:54.300Z | `TOKEN_API_POOLS_FILTER_LEAKS` | pools?input_token=0x51491077 returned 3 unrelated pools (filter not enforced server-side) |
| 2026-05-06T17:33:55.859Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): GRT |
| 2026-05-06T17:33:55.860Z | `TOKEN_API_POOLS_FILTER_LEAKS` | pools?input_token=0xc944e90c returned 5 unrelated pools (filter not enforced server-side) |
| 2026-05-06T17:34:14.397Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xc2e9f25be6257c210d7adf0d4cd6e3e881ba25f8 |
| 2026-05-06T17:34:14.528Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 90 rows but only 23 distinct datetimes for pool 0xc2e9f25be6257c210d7adf0d4cd6e3e881ba25f8 |
| 2026-05-06T17:34:14.903Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 24 rows but only 6 distinct datetimes for pool 0xc2e9f25be6257c210d7adf0d4cd6e3e881ba25f8 |
| 2026-05-06T17:34:15.158Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for DAI on mainnet (FDV cannot be computed) |
| 2026-05-06T17:34:16.600Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): DAI |
| 2026-05-06T17:34:16.601Z | `TOKEN_API_POOLS_FILTER_LEAKS` | pools?input_token=0x6b175474 returned 2 unrelated pools (filter not enforced server-side) |
| 2026-05-06T17:34:27.607Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x59354356ec5d56306791873f567d61ebf11dfbd5 |
| 2026-05-06T17:34:27.758Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 90 rows but only 45 distinct datetimes for pool 0x59354356ec5d56306791873f567d61ebf11dfbd5 |
| 2026-05-06T17:34:27.919Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 24 rows but only 12 distinct datetimes for pool 0x59354356ec5d56306791873f567d61ebf11dfbd5 |
| 2026-05-06T17:34:27.968Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ARB on mainnet (FDV cannot be computed) |
| 2026-05-06T17:34:29.930Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): ARB |
| 2026-05-06T17:34:29.930Z | `TOKEN_API_POOLS_FILTER_LEAKS` | pools?input_token=0xb50721bc returned 3 unrelated pools (filter not enforced server-side) |
| 2026-05-06T17:34:34.981Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 90 rows but only 45 distinct datetimes for pool 0x11950d141ecb863f01007add7d1a342041227b58 |
| 2026-05-06T17:34:35.030Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x11950d141ecb863f01007add7d1a342041227b58 |
| 2026-05-06T17:34:35.206Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PEPE on mainnet (FDV cannot be computed) |
| 2026-05-06T17:34:35.254Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 24 rows but only 12 distinct datetimes for pool 0x11950d141ecb863f01007add7d1a342041227b58 |
| 2026-05-06T17:34:36.628Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): PEPE |
| 2026-05-06T17:34:36.629Z | `TOKEN_API_POOLS_FILTER_LEAKS` | pools?input_token=0x69825081 returned 3 unrelated pools (filter not enforced server-side) |
| 2026-05-06T17:35:48.214Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xdc2c21f1b54ddaf39e944689a8f90cb844135cc9 |
| 2026-05-06T17:35:48.365Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x8592064903ef23d34e4d5aaaed40abf6d96af186 |
| 2026-05-06T17:35:48.393Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x7a415b19932c0105c82fdb6b720bb01b0cc2cae3 |
| 2026-05-06T17:35:48.396Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xf56d08221b5942c428acc5de8f78489a97fc5599 |
| 2026-05-06T17:35:48.439Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x841820459769cd629b10a36fd12e603938cc2679 |
| 2026-05-06T17:35:48.480Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x1d42064fc4beb5f8aaf85f4617ae8b3b5b8bd801 |
| 2026-05-06T17:35:48.517Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x3019d4e366576a88d28b623afaf3ecb9ec9d9580 |
| 2026-05-06T17:35:48.539Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x99ac8ca7087fa4a2a1fb6357269965a2014abc35 |
| 2026-05-06T17:35:48.552Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x9febc984504356225405e26833608b17719c82ae |
| 2026-05-06T17:35:48.569Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x840deeef2f115cf50da625f7368c24af6fe74410 |
| 2026-05-06T17:35:48.574Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x5764a6f2212d502bc5970f9f129ffcd61e5d7563 |
| 2026-05-06T17:35:48.594Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xae614a7a56cb79c04df2aeba6f5dab80a39ca78e |
| 2026-05-06T17:35:48.620Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x000ba527862e5b82cff0f7c66b646af023274aa1 |
| 2026-05-06T17:35:48.643Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0xc63b0708e2f7e69cb8a1df0e1389a98c35a76d52 |
| 2026-05-06T17:35:48.703Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xe42318ea3b998e8355a3da364eb9d48ec725eb45 |
| 2026-05-06T17:35:48.717Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xea4ba4ce14fdd287f380b55419b1c5b6c3f22ab6 |
| 2026-05-06T17:35:48.718Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x5777d92f208679db4b9778590fa3cab3ac9e2168 |
| 2026-05-06T17:35:48.720Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x4e0924d3a751be199c426d52fb1f2337fa96f736 |
| 2026-05-06T17:35:48.728Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xa3f558aebaecaf0e11ca4b2199cc5ed341edfd74 |
| 2026-05-06T17:35:48.752Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xac4b3dacb91461209ae9d41ec517c2b9cb1b7daf |
| 2026-05-06T17:35:48.754Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xc3db44adc1fcdfd5671f555236eae49f4a8eea18 |
| 2026-05-06T17:35:48.909Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x4e68ccd3e89f51c3074ca5072bbac773960dfa36 |
| 2026-05-06T17:35:49.051Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PYUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:49.070Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FRAX on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:49.137Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ENS on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:49.188Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for cbETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:49.242Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for  on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:49.242Z | `TOKEN_API_MISSING_ICON` | icon missing for  on mainnet |
| 2026-05-06T17:35:49.243Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 96 rows but only 48 distinct datetimes for pool 0x9188d6690a84023ccfb712f409376587ee3b6b63 |
| 2026-05-06T17:35:49.247Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for STG on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:49.332Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for wstETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:49.333Z | `TOKEN_API_MISSING_ICON` | icon missing for wstETH on mainnet |
| 2026-05-06T17:35:49.345Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LDO on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:49.377Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for 1INCH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:49.408Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FLOKI on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:49.408Z | `TOKEN_API_MISSING_ICON` | icon missing for FLOKI on mainnet |
| 2026-05-06T17:35:49.445Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x4c83a7f819a5c37d64b4c5a2f8238ea082fa1f4e |
| 2026-05-06T17:35:49.474Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xbe80225f09645f172b079394312220637c440a63 |
| 2026-05-06T17:35:49.489Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xd8de6af55f618a7bc69835d55ddc6582220c36c0 |
| 2026-05-06T17:35:49.492Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x73a6a761fe483ba19debb8f56ac5bbf14c0cdad1 |
| 2026-05-06T17:35:49.506Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x06f00544c0bc62e6db10f46d370dfccdc23d8189 |
| 2026-05-06T17:35:49.518Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xcd8286b48936cdac20518247dbd310ab681a9fbf |
| 2026-05-06T17:35:49.521Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for AAVE on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:49.524Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SAND on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:49.525Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x13394005c1012e708fce1eb974f1130fdc73a5ce |
| 2026-05-06T17:35:49.534Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xe41552e6212cb6f7faa381c7bc9434c58bf28ce1 |
| 2026-05-06T17:35:49.552Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WBTC on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:49.553Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xeed4603bc333ef406e5eb691ba66798d5c857d8b |
| 2026-05-06T17:35:49.589Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xfd76be67fff3bac84e3d5444167bbc018f5968b6 |
| 2026-05-06T17:35:49.628Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x553e9c493678d8606d6a5ba284643db2110df823 |
| 2026-05-06T17:35:49.644Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x109830a1aaad605bbf02a9dfa7b0b92ec2fb7daa |
| 2026-05-06T17:35:49.648Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x5b97b125cf8af96834f2d08c8f1291bd47724939 |
| 2026-05-06T17:35:49.750Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x290a6a7460b308ee3f19023d2d00de604bcf5b42 |
| 2026-05-06T17:35:49.755Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x92560c178ce069cc014138ed3c2f5221ba71f58a |
| 2026-05-06T17:35:49.782Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x5c95d4b1c3321cf898d25949f41d50be2db5bc1d |
| 2026-05-06T17:35:49.795Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xede8dd046586d22625ae7ff2708f879ef7bdb8cf |
| 2026-05-06T17:35:49.801Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x5ab53ee1d50eef2c1dd3d5402789cd27bb52c1bb |
| 2026-05-06T17:35:49.814Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x57af956d3e2cca3b86f3d8c6772c03ddca3eaacb |
| 2026-05-06T17:35:49.833Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x73ea3d8ba3d7380201b270ec504b33ed5e478542 |
| 2026-05-06T17:35:49.988Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x8661ae7918c0115af9e3691662f605e9c550ddc9 |
| 2026-05-06T17:35:50.009Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xe8c6c9227491c0a8156a0106a0204d881bb7e531 |
| 2026-05-06T17:35:50.166Z | `TOKEN_API_MISSING_NAME` | name is null/empty for MKR on mainnet (contract 0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2) |
| 2026-05-06T17:35:50.498Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:50.675Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for RPL on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:50.961Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for sfrxETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:51.050Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FDUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:51.078Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SAFE on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:51.085Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for rETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:51.180Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for CRVUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:51.183Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PENDLE on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:51.190Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for BAL on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:51.190Z | `TOKEN_API_MISSING_ICON` | icon missing for BAL on mainnet |
| 2026-05-06T17:35:51.220Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for DYDX on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:51.222Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ezETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:51.222Z | `TOKEN_API_MISSING_ICON` | icon missing for ezETH on mainnet |
| 2026-05-06T17:35:51.372Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ENA on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:51.372Z | `TOKEN_API_MISSING_ICON` | icon missing for ENA on mainnet |
| 2026-05-06T17:35:51.462Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WLD on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:51.463Z | `TOKEN_API_MISSING_ICON` | icon missing for WLD on mainnet |
| 2026-05-06T17:35:51.469Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GNO on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:51.494Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for weETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:51.495Z | `TOKEN_API_MISSING_ICON` | icon missing for weETH on mainnet |
| 2026-05-06T17:35:51.498Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for IMX on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:51.547Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SNX on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:51.576Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GHO on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:51.579Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for CRV on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:51.626Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ETHFI on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:51.626Z | `TOKEN_API_MISSING_ICON` | icon missing for ETHFI on mainnet |
| 2026-05-06T17:35:51.644Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SUSHI on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:51.705Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for APE on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:51.736Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for COMP on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:51.762Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for AXS on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:52.105Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for MANA on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:52.405Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for UNI on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:52.750Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for BAT on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:53.396Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for MATIC on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:53.647Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-06T17:35:55.163Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SHIB on mainnet (FDV cannot be computed) |
| 2026-05-06T17:35:56.033Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for USDT on mainnet (FDV cannot be computed) |
| 2026-05-06T17:39:28.154Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 2 rows but only 1 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-06T17:39:28.303Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GRT on mainnet (FDV cannot be computed) |
| 2026-05-06T17:39:28.319Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 24 rows but only 6 distinct datetimes for pool 0x0e2c4be9f3408e5b1ff631576d946eb8c224b5ed |
| 2026-05-06T17:39:28.350Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x0e2c4be9f3408e5b1ff631576d946eb8c224b5ed |
| 2026-05-06T17:39:28.352Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 90 rows but only 23 distinct datetimes for pool 0x0e2c4be9f3408e5b1ff631576d946eb8c224b5ed |
| 2026-05-06T17:39:30.074Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): GRT |
| 2026-05-06T17:39:30.075Z | `TOKEN_API_POOLS_FILTER_LEAKS` | pools?input_token=0xc944e90c returned 5 unrelated pools (filter not enforced server-side) |
| 2026-05-06T17:40:27.710Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WBTC on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:27.748Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x5777d92f208679db4b9778590fa3cab3ac9e2168 |
| 2026-05-06T17:40:27.751Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-06T17:40:27.761Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x99ac8ca7087fa4a2a1fb6357269965a2014abc35 |
| 2026-05-06T17:40:27.791Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ezETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:27.792Z | `TOKEN_API_MISSING_ICON` | icon missing for ezETH on mainnet |
| 2026-05-06T17:40:27.793Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:27.794Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for wstETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:27.795Z | `TOKEN_API_MISSING_ICON` | icon missing for wstETH on mainnet |
| 2026-05-06T17:40:27.795Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PEPE on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:27.796Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SUSHI on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:27.796Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FRAX on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:27.798Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for AAVE on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:27.800Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for cbETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:27.811Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for 1INCH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:27.812Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FLOKI on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:27.812Z | `TOKEN_API_MISSING_ICON` | icon missing for FLOKI on mainnet |
| 2026-05-06T17:40:27.814Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LDO on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:27.818Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for IMX on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:27.821Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SAFE on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:27.822Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WLD on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:27.823Z | `TOKEN_API_MISSING_ICON` | icon missing for WLD on mainnet |
| 2026-05-06T17:40:27.835Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x11950d141ecb863f01007add7d1a342041227b58 |
| 2026-05-06T17:40:27.839Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x5ab53ee1d50eef2c1dd3d5402789cd27bb52c1bb |
| 2026-05-06T17:40:27.840Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x553e9c493678d8606d6a5ba284643db2110df823 |
| 2026-05-06T17:40:27.841Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x73a6a761fe483ba19debb8f56ac5bbf14c0cdad1 |
| 2026-05-06T17:40:27.844Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xe8c6c9227491c0a8156a0106a0204d881bb7e531 |
| 2026-05-06T17:40:27.845Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xac4b3dacb91461209ae9d41ec517c2b9cb1b7daf |
| 2026-05-06T17:40:27.845Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x4c83a7f819a5c37d64b4c5a2f8238ea082fa1f4e |
| 2026-05-06T17:40:27.847Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x9febc984504356225405e26833608b17719c82ae |
| 2026-05-06T17:40:27.848Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xeed4603bc333ef406e5eb691ba66798d5c857d8b |
| 2026-05-06T17:40:27.850Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for rETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:27.851Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x5b97b125cf8af96834f2d08c8f1291bd47724939 |
| 2026-05-06T17:40:27.855Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for UNI on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:27.863Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xbe80225f09645f172b079394312220637c440a63 |
| 2026-05-06T17:40:27.869Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for sfrxETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:27.877Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for BAL on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:27.877Z | `TOKEN_API_MISSING_ICON` | icon missing for BAL on mainnet |
| 2026-05-06T17:40:27.881Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ENS on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:27.891Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xd8de6af55f618a7bc69835d55ddc6582220c36c0 |
| 2026-05-06T17:40:27.899Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for COMP on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:27.901Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for weETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:27.902Z | `TOKEN_API_MISSING_ICON` | icon missing for weETH on mainnet |
| 2026-05-06T17:40:27.903Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8 |
| 2026-05-06T17:40:27.905Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ETHFI on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:27.905Z | `TOKEN_API_MISSING_ICON` | icon missing for ETHFI on mainnet |
| 2026-05-06T17:40:27.911Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xea4ba4ce14fdd287f380b55419b1c5b6c3f22ab6 |
| 2026-05-06T17:40:27.913Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for USDT on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:27.914Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PENDLE on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:27.916Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LINK on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:27.919Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for RPL on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:27.920Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SNX on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:27.920Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x7a415b19932c0105c82fdb6b720bb01b0cc2cae3 |
| 2026-05-06T17:40:27.922Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for MANA on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:27.922Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x840deeef2f115cf50da625f7368c24af6fe74410 |
| 2026-05-06T17:40:27.926Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for MATIC on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:27.928Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SHIB on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:27.930Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x5c95d4b1c3321cf898d25949f41d50be2db5bc1d |
| 2026-05-06T17:40:27.932Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GNO on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:27.937Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x1d42064fc4beb5f8aaf85f4617ae8b3b5b8bd801 |
| 2026-05-06T17:40:27.939Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xe42318ea3b998e8355a3da364eb9d48ec725eb45 |
| 2026-05-06T17:40:27.940Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xa3f558aebaecaf0e11ca4b2199cc5ed341edfd74 |
| 2026-05-06T17:40:27.944Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x4e0924d3a751be199c426d52fb1f2337fa96f736 |
| 2026-05-06T17:40:27.945Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x4e68ccd3e89f51c3074ca5072bbac773960dfa36 |
| 2026-05-06T17:40:27.946Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x13394005c1012e708fce1eb974f1130fdc73a5ce |
| 2026-05-06T17:40:27.947Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x109830a1aaad605bbf02a9dfa7b0b92ec2fb7daa |
| 2026-05-06T17:40:27.948Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xfd76be67fff3bac84e3d5444167bbc018f5968b6 |
| 2026-05-06T17:40:27.951Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x92560c178ce069cc014138ed3c2f5221ba71f58a |
| 2026-05-06T17:40:27.952Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x57af956d3e2cca3b86f3d8c6772c03ddca3eaacb |
| 2026-05-06T17:40:27.953Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x59354356ec5d56306791873f567d61ebf11dfbd5 |
| 2026-05-06T17:40:27.954Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xdc2c21f1b54ddaf39e944689a8f90cb844135cc9 |
| 2026-05-06T17:40:27.954Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x8592064903ef23d34e4d5aaaed40abf6d96af186 |
| 2026-05-06T17:40:27.955Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x000ba527862e5b82cff0f7c66b646af023274aa1 |
| 2026-05-06T17:40:27.958Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xcd8286b48936cdac20518247dbd310ab681a9fbf |
| 2026-05-06T17:40:27.959Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x8661ae7918c0115af9e3691662f605e9c550ddc9 |
| 2026-05-06T17:40:27.961Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xc3db44adc1fcdfd5671f555236eae49f4a8eea18 |
| 2026-05-06T17:40:27.963Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x841820459769cd629b10a36fd12e603938cc2679 |
| 2026-05-06T17:40:27.964Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x5764a6f2212d502bc5970f9f129ffcd61e5d7563 |
| 2026-05-06T17:40:27.987Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xe41552e6212cb6f7faa381c7bc9434c58bf28ce1 |
| 2026-05-06T17:40:27.994Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xae614a7a56cb79c04df2aeba6f5dab80a39ca78e |
| 2026-05-06T17:40:27.996Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x3019d4e366576a88d28b623afaf3ecb9ec9d9580 |
| 2026-05-06T17:40:28.050Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ENA on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:28.050Z | `TOKEN_API_MISSING_ICON` | icon missing for ENA on mainnet |
| 2026-05-06T17:40:28.063Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for  on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:28.064Z | `TOKEN_API_MISSING_ICON` | icon missing for  on mainnet |
| 2026-05-06T17:40:28.088Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for DYDX on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:28.093Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SAND on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:28.095Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for AXS on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:28.102Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ARB on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:28.105Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for STG on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:28.106Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for BAT on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:28.120Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xede8dd046586d22625ae7ff2708f879ef7bdb8cf |
| 2026-05-06T17:40:28.122Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xf56d08221b5942c428acc5de8f78489a97fc5599 |
| 2026-05-06T17:40:28.144Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x290a6a7460b308ee3f19023d2d00de604bcf5b42 |
| 2026-05-06T17:40:28.155Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x06f00544c0bc62e6db10f46d370dfccdc23d8189 |
| 2026-05-06T17:40:28.189Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for APE on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:28.190Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PYUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:28.192Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for CRV on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:28.193Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FDUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:28.194Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for DAI on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:28.199Z | `TOKEN_API_MISSING_NAME` | name is null/empty for MKR on mainnet (contract 0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2) |
| 2026-05-06T17:40:28.201Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for CRVUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:28.205Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GHO on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:28.242Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x73ea3d8ba3d7380201b270ec504b33ed5e478542 |
| 2026-05-06T17:40:28.244Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0xc63b0708e2f7e69cb8a1df0e1389a98c35a76d52 |
| 2026-05-06T17:40:28.251Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xc2e9f25be6257c210d7adf0d4cd6e3e881ba25f8 |
| 2026-05-06T17:40:28.262Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 96 rows but only 48 distinct datetimes for pool 0x9188d6690a84023ccfb712f409376587ee3b6b63 |
| 2026-05-06T17:40:30.876Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 24 rows but only 6 distinct datetimes for pool 0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8 |
| 2026-05-06T17:40:30.907Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 90 rows but only 23 distinct datetimes for pool 0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8 |
| 2026-05-06T17:40:35.233Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): LINK |
| 2026-05-06T17:40:35.233Z | `TOKEN_API_POOLS_FILTER_LEAKS` | pools?input_token=0x51491077 returned 3 unrelated pools (filter not enforced server-side) |
| 2026-05-06T17:40:35.298Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:40:36.931Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for USDC on mainnet (FDV cannot be computed) |
| 2026-05-06T17:46:11.731Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 2 rows but only 1 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-06T17:46:11.862Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LINK on mainnet (FDV cannot be computed) |
| 2026-05-06T17:46:11.884Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 24 rows but only 6 distinct datetimes for pool 0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8 |
| 2026-05-06T17:46:11.908Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8 |
| 2026-05-06T17:46:11.913Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 90 rows but only 23 distinct datetimes for pool 0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8 |
| 2026-05-06T17:46:13.783Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): LINK |
| 2026-05-06T17:46:13.783Z | `TOKEN_API_POOLS_FILTER_LEAKS` | pools?input_token=0x51491077 returned 3 unrelated pools (filter not enforced server-side) |
| 2026-05-06T17:46:15.872Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x0e2c4be9f3408e5b1ff631576d946eb8c224b5ed |
| 2026-05-06T17:46:15.873Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 24 rows but only 6 distinct datetimes for pool 0x0e2c4be9f3408e5b1ff631576d946eb8c224b5ed |
| 2026-05-06T17:46:16.632Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 90 rows but only 23 distinct datetimes for pool 0x0e2c4be9f3408e5b1ff631576d946eb8c224b5ed |
| 2026-05-06T17:46:17.021Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GRT on mainnet (FDV cannot be computed) |
| 2026-05-06T17:46:18.283Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): GRT |
| 2026-05-06T17:46:18.283Z | `TOKEN_API_POOLS_FILTER_LEAKS` | pools?input_token=0xc944e90c returned 5 unrelated pools (filter not enforced server-side) |
| 2026-05-06T17:47:13.263Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for USDC on mainnet (FDV cannot be computed) |
| 2026-05-06T17:47:13.531Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x5777d92f208679db4b9778590fa3cab3ac9e2168 |
| 2026-05-06T17:47:13.606Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 90 rows but only 12 distinct datetimes for pool 0x5777d92f208679db4b9778590fa3cab3ac9e2168 |
| 2026-05-06T17:47:14.050Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 24 rows but only 3 distinct datetimes for pool 0x5777d92f208679db4b9778590fa3cab3ac9e2168 |
| 2026-05-06T17:47:15.837Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): USDC |
| 2026-05-06T17:56:02.634Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x99ac8ca7087fa4a2a1fb6357269965a2014abc35 |
| 2026-05-06T17:56:03.280Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xd8de6af55f618a7bc69835d55ddc6582220c36c0 |
| 2026-05-06T17:56:03.530Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xf56d08221b5942c428acc5de8f78489a97fc5599 |
| 2026-05-06T17:56:03.651Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xede8dd046586d22625ae7ff2708f879ef7bdb8cf |
| 2026-05-06T17:56:03.665Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x5764a6f2212d502bc5970f9f129ffcd61e5d7563 |
| 2026-05-06T17:56:03.673Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x8661ae7918c0115af9e3691662f605e9c550ddc9 |
| 2026-05-06T17:56:03.694Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x06f00544c0bc62e6db10f46d370dfccdc23d8189 |
| 2026-05-06T17:56:03.695Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x3019d4e366576a88d28b623afaf3ecb9ec9d9580 |
| 2026-05-06T17:56:03.832Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xea4ba4ce14fdd287f380b55419b1c5b6c3f22ab6 |
| 2026-05-06T17:56:03.837Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xfd76be67fff3bac84e3d5444167bbc018f5968b6 |
| 2026-05-06T17:56:03.873Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xae614a7a56cb79c04df2aeba6f5dab80a39ca78e |
| 2026-05-06T17:56:03.887Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x5c95d4b1c3321cf898d25949f41d50be2db5bc1d |
| 2026-05-06T17:56:04.181Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x4e68ccd3e89f51c3074ca5072bbac773960dfa36 |
| 2026-05-06T17:56:04.196Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:04.262Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ezETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:04.262Z | `TOKEN_API_MISSING_ICON` | icon missing for ezETH on mainnet |
| 2026-05-06T17:56:04.306Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for STG on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:04.359Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SNX on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:04.375Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WLD on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:04.375Z | `TOKEN_API_MISSING_ICON` | icon missing for WLD on mainnet |
| 2026-05-06T17:56:04.382Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x73ea3d8ba3d7380201b270ec504b33ed5e478542 |
| 2026-05-06T17:56:04.391Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PENDLE on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:04.401Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PYUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:04.643Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for MANA on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:04.791Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xbe80225f09645f172b079394312220637c440a63 |
| 2026-05-06T17:56:04.828Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for BAT on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:04.840Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xdc2c21f1b54ddaf39e944689a8f90cb844135cc9 |
| 2026-05-06T17:56:04.873Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0xc63b0708e2f7e69cb8a1df0e1389a98c35a76d52 |
| 2026-05-06T17:56:04.888Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for MATIC on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:04.977Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xcd8286b48936cdac20518247dbd310ab681a9fbf |
| 2026-05-06T17:56:05.005Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x4e0924d3a751be199c426d52fb1f2337fa96f736 |
| 2026-05-06T17:56:05.015Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x4c83a7f819a5c37d64b4c5a2f8238ea082fa1f4e |
| 2026-05-06T17:56:05.064Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x8592064903ef23d34e4d5aaaed40abf6d96af186 |
| 2026-05-06T17:56:05.171Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xeed4603bc333ef406e5eb691ba66798d5c857d8b |
| 2026-05-06T17:56:05.193Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xe41552e6212cb6f7faa381c7bc9434c58bf28ce1 |
| 2026-05-06T17:56:05.194Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x1d42064fc4beb5f8aaf85f4617ae8b3b5b8bd801 |
| 2026-05-06T17:56:05.210Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x59354356ec5d56306791873f567d61ebf11dfbd5 |
| 2026-05-06T17:56:05.242Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x841820459769cd629b10a36fd12e603938cc2679 |
| 2026-05-06T17:56:05.336Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xe8c6c9227491c0a8156a0106a0204d881bb7e531 |
| 2026-05-06T17:56:05.350Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x7a415b19932c0105c82fdb6b720bb01b0cc2cae3 |
| 2026-05-06T17:56:05.373Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xc3db44adc1fcdfd5671f555236eae49f4a8eea18 |
| 2026-05-06T17:56:05.374Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x9febc984504356225405e26833608b17719c82ae |
| 2026-05-06T17:56:05.423Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x13394005c1012e708fce1eb974f1130fdc73a5ce |
| 2026-05-06T17:56:05.496Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x5ab53ee1d50eef2c1dd3d5402789cd27bb52c1bb |
| 2026-05-06T17:56:05.762Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xac4b3dacb91461209ae9d41ec517c2b9cb1b7daf |
| 2026-05-06T17:56:05.767Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xa3f558aebaecaf0e11ca4b2199cc5ed341edfd74 |
| 2026-05-06T17:56:05.796Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x57af956d3e2cca3b86f3d8c6772c03ddca3eaacb |
| 2026-05-06T17:56:05.798Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x11950d141ecb863f01007add7d1a342041227b58 |
| 2026-05-06T17:56:05.801Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x5b97b125cf8af96834f2d08c8f1291bd47724939 |
| 2026-05-06T17:56:05.808Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 96 rows but only 48 distinct datetimes for pool 0x9188d6690a84023ccfb712f409376587ee3b6b63 |
| 2026-05-06T17:56:05.821Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x73a6a761fe483ba19debb8f56ac5bbf14c0cdad1 |
| 2026-05-06T17:56:05.836Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x553e9c493678d8606d6a5ba284643db2110df823 |
| 2026-05-06T17:56:05.853Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x290a6a7460b308ee3f19023d2d00de604bcf5b42 |
| 2026-05-06T17:56:05.921Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x92560c178ce069cc014138ed3c2f5221ba71f58a |
| 2026-05-06T17:56:05.947Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xc2e9f25be6257c210d7adf0d4cd6e3e881ba25f8 |
| 2026-05-06T17:56:05.963Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x109830a1aaad605bbf02a9dfa7b0b92ec2fb7daa |
| 2026-05-06T17:56:05.969Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x840deeef2f115cf50da625f7368c24af6fe74410 |
| 2026-05-06T17:56:06.248Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xe42318ea3b998e8355a3da364eb9d48ec725eb45 |
| 2026-05-06T17:56:06.266Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x000ba527862e5b82cff0f7c66b646af023274aa1 |
| 2026-05-06T17:56:07.194Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for RPL on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:07.257Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for CRV on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:07.260Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ENS on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:07.454Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GNO on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:07.475Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FDUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:07.492Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SAFE on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:07.670Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for rETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:07.674Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for sfrxETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:07.675Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SUSHI on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:07.686Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GHO on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:07.701Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for BAL on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:07.702Z | `TOKEN_API_MISSING_ICON` | icon missing for BAL on mainnet |
| 2026-05-06T17:56:07.722Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for CRVUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:07.747Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FRAX on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:07.939Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for weETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:07.940Z | `TOKEN_API_MISSING_ICON` | icon missing for weETH on mainnet |
| 2026-05-06T17:56:07.941Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for  on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:07.942Z | `TOKEN_API_MISSING_ICON` | icon missing for  on mainnet |
| 2026-05-06T17:56:07.944Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ENA on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:07.945Z | `TOKEN_API_MISSING_ICON` | icon missing for ENA on mainnet |
| 2026-05-06T17:56:07.956Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for cbETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:07.979Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for DYDX on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:08.004Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for AXS on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:08.023Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for 1INCH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:08.118Z | `TOKEN_API_MISSING_NAME` | name is null/empty for MKR on mainnet (contract 0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2) |
| 2026-05-06T17:56:08.217Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LDO on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:08.218Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for wstETH on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:08.218Z | `TOKEN_API_MISSING_ICON` | icon missing for wstETH on mainnet |
| 2026-05-06T17:56:08.219Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for AAVE on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:08.220Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for IMX on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:08.222Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ARB on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:08.316Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for APE on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:08.319Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FLOKI on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:08.319Z | `TOKEN_API_MISSING_ICON` | icon missing for FLOKI on mainnet |
| 2026-05-06T17:56:08.334Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ETHFI on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:08.335Z | `TOKEN_API_MISSING_ICON` | icon missing for ETHFI on mainnet |
| 2026-05-06T17:56:08.339Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SAND on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:08.414Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for COMP on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:08.481Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PEPE on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:08.486Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WBTC on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:08.598Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for UNI on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:10.419Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-06T17:56:10.886Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for USDT on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:10.989Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SHIB on mainnet (FDV cannot be computed) |
| 2026-05-06T17:56:11.194Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for DAI on mainnet (FDV cannot be computed) |
| 2026-05-06T17:57:33.049Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 90 rows but only 23 distinct datetimes for pool 0x5764a6f2212d502bc5970f9f129ffcd61e5d7563 |
| 2026-05-06T17:57:33.172Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 24 rows but only 6 distinct datetimes for pool 0x5764a6f2212d502bc5970f9f129ffcd61e5d7563 |
| 2026-05-06T17:57:36.945Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): SHIB |
| 2026-05-06T17:57:36.945Z | `TOKEN_API_POOLS_FILTER_LEAKS` | pools?input_token=0x95ad61b0 returned 5 unrelated pools (filter not enforced server-side) |
| 2026-05-06T18:01:53.924Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 2 rows but only 1 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-06T18:01:54.104Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GRT on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.107Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 24 rows but only 6 distinct datetimes for pool 0x0e2c4be9f3408e5b1ff631576d946eb8c224b5ed |
| 2026-05-06T18:01:54.120Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x0e2c4be9f3408e5b1ff631576d946eb8c224b5ed |
| 2026-05-06T18:01:54.243Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WBTC on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.245Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-06T18:01:54.246Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x99ac8ca7087fa4a2a1fb6357269965a2014abc35 |
| 2026-05-06T18:01:54.362Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LINK on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.366Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for UNI on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.370Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for  on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.370Z | `TOKEN_API_MISSING_ICON` | icon missing for  on mainnet |
| 2026-05-06T18:01:54.373Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for AAVE on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.393Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for USDT on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.394Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ENS on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.395Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for DAI on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.403Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LDO on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.406Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PEPE on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.411Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for COMP on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.418Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for CRV on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.420Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FRAX on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.426Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.428Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xa3f558aebaecaf0e11ca4b2199cc5ed341edfd74 |
| 2026-05-06T18:01:54.431Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PYUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.435Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GHO on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.437Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x5ab53ee1d50eef2c1dd3d5402789cd27bb52c1bb |
| 2026-05-06T18:01:54.438Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8 |
| 2026-05-06T18:01:54.439Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xea4ba4ce14fdd287f380b55419b1c5b6c3f22ab6 |
| 2026-05-06T18:01:54.440Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SUSHI on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.442Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x4c83a7f819a5c37d64b4c5a2f8238ea082fa1f4e |
| 2026-05-06T18:01:54.443Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x4e68ccd3e89f51c3074ca5072bbac773960dfa36 |
| 2026-05-06T18:01:54.443Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xc2e9f25be6257c210d7adf0d4cd6e3e881ba25f8 |
| 2026-05-06T18:01:54.444Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x13394005c1012e708fce1eb974f1130fdc73a5ce |
| 2026-05-06T18:01:54.444Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0xc63b0708e2f7e69cb8a1df0e1389a98c35a76d52 |
| 2026-05-06T18:01:54.446Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x4e0924d3a751be199c426d52fb1f2337fa96f736 |
| 2026-05-06T18:01:54.447Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x7a415b19932c0105c82fdb6b720bb01b0cc2cae3 |
| 2026-05-06T18:01:54.454Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x73ea3d8ba3d7380201b270ec504b33ed5e478542 |
| 2026-05-06T18:01:54.456Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xac4b3dacb91461209ae9d41ec517c2b9cb1b7daf |
| 2026-05-06T18:01:54.457Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xe8c6c9227491c0a8156a0106a0204d881bb7e531 |
| 2026-05-06T18:01:54.458Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x92560c178ce069cc014138ed3c2f5221ba71f58a |
| 2026-05-06T18:01:54.462Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for sfrxETH on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.465Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x109830a1aaad605bbf02a9dfa7b0b92ec2fb7daa |
| 2026-05-06T18:01:54.470Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x1d42064fc4beb5f8aaf85f4617ae8b3b5b8bd801 |
| 2026-05-06T18:01:54.471Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x11950d141ecb863f01007add7d1a342041227b58 |
| 2026-05-06T18:01:54.474Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x840deeef2f115cf50da625f7368c24af6fe74410 |
| 2026-05-06T18:01:54.476Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x553e9c493678d8606d6a5ba284643db2110df823 |
| 2026-05-06T18:01:54.477Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for weETH on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.478Z | `TOKEN_API_MISSING_ICON` | icon missing for weETH on mainnet |
| 2026-05-06T18:01:54.480Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for wstETH on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.480Z | `TOKEN_API_MISSING_ICON` | icon missing for wstETH on mainnet |
| 2026-05-06T18:01:54.481Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for rETH on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.483Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ezETH on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.483Z | `TOKEN_API_MISSING_ICON` | icon missing for ezETH on mainnet |
| 2026-05-06T18:01:54.485Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xbe80225f09645f172b079394312220637c440a63 |
| 2026-05-06T18:01:54.487Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for cbETH on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.488Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PENDLE on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.489Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for 1INCH on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.492Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xeed4603bc333ef406e5eb691ba66798d5c857d8b |
| 2026-05-06T18:01:54.494Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for BAL on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.494Z | `TOKEN_API_MISSING_ICON` | icon missing for BAL on mainnet |
| 2026-05-06T18:01:54.495Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SAND on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.496Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SHIB on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.499Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x9febc984504356225405e26833608b17719c82ae |
| 2026-05-06T18:01:54.501Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xdc2c21f1b54ddaf39e944689a8f90cb844135cc9 |
| 2026-05-06T18:01:54.503Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x73a6a761fe483ba19debb8f56ac5bbf14c0cdad1 |
| 2026-05-06T18:01:54.505Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for DYDX on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.507Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xede8dd046586d22625ae7ff2708f879ef7bdb8cf |
| 2026-05-06T18:01:54.510Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xe42318ea3b998e8355a3da364eb9d48ec725eb45 |
| 2026-05-06T18:01:54.510Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ENA on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.511Z | `TOKEN_API_MISSING_ICON` | icon missing for ENA on mainnet |
| 2026-05-06T18:01:54.511Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for RPL on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.517Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x57af956d3e2cca3b86f3d8c6772c03ddca3eaacb |
| 2026-05-06T18:01:54.519Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xd8de6af55f618a7bc69835d55ddc6582220c36c0 |
| 2026-05-06T18:01:54.520Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xc3db44adc1fcdfd5671f555236eae49f4a8eea18 |
| 2026-05-06T18:01:54.522Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SNX on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.524Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xcd8286b48936cdac20518247dbd310ab681a9fbf |
| 2026-05-06T18:01:54.525Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for MATIC on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.525Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for STG on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.526Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ARB on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.527Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x290a6a7460b308ee3f19023d2d00de604bcf5b42 |
| 2026-05-06T18:01:54.528Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x59354356ec5d56306791873f567d61ebf11dfbd5 |
| 2026-05-06T18:01:54.529Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FLOKI on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.530Z | `TOKEN_API_MISSING_ICON` | icon missing for FLOKI on mainnet |
| 2026-05-06T18:01:54.534Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x8592064903ef23d34e4d5aaaed40abf6d96af186 |
| 2026-05-06T18:01:54.537Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GNO on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.539Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WLD on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.539Z | `TOKEN_API_MISSING_ICON` | icon missing for WLD on mainnet |
| 2026-05-06T18:01:54.540Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for MANA on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.541Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SAFE on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.542Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for AXS on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.548Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for BAT on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.550Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for IMX on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.551Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x5764a6f2212d502bc5970f9f129ffcd61e5d7563 |
| 2026-05-06T18:01:54.552Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xe41552e6212cb6f7faa381c7bc9434c58bf28ce1 |
| 2026-05-06T18:01:54.553Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x5b97b125cf8af96834f2d08c8f1291bd47724939 |
| 2026-05-06T18:01:54.554Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xfd76be67fff3bac84e3d5444167bbc018f5968b6 |
| 2026-05-06T18:01:54.555Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xae614a7a56cb79c04df2aeba6f5dab80a39ca78e |
| 2026-05-06T18:01:54.556Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x3019d4e366576a88d28b623afaf3ecb9ec9d9580 |
| 2026-05-06T18:01:54.560Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xf56d08221b5942c428acc5de8f78489a97fc5599 |
| 2026-05-06T18:01:54.566Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x000ba527862e5b82cff0f7c66b646af023274aa1 |
| 2026-05-06T18:01:54.567Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x8661ae7918c0115af9e3691662f605e9c550ddc9 |
| 2026-05-06T18:01:54.591Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ETHFI on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.601Z | `TOKEN_API_MISSING_ICON` | icon missing for ETHFI on mainnet |
| 2026-05-06T18:01:54.641Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x06f00544c0bc62e6db10f46d370dfccdc23d8189 |
| 2026-05-06T18:01:54.642Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x841820459769cd629b10a36fd12e603938cc2679 |
| 2026-05-06T18:01:54.756Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x5c95d4b1c3321cf898d25949f41d50be2db5bc1d |
| 2026-05-06T18:01:54.838Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for APE on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.842Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for CRVUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.846Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FDUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T18:01:54.867Z | `TOKEN_API_MISSING_NAME` | name is null/empty for MKR on mainnet (contract 0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2) |
| 2026-05-06T18:01:54.882Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 96 rows but only 48 distinct datetimes for pool 0x9188d6690a84023ccfb712f409376587ee3b6b63 |
| 2026-05-06T18:01:55.564Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x5777d92f208679db4b9778590fa3cab3ac9e2168 |
| 2026-05-06T18:01:58.559Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): GRT |
| 2026-05-06T18:01:58.560Z | `TOKEN_API_POOLS_FILTER_LEAKS` | pools?input_token=0xc944e90c returned 5 unrelated pools (filter not enforced server-side) |
| 2026-05-06T18:02:04.022Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for USDC on mainnet (FDV cannot be computed) |
| 2026-05-06T18:02:59.517Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 24 rows but only 12 distinct datetimes for pool 0x11950d141ecb863f01007add7d1a342041227b58 |
| 2026-05-06T18:03:04.212Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): PEPE |
| 2026-05-06T18:03:04.213Z | `TOKEN_API_POOLS_FILTER_LEAKS` | pools?input_token=0x69825081 returned 3 unrelated pools (filter not enforced server-side) |
| 2026-05-06T18:11:46.529Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 2 rows but only 1 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-06T18:11:46.839Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WBTC on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:46.841Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for USDC on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:46.939Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-06T18:11:46.940Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x99ac8ca7087fa4a2a1fb6357269965a2014abc35 |
| 2026-05-06T18:11:46.942Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for  on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:46.943Z | `TOKEN_API_MISSING_ICON` | icon missing for  on mainnet |
| 2026-05-06T18:11:46.944Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x11950d141ecb863f01007add7d1a342041227b58 |
| 2026-05-06T18:11:46.946Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xea4ba4ce14fdd287f380b55419b1c5b6c3f22ab6 |
| 2026-05-06T18:11:46.947Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LDO on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:46.948Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x4c83a7f819a5c37d64b4c5a2f8238ea082fa1f4e |
| 2026-05-06T18:11:46.949Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FRAX on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:46.950Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for COMP on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:46.955Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for CRV on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:46.959Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x13394005c1012e708fce1eb974f1130fdc73a5ce |
| 2026-05-06T18:11:46.960Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x73ea3d8ba3d7380201b270ec504b33ed5e478542 |
| 2026-05-06T18:11:46.961Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GHO on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:46.969Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FDUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:46.972Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x5777d92f208679db4b9778590fa3cab3ac9e2168 |
| 2026-05-06T18:11:46.983Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x0e2c4be9f3408e5b1ff631576d946eb8c224b5ed |
| 2026-05-06T18:11:46.984Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LINK on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:46.986Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8 |
| 2026-05-06T18:11:46.987Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x1d42064fc4beb5f8aaf85f4617ae8b3b5b8bd801 |
| 2026-05-06T18:11:46.990Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GRT on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:46.991Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for AAVE on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:46.992Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PEPE on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:46.994Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for UNI on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:46.995Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ENS on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:47.003Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x92560c178ce069cc014138ed3c2f5221ba71f58a |
| 2026-05-06T18:11:47.006Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xe8c6c9227491c0a8156a0106a0204d881bb7e531 |
| 2026-05-06T18:11:47.009Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xa3f558aebaecaf0e11ca4b2199cc5ed341edfd74 |
| 2026-05-06T18:11:47.011Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x5ab53ee1d50eef2c1dd3d5402789cd27bb52c1bb |
| 2026-05-06T18:11:47.011Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0xc63b0708e2f7e69cb8a1df0e1389a98c35a76d52 |
| 2026-05-06T18:11:47.014Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for weETH on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:47.015Z | `TOKEN_API_MISSING_ICON` | icon missing for weETH on mainnet |
| 2026-05-06T18:11:47.020Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for CRVUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:47.022Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SAND on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:47.024Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xede8dd046586d22625ae7ff2708f879ef7bdb8cf |
| 2026-05-06T18:11:47.026Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for AXS on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:47.028Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for BAL on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:47.029Z | `TOKEN_API_MISSING_ICON` | icon missing for BAL on mainnet |
| 2026-05-06T18:11:47.031Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SHIB on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:47.032Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x8592064903ef23d34e4d5aaaed40abf6d96af186 |
| 2026-05-06T18:11:47.033Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ENA on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:47.034Z | `TOKEN_API_MISSING_ICON` | icon missing for ENA on mainnet |
| 2026-05-06T18:11:47.035Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FLOKI on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:47.036Z | `TOKEN_API_MISSING_ICON` | icon missing for FLOKI on mainnet |
| 2026-05-06T18:11:47.037Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for RPL on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:47.038Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for STG on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:47.040Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xc3db44adc1fcdfd5671f555236eae49f4a8eea18 |
| 2026-05-06T18:11:47.042Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x3019d4e366576a88d28b623afaf3ecb9ec9d9580 |
| 2026-05-06T18:11:47.044Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xac4b3dacb91461209ae9d41ec517c2b9cb1b7daf |
| 2026-05-06T18:11:47.045Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xe42318ea3b998e8355a3da364eb9d48ec725eb45 |
| 2026-05-06T18:11:47.047Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x109830a1aaad605bbf02a9dfa7b0b92ec2fb7daa |
| 2026-05-06T18:11:47.048Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x7a415b19932c0105c82fdb6b720bb01b0cc2cae3 |
| 2026-05-06T18:11:47.055Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x553e9c493678d8606d6a5ba284643db2110df823 |
| 2026-05-06T18:11:47.056Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xd8de6af55f618a7bc69835d55ddc6582220c36c0 |
| 2026-05-06T18:11:47.058Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xdc2c21f1b54ddaf39e944689a8f90cb844135cc9 |
| 2026-05-06T18:11:47.059Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x5b97b125cf8af96834f2d08c8f1291bd47724939 |
| 2026-05-06T18:11:47.061Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x9febc984504356225405e26833608b17719c82ae |
| 2026-05-06T18:11:47.062Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ARB on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:47.063Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for sfrxETH on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:47.063Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for BAT on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:47.064Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for wstETH on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:47.065Z | `TOKEN_API_MISSING_ICON` | icon missing for wstETH on mainnet |
| 2026-05-06T18:11:47.069Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x4e0924d3a751be199c426d52fb1f2337fa96f736 |
| 2026-05-06T18:11:47.072Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x8661ae7918c0115af9e3691662f605e9c550ddc9 |
| 2026-05-06T18:11:47.072Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x59354356ec5d56306791873f567d61ebf11dfbd5 |
| 2026-05-06T18:11:47.073Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xbe80225f09645f172b079394312220637c440a63 |
| 2026-05-06T18:11:47.074Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for APE on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:47.074Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PENDLE on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:47.076Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for cbETH on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:47.078Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x4e68ccd3e89f51c3074ca5072bbac773960dfa36 |
| 2026-05-06T18:11:47.079Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 13 distinct datetimes for pool 0x5c95d4b1c3321cf898d25949f41d50be2db5bc1d |
| 2026-05-06T18:11:47.081Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SUSHI on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:47.094Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for 1INCH on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:47.097Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xc2e9f25be6257c210d7adf0d4cd6e3e881ba25f8 |
| 2026-05-06T18:11:47.099Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x290a6a7460b308ee3f19023d2d00de604bcf5b42 |
| 2026-05-06T18:11:47.100Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SNX on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:47.102Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x841820459769cd629b10a36fd12e603938cc2679 |
| 2026-05-06T18:11:47.103Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ezETH on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:47.103Z | `TOKEN_API_MISSING_ICON` | icon missing for ezETH on mainnet |
| 2026-05-06T18:11:47.104Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xcd8286b48936cdac20518247dbd310ab681a9fbf |
| 2026-05-06T18:11:47.106Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xf56d08221b5942c428acc5de8f78489a97fc5599 |
| 2026-05-06T18:11:47.111Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xe41552e6212cb6f7faa381c7bc9434c58bf28ce1 |
| 2026-05-06T18:11:47.114Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x5764a6f2212d502bc5970f9f129ffcd61e5d7563 |
| 2026-05-06T18:11:47.116Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for MATIC on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:47.117Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SAFE on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:47.118Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x840deeef2f115cf50da625f7368c24af6fe74410 |
| 2026-05-06T18:11:47.121Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0xeed4603bc333ef406e5eb691ba66798d5c857d8b |
| 2026-05-06T18:11:47.128Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for DYDX on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:47.133Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for MANA on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:47.134Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PYUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:47.139Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 50 distinct datetimes for pool 0x57af956d3e2cca3b86f3d8c6772c03ddca3eaacb |
| 2026-05-06T18:11:47.144Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x73a6a761fe483ba19debb8f56ac5bbf14c0cdad1 |
| 2026-05-06T18:11:47.145Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for rETH on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:47.155Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x06f00544c0bc62e6db10f46d370dfccdc23d8189 |
| 2026-05-06T18:11:47.159Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for IMX on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:47.160Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GNO on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:47.163Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WLD on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:47.163Z | `TOKEN_API_MISSING_ICON` | icon missing for WLD on mainnet |
| 2026-05-06T18:11:47.167Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xfd76be67fff3bac84e3d5444167bbc018f5968b6 |
| 2026-05-06T18:11:47.171Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ETHFI on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:47.171Z | `TOKEN_API_MISSING_ICON` | icon missing for ETHFI on mainnet |
| 2026-05-06T18:11:47.197Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0xae614a7a56cb79c04df2aeba6f5dab80a39ca78e |
| 2026-05-06T18:11:47.222Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x000ba527862e5b82cff0f7c66b646af023274aa1 |
| 2026-05-06T18:11:47.244Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LUSD on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:47.247Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for USDT on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:47.259Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for DAI on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:47.280Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 96 rows but only 48 distinct datetimes for pool 0x9188d6690a84023ccfb712f409376587ee3b6b63 |
| 2026-05-06T18:11:47.286Z | `TOKEN_API_MISSING_NAME` | name is null/empty for MKR on mainnet (contract 0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2) |
| 2026-05-06T18:11:52.830Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WETH on mainnet (FDV cannot be computed) |
| 2026-05-06T18:11:57.020Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): GRT |
| 2026-05-06T18:11:57.021Z | `TOKEN_API_POOLS_FILTER_LEAKS` | pools?input_token=0xc944e90c returned 5 unrelated pools (filter not enforced server-side) |
| 2026-05-06T18:15:42.715Z | `TOKEN_API_POOLS_QUERY_FAILED` | pools query failed for LINK: Token API 500 /v1/evm/pools: {"error":{"status":500,"code":"internal_server_error"}} |
| 2026-05-06T18:15:42.720Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): LINK |
| 2026-05-06T18:16:20.364Z | `TOKEN_API_POOLS_FILTER_LEAKS` | pools?input_token=0x51491077 returned 3 unrelated pools (filter not enforced server-side) |
| 2026-05-06T18:17:26.298Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): USDT |
| 2026-05-06T18:25:11.080Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 2 rows but only 1 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-06T18:25:11.224Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GRT on mainnet (FDV cannot be computed) |
| 2026-05-06T18:25:11.266Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x0e2c4be9f3408e5b1ff631576d946eb8c224b5ed |
| 2026-05-06T18:25:13.994Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): GRT |
| 2026-05-06T18:25:13.996Z | `TOKEN_API_POOLS_FILTER_LEAKS` | pools?input_token=0xc944e90c returned 5 unrelated pools (filter not enforced server-side) |
| 2026-05-06T18:25:30.775Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for USDT on mainnet (FDV cannot be computed) |
| 2026-05-06T18:25:30.816Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x4e68ccd3e89f51c3074ca5072bbac773960dfa36 |
| 2026-05-06T18:25:33.083Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): USDT |
| 2026-05-06T18:29:02.819Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 2 rows but only 1 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-06T18:29:02.991Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GRT on mainnet (FDV cannot be computed) |
| 2026-05-06T18:29:03.036Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x0e2c4be9f3408e5b1ff631576d946eb8c224b5ed |
| 2026-05-06T18:29:03.135Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 100 rows but only 25 distinct datetimes for pool 0x4e68ccd3e89f51c3074ca5072bbac773960dfa36 |
| 2026-05-06T18:29:07.753Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): GRT |
| 2026-05-06T18:29:07.754Z | `TOKEN_API_POOLS_FILTER_LEAKS` | pools?input_token=0xc944e90c returned 5 unrelated pools (filter not enforced server-side) |
| 2026-05-06T18:29:13.175Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): USDT |
| 2026-05-06T18:29:57.247Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for USDT on mainnet (FDV cannot be computed) |
| 2026-05-07T12:36:41.258Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 2 rows but only 1 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-07T12:36:41.564Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x0e2c4be9f3408e5b1ff631576d946eb8c224b5ed |
| 2026-05-07T12:36:41.652Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GRT on mainnet (FDV cannot be computed) |
| 2026-05-07T12:36:44.813Z | `TOKEN_API_HOLDERS_AMOUNT_STRING` | holders.amount returned as string base-units (OpenAPI says number): GRT |
| 2026-05-07T12:36:44.813Z | `TOKEN_API_POOLS_FILTER_LEAKS` | pools?input_token=0xc944e90c returned 5 unrelated pools (filter not enforced server-side) |
| 2026-05-07T13:42:53.104Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 2 rows but only 1 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-07T13:42:56.554Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xeed4603bc333ef406e5eb691ba66798d5c857d8b |
| 2026-05-07T13:42:56.646Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x223a719005e758599dfc7840507c67e5240a930e |
| 2026-05-07T13:42:56.649Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xf6e28a6bf73980d573cb53b71112b6886896ebcb |
| 2026-05-07T13:42:56.726Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x5b97b125cf8af96834f2d08c8f1291bd47724939 |
| 2026-05-07T13:42:56.819Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x14424eeecbff345b38187d0b8b749e56faa68539 |
| 2026-05-07T13:42:56.939Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 2 distinct datetimes for pool 0x9febc984504356225405e26833608b17719c82ae |
| 2026-05-07T13:42:56.977Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0xfd76be67fff3bac84e3d5444167bbc018f5968b6 |
| 2026-05-07T13:42:56.980Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x06f00544c0bc62e6db10f46d370dfccdc23d8189 |
| 2026-05-07T13:42:57.038Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xe41552e6212cb6f7faa381c7bc9434c58bf28ce1 |
| 2026-05-07T13:42:57.039Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x109830a1aaad605bbf02a9dfa7b0b92ec2fb7daa |
| 2026-05-07T13:42:57.073Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x13394005c1012e708fce1eb974f1130fdc73a5ce |
| 2026-05-07T13:42:57.123Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x7270233ccae676e776a659affc35219e6fcfbb10 |
| 2026-05-07T13:42:57.124Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x73a6a761fe483ba19debb8f56ac5bbf14c0cdad1 |
| 2026-05-07T13:42:57.139Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8 |
| 2026-05-07T13:42:57.176Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xea4ba4ce14fdd287f380b55419b1c5b6c3f22ab6 |
| 2026-05-07T13:42:57.195Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x059615ebf32c946aaab3d44491f78e4f8e97e1d3 |
| 2026-05-07T13:42:57.211Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x3019d4e366576a88d28b623afaf3ecb9ec9d9580 |
| 2026-05-07T13:42:57.255Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x4765aa201b3c457742e93a329a9719e1d129acd4 |
| 2026-05-07T13:42:57.273Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x59354356ec5d56306791873f567d61ebf11dfbd5 |
| 2026-05-07T13:42:57.290Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0xf56d08221b5942c428acc5de8f78489a97fc5599 |
| 2026-05-07T13:42:57.348Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0xac4fd96fcf729390a3c8044422a529028ec36751 |
| 2026-05-07T13:42:57.356Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 2 distinct datetimes for pool 0x5777d92f208679db4b9778590fa3cab3ac9e2168 |
| 2026-05-07T13:42:57.382Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xad6b651df72b443f57b76ff79165ee771272e18e |
| 2026-05-07T13:42:57.428Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x30ea22c879628514f1494d4bbfef79d21a6b49a2 |
| 2026-05-07T13:42:57.430Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0xc2e9f25be6257c210d7adf0d4cd6e3e881ba25f8 |
| 2026-05-07T13:42:57.442Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x360acf12e72044ba3eaaa654e51e4725c699dcb1 |
| 2026-05-07T13:42:57.458Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x5ab53ee1d50eef2c1dd3d5402789cd27bb52c1bb |
| 2026-05-07T13:42:57.459Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x4c83a7f819a5c37d64b4c5a2f8238ea082fa1f4e |
| 2026-05-07T13:42:57.481Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x1c98562a2fab5af19d8fb3291a36ac3c618835d9 |
| 2026-05-07T13:42:57.503Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x325365ed8275f6a74cac98917b7f6face8da533b |
| 2026-05-07T13:42:57.531Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xbe80225f09645f172b079394312220637c440a63 |
| 2026-05-07T13:42:57.536Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xcd423f3ab39a11ff1d9208b7d37df56e902c932b |
| 2026-05-07T13:42:57.554Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x7baece5d47f1bc5e1953fbe0e9931d54dab6d810 |
| 2026-05-07T13:42:57.555Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x290a6a7460b308ee3f19023d2d00de604bcf5b42 |
| 2026-05-07T13:42:57.579Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x127452f3f9cdc0389b0bf59ce6131aa3bd763598 |
| 2026-05-07T13:42:57.581Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xac4b3dacb91461209ae9d41ec517c2b9cb1b7daf |
| 2026-05-07T13:42:57.583Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x99ac8ca7087fa4a2a1fb6357269965a2014abc35 |
| 2026-05-07T13:42:57.638Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x4d1eff861316396dd1915f69b49f4c2d7b11590d |
| 2026-05-07T13:42:57.642Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0xae614a7a56cb79c04df2aeba6f5dab80a39ca78e |
| 2026-05-07T13:42:57.656Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0xa3f558aebaecaf0e11ca4b2199cc5ed341edfd74 |
| 2026-05-07T13:42:57.661Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x57af956d3e2cca3b86f3d8c6772c03ddca3eaacb |
| 2026-05-07T13:42:57.662Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xe8c6c9227491c0a8156a0106a0204d881bb7e531 |
| 2026-05-07T13:42:57.665Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 2 distinct datetimes for pool 0x5c95d4b1c3321cf898d25949f41d50be2db5bc1d |
| 2026-05-07T13:42:57.844Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x92560c178ce069cc014138ed3c2f5221ba71f58a |
| 2026-05-07T13:42:57.896Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x4e0924d3a751be199c426d52fb1f2337fa96f736 |
| 2026-05-07T13:42:57.970Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 2 distinct datetimes for pool 0xc63b0708e2f7e69cb8a1df0e1389a98c35a76d52 |
| 2026-05-07T13:42:57.974Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xe42318ea3b998e8355a3da364eb9d48ec725eb45 |
| 2026-05-07T13:42:57.977Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for NMR on mainnet (FDV cannot be computed) |
| 2026-05-07T13:42:57.982Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for APU on mainnet (FDV cannot be computed) |
| 2026-05-07T13:42:57.982Z | `TOKEN_API_MISSING_ICON` | icon missing for APU on mainnet |
| 2026-05-07T13:42:58.013Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x76366d95c2016446247296ea50c8d06d0585ae00 |
| 2026-05-07T13:42:58.035Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x8b65f72b5c3b1822d722d4927eda34f7efd8c7d2 |
| 2026-05-07T13:42:58.048Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x7b1e5d984a43ee732de195628d20d05cfabc3cc7 |
| 2026-05-07T13:42:58.133Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0xc2c390c6cd3c4e6c2b70727d35a45e8a072f18ca |
| 2026-05-07T13:42:58.157Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 2 distinct datetimes for pool 0xa66a2770bc0e0c65b63b5a3bb4560e90f95d6146 |
| 2026-05-07T13:42:58.253Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ZRO on mainnet (FDV cannot be computed) |
| 2026-05-07T13:42:58.253Z | `TOKEN_API_MISSING_ICON` | icon missing for ZRO on mainnet |
| 2026-05-07T13:42:58.258Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xf4c5e0f4590b6679b3030d29a84857f226087fef |
| 2026-05-07T13:42:58.258Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SWELL on mainnet (FDV cannot be computed) |
| 2026-05-07T13:42:58.302Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x1d42064fc4beb5f8aaf85f4617ae8b3b5b8bd801 |
| 2026-05-07T13:42:58.302Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ENS on mainnet (FDV cannot be computed) |
| 2026-05-07T13:42:58.304Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 2 distinct datetimes for pool 0xe6d7ebb9f1a9519dc06d557e03c522d53520e76a |
| 2026-05-07T13:42:58.346Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x9188d6690a84023ccfb712f409376587ee3b6b63 |
| 2026-05-07T13:42:58.347Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SAFE on mainnet (FDV cannot be computed) |
| 2026-05-07T13:42:58.347Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FRAX on mainnet (FDV cannot be computed) |
| 2026-05-07T13:42:58.369Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for OCEAN on mainnet (FDV cannot be computed) |
| 2026-05-07T13:42:58.382Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x11950d141ecb863f01007add7d1a342041227b58 |
| 2026-05-07T13:42:58.395Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x9e7809c21ba130c1a51c112928ea6474d9a9ae3c |
| 2026-05-07T13:42:58.442Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SOL on mainnet (FDV cannot be computed) |
| 2026-05-07T13:42:58.444Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x7a415b19932c0105c82fdb6b720bb01b0cc2cae3 |
| 2026-05-07T13:42:58.540Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for BAL on mainnet (FDV cannot be computed) |
| 2026-05-07T13:42:58.540Z | `TOKEN_API_MISSING_ICON` | icon missing for BAL on mainnet |
| 2026-05-07T13:42:58.555Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for USDS on mainnet (FDV cannot be computed) |
| 2026-05-07T13:42:58.555Z | `TOKEN_API_MISSING_ICON` | icon missing for USDS on mainnet |
| 2026-05-07T13:42:58.559Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xbdb04e915b94fbfd6e8552ff7860e59db7d4499a |
| 2026-05-07T13:42:58.561Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GNO on mainnet (FDV cannot be computed) |
| 2026-05-07T13:42:58.569Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WLD on mainnet (FDV cannot be computed) |
| 2026-05-07T13:42:58.569Z | `TOKEN_API_MISSING_ICON` | icon missing for WLD on mainnet |
| 2026-05-07T13:42:58.610Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LDO on mainnet (FDV cannot be computed) |
| 2026-05-07T13:42:58.674Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for weETH on mainnet (FDV cannot be computed) |
| 2026-05-07T13:42:58.675Z | `TOKEN_API_MISSING_ICON` | icon missing for weETH on mainnet |
| 2026-05-07T13:42:58.698Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for CHZ on mainnet (FDV cannot be computed) |
| 2026-05-07T13:42:58.736Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for BNB on mainnet (FDV cannot be computed) |
| 2026-05-07T13:42:58.820Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x975c822e26a514e7a1b75be587aefc738a73eee7 |
| 2026-05-07T13:42:58.826Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for EIGEN on mainnet (FDV cannot be computed) |
| 2026-05-07T13:42:58.826Z | `TOKEN_API_MISSING_ICON` | icon missing for EIGEN on mainnet |
| 2026-05-07T13:42:58.834Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FLOKI on mainnet (FDV cannot be computed) |
| 2026-05-07T13:42:58.835Z | `TOKEN_API_MISSING_ICON` | icon missing for FLOKI on mainnet |
| 2026-05-07T13:42:58.840Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ZRX on mainnet (FDV cannot be computed) |
| 2026-05-07T13:42:58.843Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LRC on mainnet (FDV cannot be computed) |
| 2026-05-07T13:42:58.870Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x8592064903ef23d34e4d5aaaed40abf6d96af186 |
| 2026-05-07T13:42:58.896Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for wstETH on mainnet (FDV cannot be computed) |
| 2026-05-07T13:42:58.897Z | `TOKEN_API_MISSING_ICON` | icon missing for wstETH on mainnet |
| 2026-05-07T13:42:58.943Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FET on mainnet (FDV cannot be computed) |
| 2026-05-07T13:42:58.948Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x0e2c4be9f3408e5b1ff631576d946eb8c224b5ed |
| 2026-05-07T13:42:58.975Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x120ffad35bb97a5baf9ab68f9dd7667864530245 |
| 2026-05-07T13:42:59.035Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PEPE on mainnet (FDV cannot be computed) |
| 2026-05-07T13:42:59.056Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PIXEL on mainnet (FDV cannot be computed) |
| 2026-05-07T13:42:59.090Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x9cb91e5451d29c84b51ffd40df0b724b639bf841 |
| 2026-05-07T13:42:59.096Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x283e2e83b7f3e297c4b7c02114ab0196b001a109 |
| 2026-05-07T13:42:59.233Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0xc3db44adc1fcdfd5671f555236eae49f4a8eea18 |
| 2026-05-07T13:42:59.262Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xd8de6af55f618a7bc69835d55ddc6582220c36c0 |
| 2026-05-07T13:42:59.278Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x000ba527862e5b82cff0f7c66b646af023274aa1 |
| 2026-05-07T13:42:59.295Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xdc2c21f1b54ddaf39e944689a8f90cb844135cc9 |
| 2026-05-07T13:42:59.296Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0xcd8286b48936cdac20518247dbd310ab681a9fbf |
| 2026-05-07T13:42:59.400Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for Metis on mainnet (FDV cannot be computed) |
| 2026-05-07T13:42:59.401Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x7832310cd0de39c4ce0a635f34d9a4b5b47fd434 |
| 2026-05-07T13:42:59.402Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x841820459769cd629b10a36fd12e603938cc2679 |
| 2026-05-07T13:42:59.404Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for MATIC on mainnet (FDV cannot be computed) |
| 2026-05-07T13:42:59.461Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x948b54a93f5ad1df6b8bff6dc249d99ca2eca052 |
| 2026-05-07T13:42:59.468Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x79a6683d82f25535ff3fd2753e03e0961060e882 |
| 2026-05-07T13:42:59.524Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x318fbee0a0d60e5de7009864632ceda8d77489b8 |
| 2026-05-07T13:42:59.525Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x6c063a6e8cd45869b5eb75291e65a3de298f3aa8 |
| 2026-05-07T13:42:59.525Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0xe936f0073549ad8b1fa53583600d629ba9375161 |
| 2026-05-07T13:42:59.526Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for TRU on mainnet (FDV cannot be computed) |
| 2026-05-07T13:42:59.527Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x840deeef2f115cf50da625f7368c24af6fe74410 |
| 2026-05-07T13:42:59.527Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0xede8dd046586d22625ae7ff2708f879ef7bdb8cf |
| 2026-05-07T13:42:59.531Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x8df016708a66377dae191ca6f9fff4705a3d951f |
| 2026-05-07T13:42:59.533Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x553e9c493678d8606d6a5ba284643db2110df823 |
| 2026-05-07T13:42:59.533Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 2 distinct datetimes for pool 0x73ea3d8ba3d7380201b270ec504b33ed5e478542 |
| 2026-05-07T13:42:59.559Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x5764a6f2212d502bc5970f9f129ffcd61e5d7563 |
| 2026-05-07T13:42:59.611Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x8661ae7918c0115af9e3691662f605e9c550ddc9 |
| 2026-05-07T13:42:59.693Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for swETH on mainnet (FDV cannot be computed) |
| 2026-05-07T13:42:59.786Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for wCFG on mainnet (FDV cannot be computed) |
| 2026-05-07T13:42:59.809Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for REZ on mainnet (FDV cannot be computed) |
| 2026-05-07T13:42:59.809Z | `TOKEN_API_MISSING_ICON` | icon missing for REZ on mainnet |
| 2026-05-07T13:42:59.867Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x4e68ccd3e89f51c3074ca5072bbac773960dfa36 |
| 2026-05-07T13:42:59.923Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FDUSD on mainnet (FDV cannot be computed) |
| 2026-05-07T13:42:59.977Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for TURBO on mainnet (FDV cannot be computed) |
| 2026-05-07T13:42:59.977Z | `TOKEN_API_MISSING_ICON` | icon missing for TURBO on mainnet |
| 2026-05-07T13:43:00.150Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for JASMY on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:00.201Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for DAI on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:00.283Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for BEAM on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:00.290Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for pufETH on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:00.290Z | `TOKEN_API_MISSING_ICON` | icon missing for pufETH on mainnet |
| 2026-05-07T13:43:00.337Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for rsETH on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:00.337Z | `TOKEN_API_MISSING_ICON` | icon missing for rsETH on mainnet |
| 2026-05-07T13:43:00.340Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for DYDX on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:00.421Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ezETH on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:00.421Z | `TOKEN_API_MISSING_ICON` | icon missing for ezETH on mainnet |
| 2026-05-07T13:43:00.581Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ONDO on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:00.581Z | `TOKEN_API_MISSING_ICON` | icon missing for ONDO on mainnet |
| 2026-05-07T13:43:00.585Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for USDE on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:00.585Z | `TOKEN_API_MISSING_ICON` | icon missing for USDE on mainnet |
| 2026-05-07T13:43:00.587Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for  on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:00.587Z | `TOKEN_API_MISSING_ICON` | icon missing for  on mainnet |
| 2026-05-07T13:43:00.633Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for MNT on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:00.635Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for STRK on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:00.649Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for BICO on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:00.649Z | `TOKEN_API_MISSING_ICON` | icon missing for BICO on mainnet |
| 2026-05-07T13:43:00.658Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GRT on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:00.675Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LUSD on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:00.767Z | `TOKEN_API_MISSING_NAME` | name is null/empty for MKR on mainnet (contract 0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2) |
| 2026-05-07T13:43:00.768Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for rETH on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:00.846Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ENA on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:00.846Z | `TOKEN_API_MISSING_ICON` | icon missing for ENA on mainnet |
| 2026-05-07T13:43:00.848Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for AAVE on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:00.949Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for INJ on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:00.955Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for MOG on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:01.021Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for STG on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:01.108Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for sfrxETH on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:01.112Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GHO on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:01.117Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for COMP on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:01.147Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for Neiro on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:01.147Z | `TOKEN_API_MISSING_ICON` | icon missing for Neiro on mainnet |
| 2026-05-07T13:43:01.170Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for RPL on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:01.182Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PENDLE on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:01.251Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ARB on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:01.395Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for cbETH on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:01.415Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SNX on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:01.430Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for CRVUSD on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:01.489Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for CRV on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:01.505Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PRIME on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:01.549Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for 1INCH on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:01.624Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ETHFI on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:01.624Z | `TOKEN_API_MISSING_ICON` | icon missing for ETHFI on mainnet |
| 2026-05-07T13:43:01.652Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for RENDER on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:01.652Z | `TOKEN_API_MISSING_ICON` | icon missing for RENDER on mainnet |
| 2026-05-07T13:43:01.655Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for AXS on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:01.658Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ARKM on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:01.694Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PYUSD on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:01.701Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-07T13:43:01.706Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for APE on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:01.808Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for UNI on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:01.811Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SAND on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:01.839Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SUSHI on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:01.863Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for AXL on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:01.912Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for BAT on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:01.918Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for IMX on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:02.101Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WBTC on mainnet (FDV cannot be computed) |
| 2026-05-07T13:43:02.181Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for MANA on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:38.223Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 2 rows but only 1 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-07T14:26:42.515Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x99ac8ca7087fa4a2a1fb6357269965a2014abc35 |
| 2026-05-07T14:26:42.714Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 2 distinct datetimes for pool 0x73ea3d8ba3d7380201b270ec504b33ed5e478542 |
| 2026-05-07T14:26:42.726Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x8b65f72b5c3b1822d722d4927eda34f7efd8c7d2 |
| 2026-05-07T14:26:43.425Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xe41552e6212cb6f7faa381c7bc9434c58bf28ce1 |
| 2026-05-07T14:26:43.641Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x223a719005e758599dfc7840507c67e5240a930e |
| 2026-05-07T14:26:43.663Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xd8de6af55f618a7bc69835d55ddc6582220c36c0 |
| 2026-05-07T14:26:43.672Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x8661ae7918c0115af9e3691662f605e9c550ddc9 |
| 2026-05-07T14:26:43.714Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xdc2c21f1b54ddaf39e944689a8f90cb844135cc9 |
| 2026-05-07T14:26:43.775Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x9cb91e5451d29c84b51ffd40df0b724b639bf841 |
| 2026-05-07T14:26:43.809Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x360acf12e72044ba3eaaa654e51e4725c699dcb1 |
| 2026-05-07T14:26:43.854Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x553e9c493678d8606d6a5ba284643db2110df823 |
| 2026-05-07T14:26:43.858Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x283e2e83b7f3e297c4b7c02114ab0196b001a109 |
| 2026-05-07T14:26:43.903Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x76366d95c2016446247296ea50c8d06d0585ae00 |
| 2026-05-07T14:26:43.943Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x318fbee0a0d60e5de7009864632ceda8d77489b8 |
| 2026-05-07T14:26:43.955Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x13394005c1012e708fce1eb974f1130fdc73a5ce |
| 2026-05-07T14:26:43.991Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x975c822e26a514e7a1b75be587aefc738a73eee7 |
| 2026-05-07T14:26:44.060Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x3019d4e366576a88d28b623afaf3ecb9ec9d9580 |
| 2026-05-07T14:26:44.154Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xad6b651df72b443f57b76ff79165ee771272e18e |
| 2026-05-07T14:26:44.156Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x79a6683d82f25535ff3fd2753e03e0961060e882 |
| 2026-05-07T14:26:44.199Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x7270233ccae676e776a659affc35219e6fcfbb10 |
| 2026-05-07T14:26:44.259Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x841820459769cd629b10a36fd12e603938cc2679 |
| 2026-05-07T14:26:44.260Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x4765aa201b3c457742e93a329a9719e1d129acd4 |
| 2026-05-07T14:26:44.261Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0xac4fd96fcf729390a3c8044422a529028ec36751 |
| 2026-05-07T14:26:44.269Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x73a6a761fe483ba19debb8f56ac5bbf14c0cdad1 |
| 2026-05-07T14:26:44.287Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x0e2c4be9f3408e5b1ff631576d946eb8c224b5ed |
| 2026-05-07T14:26:44.293Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x92560c178ce069cc014138ed3c2f5221ba71f58a |
| 2026-05-07T14:26:44.298Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xac4b3dacb91461209ae9d41ec517c2b9cb1b7daf |
| 2026-05-07T14:26:44.367Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x5b97b125cf8af96834f2d08c8f1291bd47724939 |
| 2026-05-07T14:26:44.381Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x059615ebf32c946aaab3d44491f78e4f8e97e1d3 |
| 2026-05-07T14:26:44.382Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x4e0924d3a751be199c426d52fb1f2337fa96f736 |
| 2026-05-07T14:26:44.424Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x9e7809c21ba130c1a51c112928ea6474d9a9ae3c |
| 2026-05-07T14:26:44.427Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 2 distinct datetimes for pool 0xe6d7ebb9f1a9519dc06d557e03c522d53520e76a |
| 2026-05-07T14:26:44.447Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0xede8dd046586d22625ae7ff2708f879ef7bdb8cf |
| 2026-05-07T14:26:44.463Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xea4ba4ce14fdd287f380b55419b1c5b6c3f22ab6 |
| 2026-05-07T14:26:44.466Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x59354356ec5d56306791873f567d61ebf11dfbd5 |
| 2026-05-07T14:26:44.492Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x4c83a7f819a5c37d64b4c5a2f8238ea082fa1f4e |
| 2026-05-07T14:26:44.587Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x109830a1aaad605bbf02a9dfa7b0b92ec2fb7daa |
| 2026-05-07T14:26:44.647Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x7b1e5d984a43ee732de195628d20d05cfabc3cc7 |
| 2026-05-07T14:26:44.670Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xcd423f3ab39a11ff1d9208b7d37df56e902c932b |
| 2026-05-07T14:26:44.694Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x1c98562a2fab5af19d8fb3291a36ac3c618835d9 |
| 2026-05-07T14:26:44.728Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0xf56d08221b5942c428acc5de8f78489a97fc5599 |
| 2026-05-07T14:26:44.774Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x11950d141ecb863f01007add7d1a342041227b58 |
| 2026-05-07T14:26:44.775Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xf6e28a6bf73980d573cb53b71112b6886896ebcb |
| 2026-05-07T14:26:44.785Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x14424eeecbff345b38187d0b8b749e56faa68539 |
| 2026-05-07T14:26:44.786Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x4d1eff861316396dd1915f69b49f4c2d7b11590d |
| 2026-05-07T14:26:44.826Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0xc2c390c6cd3c4e6c2b70727d35a45e8a072f18ca |
| 2026-05-07T14:26:44.882Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x57af956d3e2cca3b86f3d8c6772c03ddca3eaacb |
| 2026-05-07T14:26:44.915Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0xc2e9f25be6257c210d7adf0d4cd6e3e881ba25f8 |
| 2026-05-07T14:26:44.948Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x30ea22c879628514f1494d4bbfef79d21a6b49a2 |
| 2026-05-07T14:26:44.962Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0xa3f558aebaecaf0e11ca4b2199cc5ed341edfd74 |
| 2026-05-07T14:26:44.970Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8 |
| 2026-05-07T14:26:45.037Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x1d42064fc4beb5f8aaf85f4617ae8b3b5b8bd801 |
| 2026-05-07T14:26:45.173Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x127452f3f9cdc0389b0bf59ce6131aa3bd763598 |
| 2026-05-07T14:26:45.194Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 2 distinct datetimes for pool 0x5777d92f208679db4b9778590fa3cab3ac9e2168 |
| 2026-05-07T14:26:45.206Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xbe80225f09645f172b079394312220637c440a63 |
| 2026-05-07T14:26:45.277Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xe42318ea3b998e8355a3da364eb9d48ec725eb45 |
| 2026-05-07T14:26:45.278Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x4e68ccd3e89f51c3074ca5072bbac773960dfa36 |
| 2026-05-07T14:26:45.304Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xbdb04e915b94fbfd6e8552ff7860e59db7d4499a |
| 2026-05-07T14:26:45.435Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x5764a6f2212d502bc5970f9f129ffcd61e5d7563 |
| 2026-05-07T14:26:45.526Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xe8c6c9227491c0a8156a0106a0204d881bb7e531 |
| 2026-05-07T14:26:45.527Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x06f00544c0bc62e6db10f46d370dfccdc23d8189 |
| 2026-05-07T14:26:45.527Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x8592064903ef23d34e4d5aaaed40abf6d96af186 |
| 2026-05-07T14:26:45.540Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x5ab53ee1d50eef2c1dd3d5402789cd27bb52c1bb |
| 2026-05-07T14:26:45.575Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x7baece5d47f1bc5e1953fbe0e9931d54dab6d810 |
| 2026-05-07T14:26:45.711Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0xcd8286b48936cdac20518247dbd310ab681a9fbf |
| 2026-05-07T14:26:45.713Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x840deeef2f115cf50da625f7368c24af6fe74410 |
| 2026-05-07T14:26:45.713Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x7832310cd0de39c4ce0a635f34d9a4b5b47fd434 |
| 2026-05-07T14:26:45.714Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x7a415b19932c0105c82fdb6b720bb01b0cc2cae3 |
| 2026-05-07T14:26:45.763Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ezETH on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:45.763Z | `TOKEN_API_MISSING_ICON` | icon missing for ezETH on mainnet |
| 2026-05-07T14:26:45.794Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ZRO on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:45.794Z | `TOKEN_API_MISSING_ICON` | icon missing for ZRO on mainnet |
| 2026-05-07T14:26:45.803Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 2 distinct datetimes for pool 0xc63b0708e2f7e69cb8a1df0e1389a98c35a76d52 |
| 2026-05-07T14:26:45.910Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PIXEL on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.001Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 2 distinct datetimes for pool 0x5c95d4b1c3321cf898d25949f41d50be2db5bc1d |
| 2026-05-07T14:26:46.002Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for BICO on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.002Z | `TOKEN_API_MISSING_ICON` | icon missing for BICO on mainnet |
| 2026-05-07T14:26:46.004Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0xfd76be67fff3bac84e3d5444167bbc018f5968b6 |
| 2026-05-07T14:26:46.037Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for MOG on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.041Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for STRK on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.053Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x9188d6690a84023ccfb712f409376587ee3b6b63 |
| 2026-05-07T14:26:46.111Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xeed4603bc333ef406e5eb691ba66798d5c857d8b |
| 2026-05-07T14:26:46.145Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GHO on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.148Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GNO on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.295Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FRAX on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.298Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 2 distinct datetimes for pool 0xa66a2770bc0e0c65b63b5a3bb4560e90f95d6146 |
| 2026-05-07T14:26:46.377Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for TURBO on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.377Z | `TOKEN_API_MISSING_ICON` | icon missing for TURBO on mainnet |
| 2026-05-07T14:26:46.393Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for RPL on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.394Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for Neiro on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.394Z | `TOKEN_API_MISSING_ICON` | icon missing for Neiro on mainnet |
| 2026-05-07T14:26:46.396Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0xc3db44adc1fcdfd5671f555236eae49f4a8eea18 |
| 2026-05-07T14:26:46.433Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0xae614a7a56cb79c04df2aeba6f5dab80a39ca78e |
| 2026-05-07T14:26:46.437Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x948b54a93f5ad1df6b8bff6dc249d99ca2eca052 |
| 2026-05-07T14:26:46.438Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xf4c5e0f4590b6679b3030d29a84857f226087fef |
| 2026-05-07T14:26:46.438Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for MNT on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.439Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for swETH on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.440Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for TRU on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.445Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FDUSD on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.471Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x290a6a7460b308ee3f19023d2d00de604bcf5b42 |
| 2026-05-07T14:26:46.511Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x8df016708a66377dae191ca6f9fff4705a3d951f |
| 2026-05-07T14:26:46.513Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SWELL on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.519Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for sfrxETH on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.526Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for BEAM on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.578Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for IMX on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.622Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0xe936f0073549ad8b1fa53583600d629ba9375161 |
| 2026-05-07T14:26:46.646Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ARKM on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.651Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for REZ on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.651Z | `TOKEN_API_MISSING_ICON` | icon missing for REZ on mainnet |
| 2026-05-07T14:26:46.668Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for OCEAN on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.672Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PENDLE on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.738Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for weETH on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.738Z | `TOKEN_API_MISSING_ICON` | icon missing for weETH on mainnet |
| 2026-05-07T14:26:46.755Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ENS on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.763Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for INJ on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.789Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 2 distinct datetimes for pool 0x9febc984504356225405e26833608b17719c82ae |
| 2026-05-07T14:26:46.792Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for wstETH on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.792Z | `TOKEN_API_MISSING_ICON` | icon missing for wstETH on mainnet |
| 2026-05-07T14:26:46.797Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for CRVUSD on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.811Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for wCFG on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.825Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for STG on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.828Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for pufETH on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.828Z | `TOKEN_API_MISSING_ICON` | icon missing for pufETH on mainnet |
| 2026-05-07T14:26:46.829Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ARB on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.833Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for rsETH on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.833Z | `TOKEN_API_MISSING_ICON` | icon missing for rsETH on mainnet |
| 2026-05-07T14:26:46.849Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x325365ed8275f6a74cac98917b7f6face8da533b |
| 2026-05-07T14:26:46.850Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for USDE on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.850Z | `TOKEN_API_MISSING_ICON` | icon missing for USDE on mainnet |
| 2026-05-07T14:26:46.852Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for AXS on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.858Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x6c063a6e8cd45869b5eb75291e65a3de298f3aa8 |
| 2026-05-07T14:26:46.868Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for JASMY on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.877Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SAFE on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.889Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for  on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.889Z | `TOKEN_API_MISSING_ICON` | icon missing for  on mainnet |
| 2026-05-07T14:26:46.902Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for CRV on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.922Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for rETH on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.925Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for cbETH on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:46.936Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 3 distinct datetimes for pool 0x000ba527862e5b82cff0f7c66b646af023274aa1 |
| 2026-05-07T14:26:47.002Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for USDS on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:47.002Z | `TOKEN_API_MISSING_ICON` | icon missing for USDS on mainnet |
| 2026-05-07T14:26:47.040Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for APE on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:47.062Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ENA on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:47.062Z | `TOKEN_API_MISSING_ICON` | icon missing for ENA on mainnet |
| 2026-05-07T14:26:47.071Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ZRX on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:47.086Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LRC on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:47.103Z | `TOKEN_API_MISSING_NAME` | name is null/empty for MKR on mainnet (contract 0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2) |
| 2026-05-07T14:26:47.150Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for EIGEN on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:47.150Z | `TOKEN_API_MISSING_ICON` | icon missing for EIGEN on mainnet |
| 2026-05-07T14:26:47.151Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for COMP on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:47.152Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for AAVE on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:47.204Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ONDO on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:47.205Z | `TOKEN_API_MISSING_ICON` | icon missing for ONDO on mainnet |
| 2026-05-07T14:26:47.226Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for Metis on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:47.237Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LDO on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:47.360Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for CHZ on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:47.428Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for AXL on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:47.467Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FLOKI on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:47.467Z | `TOKEN_API_MISSING_ICON` | icon missing for FLOKI on mainnet |
| 2026-05-07T14:26:47.472Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FET on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:47.473Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PYUSD on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:47.482Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for NMR on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:47.491Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LUSD on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:47.503Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WLD on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:47.503Z | `TOKEN_API_MISSING_ICON` | icon missing for WLD on mainnet |
| 2026-05-07T14:26:47.516Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for DYDX on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:47.518Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for MANA on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:47.534Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PRIME on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:47.545Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SAND on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:47.557Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for BNB on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:47.559Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PEPE on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:47.575Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for BAT on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:47.607Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ETHFI on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:47.608Z | `TOKEN_API_MISSING_ICON` | icon missing for ETHFI on mainnet |
| 2026-05-07T14:26:47.620Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for 1INCH on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:47.623Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GRT on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:47.683Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SUSHI on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:47.687Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SNX on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:47.715Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SOL on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:47.735Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for BAL on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:47.735Z | `TOKEN_API_MISSING_ICON` | icon missing for BAL on mainnet |
| 2026-05-07T14:26:47.766Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for RENDER on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:47.767Z | `TOKEN_API_MISSING_ICON` | icon missing for RENDER on mainnet |
| 2026-05-07T14:26:47.786Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WBTC on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:47.800Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for UNI on mainnet (FDV cannot be computed) |
| 2026-05-07T14:26:48.586Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for MATIC on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:17.850Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 2 rows but only 1 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-07T15:45:24.105Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x0e2c4be9f3408e5b1ff631576d946eb8c224b5ed |
| 2026-05-07T15:45:24.338Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FRAX on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:24.341Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PRIME on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:24.675Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ARB on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:24.749Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LDO on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:24.808Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for AXL on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:24.936Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PENDLE on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:25.037Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LRC on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:25.079Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for TRU on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:25.082Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SAFE on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:25.101Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for STRK on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:25.106Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for CRV on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:25.133Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for rsETH on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:25.133Z | `TOKEN_API_MISSING_ICON` | icon missing for rsETH on mainnet |
| 2026-05-07T15:45:25.181Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for MNT on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:25.211Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SWELL on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:25.214Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FDUSD on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:25.257Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for wCFG on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:25.285Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for  on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:25.285Z | `TOKEN_API_MISSING_ICON` | icon missing for  on mainnet |
| 2026-05-07T15:45:25.324Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for Neiro on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:25.325Z | `TOKEN_API_MISSING_ICON` | icon missing for Neiro on mainnet |
| 2026-05-07T15:45:25.332Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for BICO on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:25.333Z | `TOKEN_API_MISSING_ICON` | icon missing for BICO on mainnet |
| 2026-05-07T15:45:25.355Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for rETH on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:25.366Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for sfrxETH on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:25.390Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for USDS on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:25.391Z | `TOKEN_API_MISSING_ICON` | icon missing for USDS on mainnet |
| 2026-05-07T15:45:25.478Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for LUSD on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:25.481Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for TURBO on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:25.481Z | `TOKEN_API_MISSING_ICON` | icon missing for TURBO on mainnet |
| 2026-05-07T15:45:25.517Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xa66a2770bc0e0c65b63b5a3bb4560e90f95d6146 |
| 2026-05-07T15:45:25.534Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ENS on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:25.616Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for COMP on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:25.754Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for BEAM on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:25.839Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x73a6a761fe483ba19debb8f56ac5bbf14c0cdad1 |
| 2026-05-07T15:45:25.840Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x76366d95c2016446247296ea50c8d06d0585ae00 |
| 2026-05-07T15:45:25.841Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for swETH on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:25.865Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for cbETH on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:25.912Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for NMR on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:25.948Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x9e7809c21ba130c1a51c112928ea6474d9a9ae3c |
| 2026-05-07T15:45:25.956Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x4765aa201b3c457742e93a329a9719e1d129acd4 |
| 2026-05-07T15:45:25.958Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x841820459769cd629b10a36fd12e603938cc2679 |
| 2026-05-07T15:45:25.972Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x8df016708a66377dae191ca6f9fff4705a3d951f |
| 2026-05-07T15:45:25.988Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xbe80225f09645f172b079394312220637c440a63 |
| 2026-05-07T15:45:25.991Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x223a719005e758599dfc7840507c67e5240a930e |
| 2026-05-07T15:45:26.008Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x3019d4e366576a88d28b623afaf3ecb9ec9d9580 |
| 2026-05-07T15:45:26.009Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x8592064903ef23d34e4d5aaaed40abf6d96af186 |
| 2026-05-07T15:45:26.013Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x325365ed8275f6a74cac98917b7f6face8da533b |
| 2026-05-07T15:45:26.040Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x7270233ccae676e776a659affc35219e6fcfbb10 |
| 2026-05-07T15:45:26.051Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for BAL on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:26.051Z | `TOKEN_API_MISSING_ICON` | icon missing for BAL on mainnet |
| 2026-05-07T15:45:26.054Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xae614a7a56cb79c04df2aeba6f5dab80a39ca78e |
| 2026-05-07T15:45:26.060Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xac4fd96fcf729390a3c8044422a529028ec36751 |
| 2026-05-07T15:45:26.077Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x553e9c493678d8606d6a5ba284643db2110df823 |
| 2026-05-07T15:45:26.098Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x9cb91e5451d29c84b51ffd40df0b724b639bf841 |
| 2026-05-07T15:45:26.109Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x5b97b125cf8af96834f2d08c8f1291bd47724939 |
| 2026-05-07T15:45:26.124Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for CRVUSD on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:26.129Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xbdb04e915b94fbfd6e8552ff7860e59db7d4499a |
| 2026-05-07T15:45:26.134Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WLD on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:26.134Z | `TOKEN_API_MISSING_ICON` | icon missing for WLD on mainnet |
| 2026-05-07T15:45:26.153Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xcd423f3ab39a11ff1d9208b7d37df56e902c932b |
| 2026-05-07T15:45:26.239Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ETHFI on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:26.239Z | `TOKEN_API_MISSING_ICON` | icon missing for ETHFI on mainnet |
| 2026-05-07T15:45:26.241Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x57af956d3e2cca3b86f3d8c6772c03ddca3eaacb |
| 2026-05-07T15:45:26.249Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x99ac8ca7087fa4a2a1fb6357269965a2014abc35 |
| 2026-05-07T15:45:26.251Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xe8c6c9227491c0a8156a0106a0204d881bb7e531 |
| 2026-05-07T15:45:26.254Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x9febc984504356225405e26833608b17719c82ae |
| 2026-05-07T15:45:26.271Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x7a415b19932c0105c82fdb6b720bb01b0cc2cae3 |
| 2026-05-07T15:45:26.276Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x1d42064fc4beb5f8aaf85f4617ae8b3b5b8bd801 |
| 2026-05-07T15:45:26.277Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ARKM on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:26.330Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FLOKI on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:26.331Z | `TOKEN_API_MISSING_ICON` | icon missing for FLOKI on mainnet |
| 2026-05-07T15:45:26.352Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for USDE on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:26.353Z | `TOKEN_API_MISSING_ICON` | icon missing for USDE on mainnet |
| 2026-05-07T15:45:26.355Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xc3db44adc1fcdfd5671f555236eae49f4a8eea18 |
| 2026-05-07T15:45:26.367Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for IMX on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:26.414Z | `TOKEN_API_MISSING_NAME` | name is null/empty for MKR on mainnet (contract 0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2) |
| 2026-05-07T15:45:26.431Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PYUSD on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:26.437Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for FET on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:26.445Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xf6e28a6bf73980d573cb53b71112b6886896ebcb |
| 2026-05-07T15:45:26.473Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for AXS on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:26.502Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for APE on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:26.524Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xe936f0073549ad8b1fa53583600d629ba9375161 |
| 2026-05-07T15:45:26.526Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PIXEL on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:26.555Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xfd76be67fff3bac84e3d5444167bbc018f5968b6 |
| 2026-05-07T15:45:26.556Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x06f00544c0bc62e6db10f46d370dfccdc23d8189 |
| 2026-05-07T15:45:26.573Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x948b54a93f5ad1df6b8bff6dc249d99ca2eca052 |
| 2026-05-07T15:45:26.631Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GRT on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:26.638Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xe42318ea3b998e8355a3da364eb9d48ec725eb45 |
| 2026-05-07T15:45:26.639Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xad6b651df72b443f57b76ff79165ee771272e18e |
| 2026-05-07T15:45:26.667Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for PEPE on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:26.684Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x73ea3d8ba3d7380201b270ec504b33ed5e478542 |
| 2026-05-07T15:45:26.731Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xeed4603bc333ef406e5eb691ba66798d5c857d8b |
| 2026-05-07T15:45:26.884Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for WBTC on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:26.990Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xf56d08221b5942c428acc5de8f78489a97fc5599 |
| 2026-05-07T15:45:26.995Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x283e2e83b7f3e297c4b7c02114ab0196b001a109 |
| 2026-05-07T15:45:26.996Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x13394005c1012e708fce1eb974f1130fdc73a5ce |
| 2026-05-07T15:45:27.041Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x9188d6690a84023ccfb712f409376587ee3b6b63 |
| 2026-05-07T15:45:27.051Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x1c98562a2fab5af19d8fb3291a36ac3c618835d9 |
| 2026-05-07T15:45:27.058Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x4c83a7f819a5c37d64b4c5a2f8238ea082fa1f4e |
| 2026-05-07T15:45:27.064Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x059615ebf32c946aaab3d44491f78e4f8e97e1d3 |
| 2026-05-07T15:45:27.093Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for AAVE on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:27.103Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x5c95d4b1c3321cf898d25949f41d50be2db5bc1d |
| 2026-05-07T15:45:27.132Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x8b65f72b5c3b1822d722d4927eda34f7efd8c7d2 |
| 2026-05-07T15:45:27.167Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x14424eeecbff345b38187d0b8b749e56faa68539 |
| 2026-05-07T15:45:27.217Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for MOG on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:27.309Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xea4ba4ce14fdd287f380b55419b1c5b6c3f22ab6 |
| 2026-05-07T15:45:27.333Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GHO on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:27.400Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for OCEAN on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:27.422Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x79a6683d82f25535ff3fd2753e03e0961060e882 |
| 2026-05-07T15:45:27.445Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x30ea22c879628514f1494d4bbfef79d21a6b49a2 |
| 2026-05-07T15:45:27.513Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xac4b3dacb91461209ae9d41ec517c2b9cb1b7daf |
| 2026-05-07T15:45:27.514Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xcd8286b48936cdac20518247dbd310ab681a9fbf |
| 2026-05-07T15:45:27.540Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x360acf12e72044ba3eaaa654e51e4725c699dcb1 |
| 2026-05-07T15:45:27.549Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640 |
| 2026-05-07T15:45:27.592Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x8661ae7918c0115af9e3691662f605e9c550ddc9 |
| 2026-05-07T15:45:27.610Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for pufETH on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:27.611Z | `TOKEN_API_MISSING_ICON` | icon missing for pufETH on mainnet |
| 2026-05-07T15:45:27.751Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for REZ on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:27.752Z | `TOKEN_API_MISSING_ICON` | icon missing for REZ on mainnet |
| 2026-05-07T15:45:27.762Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xe6d7ebb9f1a9519dc06d557e03c522d53520e76a |
| 2026-05-07T15:45:27.768Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xc63b0708e2f7e69cb8a1df0e1389a98c35a76d52 |
| 2026-05-07T15:45:27.780Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x290a6a7460b308ee3f19023d2d00de604bcf5b42 |
| 2026-05-07T15:45:27.805Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xdc2c21f1b54ddaf39e944689a8f90cb844135cc9 |
| 2026-05-07T15:45:27.809Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x4d1eff861316396dd1915f69b49f4c2d7b11590d |
| 2026-05-07T15:45:27.853Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xf4c5e0f4590b6679b3030d29a84857f226087fef |
| 2026-05-07T15:45:27.879Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8 |
| 2026-05-07T15:45:27.887Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x318fbee0a0d60e5de7009864632ceda8d77489b8 |
| 2026-05-07T15:45:27.919Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x5777d92f208679db4b9778590fa3cab3ac9e2168 |
| 2026-05-07T15:45:27.927Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x4e0924d3a751be199c426d52fb1f2337fa96f736 |
| 2026-05-07T15:45:27.964Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x5ab53ee1d50eef2c1dd3d5402789cd27bb52c1bb |
| 2026-05-07T15:45:27.978Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x4e68ccd3e89f51c3074ca5072bbac773960dfa36 |
| 2026-05-07T15:45:28.044Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x840deeef2f115cf50da625f7368c24af6fe74410 |
| 2026-05-07T15:45:28.051Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x975c822e26a514e7a1b75be587aefc738a73eee7 |
| 2026-05-07T15:45:28.055Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for wstETH on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:28.055Z | `TOKEN_API_MISSING_ICON` | icon missing for wstETH on mainnet |
| 2026-05-07T15:45:28.058Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x7832310cd0de39c4ce0a635f34d9a4b5b47fd434 |
| 2026-05-07T15:45:28.064Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x109830a1aaad605bbf02a9dfa7b0b92ec2fb7daa |
| 2026-05-07T15:45:28.096Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x7baece5d47f1bc5e1953fbe0e9931d54dab6d810 |
| 2026-05-07T15:45:28.109Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x11950d141ecb863f01007add7d1a342041227b58 |
| 2026-05-07T15:45:28.261Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x59354356ec5d56306791873f567d61ebf11dfbd5 |
| 2026-05-07T15:45:28.263Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for JASMY on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:28.264Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for Metis on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:28.268Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for 1INCH on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:28.269Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ONDO on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:28.270Z | `TOKEN_API_MISSING_ICON` | icon missing for ONDO on mainnet |
| 2026-05-07T15:45:28.291Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SHIB on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:28.395Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xc2e9f25be6257c210d7adf0d4cd6e3e881ba25f8 |
| 2026-05-07T15:45:28.442Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for GNO on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:28.463Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x000ba527862e5b82cff0f7c66b646af023274aa1 |
| 2026-05-07T15:45:28.495Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for DYDX on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:28.522Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xd8de6af55f618a7bc69835d55ddc6582220c36c0 |
| 2026-05-07T15:45:28.564Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xede8dd046586d22625ae7ff2708f879ef7bdb8cf |
| 2026-05-07T15:45:28.566Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ezETH on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:28.568Z | `TOKEN_API_MISSING_ICON` | icon missing for ezETH on mainnet |
| 2026-05-07T15:45:28.569Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0x5764a6f2212d502bc5970f9f129ffcd61e5d7563 |
| 2026-05-07T15:45:28.577Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for weETH on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:28.577Z | `TOKEN_API_MISSING_ICON` | icon missing for weETH on mainnet |
| 2026-05-07T15:45:28.593Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SUSHI on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:28.679Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for ENA on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:28.680Z | `TOKEN_API_MISSING_ICON` | icon missing for ENA on mainnet |
| 2026-05-07T15:45:28.698Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for RENDER on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:28.698Z | `TOKEN_API_MISSING_ICON` | icon missing for RENDER on mainnet |
| 2026-05-07T15:45:28.716Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for SAND on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:28.724Z | `TOKEN_API_NO_TOTAL_SUPPLY` | total_supply is null for MANA on mainnet (FDV cannot be computed) |
| 2026-05-07T15:45:28.725Z | `TOKEN_API_OHLC_DUPES` | OHLC returned 10 rows but only 5 distinct datetimes for pool 0xe41552e6212cb6f7faa381c7bc9434c58bf28ce1 |
