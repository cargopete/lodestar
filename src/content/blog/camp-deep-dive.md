---
title: "camp Deep Dive: Decoded Protocol Data, Raw SQL, and the Flight Shim"
date: "2026-05-28"
author: "cargopete"
tags: ["amp", "camp", "arbitrum", "uniswap-v3", "horizon", "data-services", "infrastructure", "sql"]
category: "Infrastructure"
excerpt: "A technical look at how camp v0.2.0 decodes Uniswap V3 and Graph Horizon events on-the-fly, how the raw SQL endpoint guards against abuse without a parser, and why ampd v0.0.36 required a Flight shim to stay online."
---

The [introductory camp post](/blog/camp-free-amp-api-arbitrum) covered the basics: what Amp is, what camp wraps around it, and the endpoint catalogue. That post was written when decoded protocol data was still a roadmap item.

It's all shipped now. This post is the technical follow-through: how the EVM decode layer works, what the Uniswap V3 and Horizon endpoints actually return, how the raw SQL endpoint guards itself without a full SQL parser, and why an ampd version bump required writing a Flight shim to keep the service running.

---

## The EVM UDF layer

Everything that makes camp more than a log-dump endpoint rests on two UDFs that `ampd` exposes inside its DataFusion query engine.

**`evm_topic(canonical_signature)`**: takes the canonical ABI event signature (no argument names, no `indexed` keywords, no spaces) and returns the topic0 keccak256 hash as a binary value. This is the `WHERE topic0 =` filter that makes event queries exact.

**`evm_decode_log(topic1, topic2, topic3, data, decode_signature)`**: takes the four log columns and the full event signature (with argument names and `indexed` keywords in place) and returns a DataFusion struct. Each field in the struct corresponds to one event argument, already typed: `address` arguments come back as binary, `uint256` and `int256` as numeric.

The two signatures look similar but serve different purposes:

```
-- What evm_topic expects (canonical form, no names, no `indexed`):
'Swap(address,address,int256,int256,uint160,uint128,int24)'

-- What evm_decode_log expects (full Solidity form, names and `indexed`):
'Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)'
```

A decoded query for Uniswap V3 Swap events looks like this in raw SQL:

```sql
SELECT
  block_num,
  log_index,
  (evm_decode_log(topic1, topic2, topic3, data,
    'Swap(address indexed sender, address indexed recipient,
     int256 amount0, int256 amount1, uint160 sqrtPriceX96,
     uint128 liquidity, int24 tick)')) AS d
FROM "_/arbitrum_one@2.0.0".logs
WHERE block_num BETWEEN 266900000 AND 267000000
  AND address = X'e6a00d97da1a1ef5f18c4c9b8e5fc18e41d49e6d'
  AND topic0 = evm_topic('Swap(address,address,int256,int256,uint160,uint128,int24)')
```

The `d` struct is then projected field by field — addresses get `encode(arrow_cast(d['sender'], 'Binary'), 'hex')` to produce a hex string; numeric fields get `arrow_cast(d['amount0'], 'Utf8')` to produce a decimal string.

That last point is worth pausing on.

### The uint256 precision problem

JavaScript's `Number` type has 53 bits of integer precision. A `uint256` token amount with 18 decimal places is a 256-bit integer — feeding it through `JSON.parse` as a native number will silently lose precision for any value above ~9 quadrillion. For a USDC transfer (6 decimals) this is usually fine; for a WBTC or GRT transfer with 18 decimals at large volumes, it is not.

camp serialises every `uint` and `int` field as a decimal string in JSON. If you're consuming the API you should treat these as `BigInt` in JavaScript or `int` in Python — they won't overflow, but they also won't fit in a float.

```json
{
  "amount0": "-1500000000",
  "amount1": "750000000000000000",
  "sqrtPriceX96": "1345678901234567890123456789"
}
```

Binary fields (addresses, tx hashes) are hex-encoded with a `0x` prefix. The raw `Binary` type that DataFusion returns is hex-encoded via `encode(arrow_cast(col, 'Binary'), 'hex')` before being handed to the JSON serialiser.

---

## Decoded Uniswap V3

Three events, one required parameter: the pool address.

### Swap

```
GET /v1/uniswap-v3/swap?pool=0xe6a00d…&from_block=N&to_block=M
```

Response shape:

