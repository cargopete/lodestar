# RFC 003: Protocol Analytics Expansion

Status: proposal accompanying initial PR
Author: contribution to cargopete/lodestar
Date: 2026-05

## Summary

Triples the `/protocols` analytics surface from 3 protocols across 2
categories (DEX, Lending) to **9 protocols across 3 categories** spanning
4 chains (Ethereum, Polygon, Arbitrum, Gnosis). Every new data point
flows through The Graph's decentralised network: no third-party indexers,
no proprietary aggregators.

The most useful methodology insight from the build: **the Graph MCP
servers (`graph-lending`, `graph-uniswap`, `graph-aave`, `graph-lido`)
are the right discovery layer for this kind of work**. Searching the
Explorer or guessing IDs surfaces a lot of stale Messari deployments;
querying the MCPs returns only the protocols whose subgraphs are live
right now and serving fresh data. This RFC documents the working set
discovered that way, plus the upstream gaps that prevent further
expansion (perps, prediction markets, Hyperliquid, dYdX v4, social).

## What this PR adds

### Protocols (6 new)

| # | Protocol | Category | Chain | Schema | TVL | Subgraph |
|---|---|---|---|---|---|---|
| 1 | Uniswap V3 (Polygon) | DEX | Polygon | uniswap-v3 | $96M | `3hCPRGf4z88VC5rsBKU5AA9FBBq5nF3jbKJG7VZCbhjm` |
| 2 | Aave V3 (Arbitrum) | Lending | Arbitrum | messari-lending | $1.15B | `4xyasjQeREe7PxnF6wVdobZvCw5mhoHZq3T7guRpuNPf` |
| 3 | MakerDAO | Lending | Ethereum | messari-lending | $5.46B | `8sE6rTNkPhzZXZC6c8UQy2ghFTu5PPdGauwUBm4t7HZ1` |
| 4 | Morpho Blue | Lending | Ethereum | messari-lending | $4.03B | `8Lz789DP5VKLXumTMTgygjU2xtuzx8AhbaacgN5PYCAs` |
| 5 | Spark Lend (Gnosis) | Lending | Gnosis | messari-lending | $611K | `Bw4RH37UbbGEhHo4FaWwT1dn9QJzm1XSZCyK1cbr6ZKM` |
| 6 | Lido | Liquid Staking | Ethereum | messari-staking (new) | $18.55B | `F7qb71hWab6SuRL5sf6LQLTpNahmqMsBnnweYHzLGUyG` |

Combined with the three pre-existing protocols (Uniswap V3 Ethereum,
Aave V3 Ethereum, Compound V3 Ethereum), the directory now covers
**$33+ billion of TVL** across DEX, Lending, and Liquid Staking.

### Schema

`messari-staking` joins `messari-dex`, `messari-lending`, and
`uniswap-v3` as the fourth discriminant. It uses the same `protocols` +
`financialsDailySnapshots` shape, mapped so that "volume" reads as
supply-side yield and "fees" as the protocol's cut. Same schema works
for any Messari yield / staking deployment as soon as their subgraphs
are confirmed live and writing daily revenue fields.

### UI changes