```json
{
  "event": "Swap",
  "pool": "0xe6a00d…",
  "count": 12,
  "events": [
    {
      "block_num": 267000100,
      "log_index": 3,
      "tx_hash": "0xabcd…",
      "sender": "0x1234…",
      "recipient": "0x5678…",
      "amount0": "-5000000",
      "amount1": "2500000000000000",
      "sqrtPriceX96": "1345678901234567890123456789012",
      "liquidity": "123456789012345678",
      "tick": "-12345"
    }
  ]
}
```

`amount0` and `amount1` are signed — a negative value means that token left the pool. For a USDC/ETH pool, a trade sending ETH in and receiving USDC would show a negative `amount0` (USDC out) and a positive `amount1` (ETH in).

`sqrtPriceX96` is the post-swap price in Q64.96 fixed-point. To get the human-readable price of token1 in terms of token0: `(sqrtPriceX96 / 2^96)^2 * 10^(decimals0 - decimals1)`. camp returns this raw; converting it is a one-liner in your client.

`tick` is the current tick index after the swap. Each tick represents a 0.01% price increment (`1.0001^tick`).

Optional filters: the endpoint accepts `sender` and `recipient` query parameters to narrow by indexed address. It resolves which topic number each address maps to at query time, so you can filter on sender without knowing the topic layout.

### Mint and Burn

```
GET /v1/uniswap-v3/mint?pool=0xe6a00d…&from_block=N&to_block=M
GET /v1/uniswap-v3/burn?pool=0xe6a00d…&from_block=N&to_block=M
```

Both return `tickLower`, `tickUpper`, `amount` (the liquidity delta), and `amount0`/`amount1` (the actual tokens deposited or withdrawn). Together these let you reconstruct the full liquidity lifecycle of a pool without running a subgraph.

---

## Decoded Graph Horizon

Graph Horizon is the staking layer for The Graph Protocol's new service payment model, deployed on Arbitrum One at `0x00669a4cf01450b64e8a2a20e9b1fcb71e61ef03`. camp decodes 12 of its events.

```
GET /v1/horizon            — catalog of supported events
GET /v1/horizon/{slug}     — paginated decoded events
```

The 12 events cover four areas of the staking lifecycle:

**Stake management**: `horizon-stake-deposited`, `horizon-stake-locked`, `horizon-stake-withdrawn`. A service provider's direct GRT position in the staking contract.

**Provisions**: `provision-created`, `provision-increased`, `provision-thawed`, `tokens-deprovisioned`. A provision is a ring-fenced slice of a service provider's stake allocated to a specific verifier. Creating a provision locks tokens under that verifier's slashing conditions.

**Slashing**: `provision-slashed`, `delegation-slashed`. When a verifier slashes a service provider, these events record the tokens burned.

**Delegations**: `tokens-delegated`, `tokens-undelegated`, `delegated-tokens-withdrawn`. Third-party GRT delegated to a service provider under a specific verifier relationship.

All token amounts are returned as decimal strings. The staking contract deals in GRT (18 decimals), so a deposit of 100,000 GRT arrives as `"100000000000000000000000"`.

```
GET /v1/horizon/provision-slashed?from_block=260000000&to_block=262000000
```

```json
{
  "event": "ProvisionSlashed",
  "count": 1,
  "events": [
    {
      "block_num": 261345678,
      "log_index": 7,
      "tx_hash": "0xdef…",
      "serviceProvider": "0xabc…",
      "verifier": "0x789…",
      "tokens": "5000000000000000000000"
    }
  ]
}
```

The `/explore/horizon` dashboard renders these as a timeline with severity accents — slashing events in red, stake changes in amber, delegations in blue. The same data, straight from the API.

---

## Raw SQL: `/v1/sql`

`POST /v1/sql` exposes DataFusion SELECT queries directly against the `blocks`, `transactions`, and `logs` tables. The full UDF suite is available — `evm_decode_log`, `evm_topic`, `evm_decode_params`, `evm_encode_type`, and the rest. Max 1,000 rows, 8-second timeout, 4,096-byte query limit.

The security posture deserves a look because it's not the obvious approach.

### Not a parser

A proper SQL query allowlist would require a full DataFusion-compatible parser. DataFusion's SQL dialect is PostgreSQL-ish with quirks — `X'hex'` binary literals, bracket struct access (`d['field']`), `arrow_cast` — that no off-the-shelf SQL parser handles cleanly. Building a correct parser for this dialect would take longer than the rest of camp combined, and it would still be wrong in edge cases.

Instead, camp uses a defence-in-depth approach:

1. **The data layer is read-only.** `ampd` indexes parquet files. There are no write operations that could be expressed in SQL even if the gateway forwarded them.

2. **A regex denylist** catches the known-dangerous patterns: DDL/DML keywords (`INSERT`, `UPDATE`, `DROP`, `CREATE`, `TRUNCATE`…), file-IO functions (`read_csv`, `read_parquet`, `to_csv`…), system catalogs (`information_schema`, `pg_*`), multi-statement separators, and SQL comments.

3. **`block_num` is required.** Every query must reference `block_num` in the SQL text. Without a block range, a query can table-scan the entire dataset. With one, the worst case is a bounded parquet range scan. This is enforced with a simple regex (not a parse tree) but the regex is applied after the denylist, so a comment trick to hide a `block_num` reference is caught first.

4. **`LIMIT` is injected** if absent. If you write a SELECT without a LIMIT, the gateway appends `LIMIT 1000` before forwarding. If your LIMIT is above 1,000, the query is rejected — not rewritten.

5. **8-second timeout + IP rate limit** are the final backstop.

No single layer is bulletproof. All five together make abuse expensive relative to the damage possible.

### What you can do with it

The UDFs open up queries that the parameterised endpoints don't cover. Count Uniswap V3 swaps per minute bucket:

```sql
SELECT
  date_trunc('minute', timestamp) AS bucket,
  COUNT(*) AS swaps
FROM "_/arbitrum_one@2.0.0".logs
WHERE block_num BETWEEN 266900000 AND 267100000
  AND topic0 = evm_topic('Swap(address,address,int256,int256,uint160,uint128,int24)')
GROUP BY 1
ORDER BY 1
```

Or decode a transfer directly without the `/v1/transfers` endpoint:

```sql
SELECT
  block_num,
  encode(arrow_cast(tx_hash, 'Binary'), 'hex') AS tx_hash,
  (evm_decode_log(topic1, topic2, topic3, data,
    'Transfer(address indexed from, address indexed to, uint256 value)'))['value'] AS value_raw
FROM "_/arbitrum_one@2.0.0".logs
WHERE block_num BETWEEN 266900000 AND 266910000
  AND address = X'af88d065e77c8cc2239327c5edb3a432268e5831'
  AND topic0 = evm_topic('Transfer(address,address,uint256)')
LIMIT 20
```

`GET /v1/sql` returns the full contract (available tables, UDF signatures, and a worked example) without making a query.

---

## The /explore dashboards

Ten server-rendered pages, one per endpoint family:

| Path | What it shows |
|---|---|
| `/explore/sql` | Dune-style SQL playground with canned examples, Cmd+Enter to run |
| `/explore/uniswap-v3` | Pool picker, decoded swap/mint/burn timeline with implied price |
| `/explore/horizon` | Staking event timeline with severity colour accents |
| `/explore/whales` | Live big-Transfer ticker across major tokens |
| `/explore/gas` | Base-fee + throughput bar charts |
| `/explore/token` | Bucketed volume chart + recent transfers tape for any ERC-20 |
| `/explore/address` | Wallet profile: tx history, token movements, contract interactions |
| `/explore/contract` | Log-count time-series for any contract |
| `/explore/lookup` | Ad-hoc block / tx / events forms |
| `/explore/signatures` | Well-known topic0 reference table |

These are server components — the page renders with data, no client-side fetch waterfall. The data is the same JSON every API caller gets; the dashboards are just a UI skin over it.

---

## The Flight shim

This one is operational context, but it explains a decision that would otherwise look odd in the architecture diagram.

ampd v0.0.35 exposed a JSONL-over-HTTP endpoint: POST a SQL query, receive newline-delimited JSON. That's what `ampQuery()` in camp's gateway was written against.

ampd v0.0.36 removed it. The new interface is Apache Arrow Flight — a gRPC-based binary protocol for exchanging columnar data. The performance improvement is real: Flight sends Arrow IPC buffers directly, no JSON serialisation, no text parsing. But a Next.js Vercel function can't speak gRPC over a Cloudflare tunnel without a bridge.

The Flight shim is that bridge: a small service that accepts the old JSONL-over-HTTP shape on one side, translates it to a Flight SQL query, and streams the Arrow IPC response back as newline-delimited JSON. From camp's gateway perspective nothing changed — it still POSTs SQL and gets JSONL back. The shim absorbs the protocol difference.

The camp gateway itself (this repo) therefore requires no changes when ampd upgrades. The shim is in the ops repo alongside nginx, Redis, and the cloudflared tunnel config.

---

## Caching

Every API response sets `Cache-Control` based on where the queried block range sits relative to chain tip.

**Finalized ranges**: requests whose `to_block` is more than 200 blocks behind the tip at query time get `public, s-maxage=3600, stale-while-revalidate=86400`. An hour of edge cache, a day of stale-while-revalidate. Historical data doesn't change; there's no point re-fetching it.

**Near-tip ranges**: anything within 200 blocks of tip gets `public, s-maxage=5, stale-while-revalidate=30`. Five seconds at the edge, long enough for a dashboard refresh not to hammer the origin on every page load.

**Raw SQL**: `POST /v1/sql` responses are `private, no-store`. The query is arbitrary; there's no reliable cache key short of hashing the full SQL body, and the Cloudflare edge won't cache POSTs anyway.

The "is this finalized?" check uses the `to_block` parameter against `to_block + 200` as a proxy for tip — the actual tip isn't fetched on every request, which would add a round-trip. The heuristic is conservative: a range that was finalized an hour ago is definitely finalized now.

---

## SSE block stream

`GET /v1/stream/blocks` pushes new-block events as Server-Sent Events. The implementation polls `MAX(block_num)` from the blocks table every 2 seconds and emits a `data:` frame when the number advances. It caps at 5 minutes to stay inside Vercel's function timeout.

```
event: block
data: {"block_num":267000100,"timestamp":"2026-05-28T12:00:05Z"}

event: block
data: {"block_num":267000101,"timestamp":"2026-05-28T12:00:07Z"}
```

This is a polling bridge, not a native push. Amp's Arrow Flight implementation does support CDC events (insert/delete/reorg streams) natively — streaming the real event feed rather than polling `MAX(block_num)` is on the roadmap once the Flight shim is wired up for CDC.

---

## Data freshness window