- New `Liquid Staking` category badge with its own colour token.
- `CATEGORY_LABELS` table on the detail page: each category contributes
  its own KPI labels (Liquid Staking shows "Total Value Staked" and "30d
  Staker Yield" instead of "TVL" / "30d Volume").
- Optional category-specific extra-stat tiles (Lido surfaces a 30d-
  estimated staking APR).
- `formatUSD` extended with trillion (T) compact notation so $1.98T
  renders cleanly instead of $1979.45B.
- Table cells use `whitespace-nowrap` so unusually formatted numbers
  cannot wrap and break row alignment.

### Data quality guards

- New `sanitizeCumulative` helper guards against the known class of
  Messari bugs where USD fields leak unscaled integer values (Curve
  mainnet does this on `cumulativeVolumeUSD`, certain Aave snapshots on
  `cumulativeFeesUSD`). Anything north of $1e15 falls back to the
  snapshot-derived sum. This keeps directory cells from rendering
  "$ 376424613377.91B" and shattering layout when an upstream subgraph
  misbehaves.
- Daily protocol fees on the staking schema are estimated from the
  cumulative protocol/supply ratio when the daily field is empty. The
  Messari Lido subgraph writes `dailyProtocolSideRevenueUSD = 0` across
  every snapshot while still maintaining a non-zero
  `cumulativeProtocolSideRevenueUSD` (~10% of supply-side, matching
  Lido's fee policy). Without this back-derivation the "Daily Fees (90
  days)" chart would be a flat zero.

## Methodology: discovery via Graph MCP servers

The first pass of this work assumed Graph Explorer search results were
the source of truth. That produced ~50% wasted effort: many of the
Explorer-listed Messari subgraphs are stale, return `subgraph not
found` from the gateway, or write zero into key fields silently while
still passing `_meta` health checks.

The second pass switched to the Graph MCP servers as the discovery
layer:

```
mcp__graph-lending__list_protocols       → ~70 active lending protocols with live TVL
mcp__graph-aave__list_aave_chains        → 7 Aave V3/V2 deployments with subgraph IDs
mcp__graph-uniswap__list_uniswap_chains  → 15 Uniswap V3+V4 deployments
mcp__graph-lido__get_lido_stats          → Lido current stats (9.06M ETH, 605K holders)
```

Every MCP query returns results filtered by **what is actually
serving** -- if a protocol shows up in `list_protocols` with a non-zero
TVL, its subgraph is alive on the gateway. That filter alone cut search
time on this PR by an order of magnitude.

For each candidate the workflow was:
1. Confirm liveness via the relevant MCP (`get_protocol`,
   `get_protocol_stats`, `get_lido_stats`).
2. Find the subgraph deployment ID via the Explorer URL (the MCPs
   currently do not expose IDs directly, only names + slugs).
3. Test the ID against Lodestar's existing schema queries.
4. If schema matches, ship. If not, either skip or write a new
   discriminant.

**Recommendation for the Graph teams:** the MCP `list_*` and `get_*`
tools should expose deployment IDs in their responses. Today they
return human-readable stats, but to integrate them as a backend into a
product like Lodestar you need the deployment ID, and the Explorer
roundtrip is friction. A `subgraphId` field on each entry would unblock
direct programmatic use.

## What we tried and could not ship (the upstream-quality problem)

The first round of additions tried to span more verticals -- Sushiswap,
Curve, GMX V2 (Perps), Polymarket (Prediction Markets). All were
dropped after live testing showed the data underneath was unusable.
Generalising: **a meaningful share of the Messari "standardised
subgraphs" library is now silently broken**, and prediction-market /
perp-DEX subgraphs face their own issues.

### Sushiswap (Messari, Ethereum) -- HARD FAILURE

```
GET .../subgraphs/id/7h1x51fyT5KigAhXd8sdE3kzzxQDJxxz1y66LTFiC3mS
=> "subgraph not found"
```

Explorer page exists. Gateway returns `subgraph not found`. The
deployment has been removed from active indexing, but the Explorer
listing gives no warning. Discoverability gap: builders pick a subgraph
from Explorer, find it does not work in production, then have to find
an alternative.

### Curve Finance (Messari, mainnet) -- DATA INTEGRITY FAILURE

```
cumulativeVolumeUSD: 8.32e+15      // ~1e6× too large
volume30dUSD:        7.02e+15
```

The subgraph is alive but USD fields appear to skip the USDC 1e6
decimal scaling somewhere in the indexer. Every USD value is inflated
by ~1e6×. Sanitisation can clamp the symptom; it cannot make the data
correct.

### GMX V2 (Messari, Arbitrum) -- PARTIAL DATA / SILENT DEGRADATION

```
totalValueLockedUSD:    890,901          // protocol reports $890K (real is hundreds of millions)
cumulativeVolumeUSD:    123,423,902,899  // $123B, plausibly correct historical
dailyVolumeUSD (recent): 0               // every recent daily snapshot
```

Recent `_lastUpdateTimestamp`. Technically "live". But daily financials
write zero, and protocol-level TVL is wildly off. Either indexer logic
regressed or the schema changed underneath. The fact that this subgraph
passes basic health checks while serving silently broken data is the
most dangerous category of failure for any analytics product.

### Polymarket (native, Polygon) -- VOLUME TRACKING STOPPED

```
global { collateralVolume: 0, scaledCollateralVolume: 0, collateralFees: 0 }
transactions: []
_meta { hasIndexingErrors: false, block: { timestamp: <now> } }
```

Subgraph is being indexed (no errors, latest block is current) and
`numConditions` / `numOpenConditions` continue to update -- 1.23M total
markets, 139K open. But every USD-denominated field is zero and the
`transactions` table returns nothing. Some schema-handler change in
the subgraph silently stopped writing volume data.

### What would unblock these

Each is upstream-side, not Lodestar-side:

- **Subgraph health badges in Graph Explorer.** A simple "last
  successful query in the past 24h" indicator alongside signal would
  let dashboard builders pick from the active set. Stale deployments
  should be visually demoted.
- **Field-level freshness, not just block freshness.** GMX V2 and
  Polymarket both pass `_meta` health checks but write zero into key
  fields. A health endpoint that reports "field X has not received a
  non-zero write in N days" would catch this.
- **Re-indexing or hand-off of orphan Messari subgraphs.** Many
  Messari deployments are no longer maintained. Either Edge & Node,
  Pinax, or a community fork should take ownership of the high-traffic
  ones (Curve, Sushi, GMX V2, Synthetix) so the standard schema
  continues to be a viable analytics target.
- **Schema-version assertions.** Subgraphs declaring `schemaVersion`
  should validate that USD-denominated fields are in fact USD-scaled.
  A single oracle-sanity test query at deploy time would catch the
  Curve-style 1e6 inflation before users see it.
- **Surface subgraph deployment IDs in MCP responses.** As above:
  `subgraphId` on `list_protocols` / `list_aave_chains` /
  `list_uniswap_chains` would let downstream products like Lodestar
  use the MCPs as a discovery layer programmatically, not just an
  interactive one.

## What was scoped out (and why)

These could be built today but were intentionally deferred to keep the
PR reviewable. Each is a self-contained follow-up.

- Per-chain dimensioning of multi-chain protocols: today
  `aave-v3-arbitrum` is its own row alongside `aave-v3` (Ethereum).
  A "chains" pivot in the directory would aggregate them. Architecture
  is already chain-aware.
- Sortable / filterable directory (by category, TVL, 30d fee growth).
- `/api/protocols` exposed as a public read API for embed consumers.
- Iframe-embed mode (`?embed=1`) for individual protocol cards.
- Persistence of daily snapshots into the existing Postgres so the
  historical window can extend past the 90 days the subgraphs return.
- Compound V2 ($137M), Liquity ($180M), Venus ($1.7B) and other
  smaller-but-iconic lending protocols. Each one is a config-row
  addition once its subgraph ID is confirmed; we ran out of time, not
  out of capacity.

## Verticals blocked by today's Graph stack

Beyond the upstream-quality problem, these verticals are blocked by
primitives that do not yet exist on the platform.

### 1. Hyperliquid (Perps)

Dominant perp DEX in 2026 by volume but runs its own L1 (HyperBVM /
HyperEVM). No first-party subgraph and the chain is not yet a Token
API target. **Unblock:** HyperEVM as a supported indexing target on
the decentralised network.

### 2. dYdX v4 (Perps)

Runs its own Cosmos-based chain. The v3 Ethereum subgraph is end of
life; v4 has no indexer in The Graph network today. **Unblock:**
Cosmos / dYdX-chain support, or a Substreams package that bridges
the dYdX v4 indexer feed.

### 3. Stablecoins

Needs total supply over time, mint / burn flow per chain, and holder
counts. Token API can do balances, transfers, and OHLC, but there is
no clean `circulatingSupply` time series endpoint, and no built-in
label set distinguishing mint / burn / treasury wallets. **Unblock:**
- `getTotalSupplyHistory(token, chain, range)` endpoint on Token API.
- Wallet labels (issuer mint, treasury, exchange) as a queryable
  Token API resource.

### 4. CEX transparency (proof-of-reserves)

Same wallet-labels primitive as stablecoins.

### 5. NFT markets (collection-level dashboards)

Token API has NFT endpoints (collection, holders, sales). Missing is
a floor + volume time-series per collection. **Unblock:**
`getNftCollectionTimeseries(collection, range)`.

### 6. Farcaster (Social)

Identity is on-chain via the FID registry, but casts, reactions, and
channel activity live in Hubs. Subgraphs cover identity registrations
and Frames-related on-chain events, not engagement metrics.
**Unblock:** a first-party Hubs adapter, exposed as either a hosted
subgraph-equivalent or a Hypergraph data product.

### 7. Multi-chain unified balances (treasuries, portfolios)

Today, "show me a multisig's balance across every chain" requires N
calls to Token API's balances endpoint. **Unblock:** a
`GET /balances/cross-chain?address=...` endpoint that fan-outs
server-side.

### 8. Authoritative pricing for long-tail and RWA tokens

CoinGecko-style pricing handles mainline tokens. RWA tokens (Ondo,
Centrifuge tranches, BUIDL) and long-tail LST / LRT pairs do not
always have clean Token API OHLC quotes. **Unblock:** a price oracle
subgraph aggregator (Chainlink + Pyth + RedStone normalised), or a
Hypergraph use case.

### 9. Subgraph federation across chain deployments

Aave V3 has a separate subgraph deployment per chain. To show "Aave
V3 across all chains", today the fetcher would need N round trips
and aggregate client-side. **Unblock:** a "subgraph-of-subgraphs"
federation primitive on the gateway: one query, fan-out to N
deployments, return a unioned response.

### 10. Real-time liquidations feed

Doable via subgraphs, but each refresh hits the gateway. Substreams
is the right tool, but the friction (Rust modules, package publishing)
is too high for dashboard builders. **Unblock:** higher-level
Substreams primitives, e.g. a "live tail" preset for common patterns.

## Local verification

```bash
git checkout -b protocols-expansion
npm install            # or pnpm install --ignore-workspace
cp .env.example .env   # add GRAPH_API_KEY from thegraph.com/studio/apikeys
npm run dev            # http://localhost:3000/protocols
```

All 9 protocols at `/protocols/<slug>`:

```
/protocols/uniswap-v3            /protocols/morpho-blue
/protocols/uniswap-v3-polygon    /protocols/spark-lend-gnosis
/protocols/aave-v3               /protocols/lido
/protocols/aave-v3-arbitrum
/protocols/compound-v3
/protocols/makerdao
```

A single broken subgraph degrades to "—" rather than breaking the
directory, and `sanitizeCumulative` prevents inflated upstream values
from breaking layout. The page is safe to ship even if one of the new
schemas needs a tweak post-merge.

## How the gaps would change the PR shape

If the upstream items above land within the next two quarters, the
architecture in this PR drops in trivially: each new vertical is a
config row plus, at most, a single new schema fetcher
(`messari-stablecoin`, `messari-nft`, etc.). The discriminated
`SchemaType` keeps the codebase honest about which fetcher returns
which shape, and `ProtocolDaySnapshot` is generic enough to survive
new categories without churn.

The fragile boundary is items 6-8 (Farcaster Hubs, cross-chain
balances, authoritative pricing). Those would push us into either
off-Graph data sources or significantly upstream changes. Worth
explicit conversation with the relevant Graph teams before committing
to a shipping date.