The node runs a rolling window, not full Arbitrum history. History started building forward from **2026-05-27** (a clean cutover from ampd v0.0.35 to v0.0.36, since the parquet schema changed and old files aren't compatible). The window grows by roughly 24 hours per calendar day. Every `/v1/status` response includes `history_seconds` and `earliest_indexed_at` so you can check programmatically.

The eventual target is a rolling 30-day view. Backfilling beyond "since last reindex" is blocked until the compactor situation is stable — ampd v0.0.35 had a compactor bug that required hourly forced reindexing; v0.0.36 fixes it.

---

## What you can build with it

A few concrete use cases that are straightforward with the current API.

**On-chain alert bot.** Poll `/v1/whales/transfers?token=0x…&min_value=100000000000` every minute and fire a Telegram or Discord notification when a large transfer lands. No subgraph, no infrastructure beyond a cron job. The `from_block`/`to_block` pattern means you can watermark where you left off and never miss an event.

**Wallet activity dashboard.** Three endpoints give you a complete picture of any address: `/v1/address/{a}/tx` for raw transactions, `/v1/address/{a}/transfers` for token movements, and `/v1/address/{a}/interactions` for the set of distinct contracts it has called. Build a lightweight "wallet explorer" without an RPC node or a third-party API key.

**Liquidity position tracker.** Pull Uniswap V3 `mint` and `burn` events for a pool filtered to a specific `owner` address. The `tickLower`/`tickUpper` range and `amount0`/`amount1` values let you reconstruct the full history of a position (entries, exits, and the liquidity held at each range) without a subgraph.

**Protocol health monitor.** Use `/v1/contract/{a}/activity?bucket=hour` to track event volume over time for any contract. If a protocol's hourly log count drops to zero, something has stopped. Wire this into a Grafana panel or a Prometheus scrape target with a two-liner.

**GRT staking dashboard.** The Horizon endpoints decode the full staking lifecycle for any service provider or delegator: deposits, provisions, delegations, and slashing events. Building a read-only view of who is staking what, under which verifier, with what slashing history — the data is all there, no GraphQL schema required.

**Arbitrage surface scanner.** Compare Uniswap V3 swap events across multiple pools using raw SQL. A single POST to `/v1/sql` can join swap data across pools in a block range, compute implied prices, and surface spreads — the kind of query you'd write in Dune but that you want at chain tip rather than on a delayed cache.

**Gas fee planner.** `/v1/gas/blocks?bucket=minute` gives you per-minute base-fee stats for any block range. Pull the last 24 hours of minute-bucket data and you have enough to build a "cheapest time to transact" heuristic tuned to Arbitrum's actual fee dynamics.

---

## Run your own camp node

camp is one deployment of a replicable pattern. If you want uncapped limits, a private endpoint, or coverage of a chain camp doesn't index, you can run the whole stack yourself.

The pieces:

**1. Amp node (`ampd`).**
Install and run `ampd` pointing at an Arbitrum One RPC (or any chain Amp supports). The node will ingest blocks, transactions, and logs into local parquet files. The [run-local-amp-node posts on this blog](/blog/run-local-amp-node) walk through the setup. You need a machine with enough disk — Arbitrum One logs accumulate fast; plan for several hundred GB per month of indexed history.

**2. The camp gateway.**
Clone [github.com/nightswatchhq/camp](https://github.com/nightswatchhq/camp), set `AMP_ORIGIN` to wherever your `ampd` is listening, set `AMP_TOKEN` to a shared secret, and deploy to Vercel (or run locally with `npm run dev`). That's the entire public API surface.

**3. (Optional) nginx + Redis.**
The ops pattern camp uses puts nginx in front of `ampd` to enforce the shared-secret check and Redis-backed IP rate limiting. Without this, `AMP_ORIGIN` points directly at `ampd`'s HTTP port and there's no rate limiting — fine for a private node, not for a public one.

**4. (Optional) Cloudflare tunnel.**
If your node is on a home machine or behind NAT, `cloudflared tunnel` gives you a public HTTPS endpoint without port-forwarding. The tunnel URL will rotate occasionally; automate the Vercel env var update or use a named tunnel with a stable hostname.

The full environment variables:

| Var | Purpose |
|---|---|
| `AMP_ORIGIN` | Base URL of the JSONL origin (nginx in front of ampd, or ampd directly) |
| `AMP_TOKEN` | Shared secret the origin expects in `X-Amp-Token` |
| `AMP_DATASET` | Fully-qualified dataset@version, e.g. `_/arbitrum_one@2.0.0` |
| `AMP_QUERY_TIMEOUT_MS` | Per-query hard cap in ms (default 8000) |
| `UPSTASH_REDIS_REST_URL` | Redis REST URL for rate limiting (optional — no-ops if absent) |
| `UPSTASH_REDIS_REST_TOKEN` | Bearer token for the Redis endpoint |

Rate limiting requires a Redis instance reachable from Vercel. The camp ops setup runs a self-hosted Redis HTTP shim alongside nginx, but Upstash's managed Redis works identically — it's the same `@upstash/ratelimit` client either way.

**Becoming a Horizon provider.** If you want to earn GRT for your node's query serving rather than offering a free endpoint, camp-data-service adds the payment layer on top. It's a Rust/Axum gateway that validates GraphTally (TAP) signed receipts, proxies requests to the camp REST API, aggregates receipts into RAVs, and collects on-chain via a Solidity `DataService` contract. The code is at [github.com/nightswatchhq/camp-data-service](https://github.com/nightswatchhq/camp-data-service) — currently on Arbitrum Sepolia (testnet), not mainnet.

---

## What comes next

The main items in flight:

**Anonymous tokens**: per-token sliding-window limits with a larger budget than the IP rate limit. The IP limit is calibrated to protect the node from anonymous abuse; a token lets you prove you're a real consumer without requiring an account.

**GMX V2**: the EventEmitter pattern GMX uses (a single contract emitting events for many protocol actions) needs a different decode approach than Uniswap V3's per-contract model. The mechanism is understood; it's a matter of shipping it.

**CSV and Arrow IPC response formats**: `Accept: text/csv` or `Accept: application/vnd.apache.arrow.stream` on any endpoint. Arrow IPC in particular is useful for piping directly into DuckDB or pandas without the JSON round-trip.

**Webhooks**: POST to your URL when a matching event lands on-chain. Requires the CDC stream from the Flight shim first.

---

## Try it

- **camp API:** [engine.camp](https://engine.camp)
- **OpenAPI spec + browsable docs:** [engine.camp/docs](https://engine.camp/docs)
- **Explore dashboards:** [engine.camp/explore](https://engine.camp/explore)
- **Source:** [github.com/nightswatchhq/camp](https://github.com/nightswatchhq/camp)
- **Intro post (if you missed it):** [camp: A Free Decoded Arbitrum API](/blog/camp-free-amp-api-arbitrum)
