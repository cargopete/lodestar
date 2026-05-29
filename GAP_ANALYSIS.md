# Lodestar vs. Graph Explorer & Studio — Gap Analysis

> Last updated: 2026-05-29  
> Goal: reach feature parity with official Graph products.  
> Status legend: ✅ Live | 🟡 Partial | ❌ Missing | 🔒 Out of scope  
> All items verified by reading actual source code — not inferred.

---

## Lodestar's Moat (features the official products don't have)

These are Lodestar's differentiators — don't lose them chasing parity.

- 11-dimensional indexer risk scoring (A–F grade) with per-dimension breakdown and weights
- REO eligibility with oracle-sourced renewal countdown and heuristic fallback
- Rolling 30d/90d APY (Explorer only shows instantaneous APR)
- Live node syncing status per deployment (blocks behind, sync %, fatal errors, 30s refresh)
- POI consensus dashboard with divergence detection
- IPFS manifest complexity analyser (Light → Extreme), handler breakdown, chain-aware scoring
- Greedy indexer detection with hard-cap risk score penalty
- Delegation advisor with preference sliders (returns / stability / safety / network contribution)
- Redelegation calculator with break-even analysis
- Indexer comparison tool (up to 8 side-by-side)
- GraphTally/TAP payment pipeline tracking
- On-chain sync bounties (BountyBoard escrow) — developers lock GRT against a deployment ID; indexers claim trustlessly by proving an open allocation + post-bounty POI. Chain-reconciled cache (cron), with expiry/refund flow (experimental)
- DeFi protocol directory with family aggregation
- Governance tracker (GIP-0079/0086/0087/0088/0070) with live metrics
- Community voting (EIP-712 + SIWE)
- Parameter change history timeline
- QoS oracle charts per indexer
- Lodie AI Q&A over live network data
- Horizon multi-data-service provisions tracking
- iCal thaw reminder downloads

---

## Gap Table by Feature Area

### 1. Subgraph Discovery & Filtering

| Feature | Explorer | Lodestar | Verified Status |
|---|---|---|---|
| Search by **contract address** (find subgraphs indexing it) | ✅ | ✅ | **Live** — `subgraph-search/route.ts` detects `0x` addresses and substring-matches the deployment manifest (`manifest_contains_nocase`). NB: the network subgraph has no indexed data-source address field, so this searches the raw manifest, not `dataSources.source.address` |
| Category filter: DeFi / NFTs / DAOs | ✅ | ✅ | **Live** — filters on `metadata.categories`, threaded through both data paths with URL sync (`subgraphs/page.tsx`) |
| Sort: Most Queried | ✅ | ✅ | **Live (as Query Fees)** — the network subgraph exposes no query *count*, only `queryFeesAmount`; the existing Query Fees sort *is* "most queried" |
| Sort: Recently Created / Recently Updated | ✅ | ❌ | Missing — deferred; needs a new sortable "Created" column (the directory uses column-header sorting) |
| Per-subgraph **query count** (not just fees) | ✅ | ❌ | Not buildable — network subgraph has no query-count field (gateway-only analytic); only `queryFeesAmount` exists |
| Filter by indexed chain | ✅ | ✅ | Live |
| Sort by signal / stake / fees | ✅ | ✅ | Live |
| Complexity filter (Light/Moderate/Heavy/Extreme) | ❌ | ✅ | Lodestar leads |
| Elite filter (>1K GRT fees) | ❌ | ✅ | Lodestar leads |

---

### 2. Subgraph Detail Page

| Feature | Explorer | Lodestar | Verified Status |
|---|---|---|---|
| **Built-in GraphQL playground** | ✅ Full GraphiQL (schema browser, autocomplete, syntax highlight) | ✅ | **Live** — embedded GraphiQL v4 with schema browser, autocomplete and syntax highlighting, proxied server-side via `GRAPH_API_KEY` (`SubgraphGraphiQL.tsx`) |
| **Subgraph version history** (semver labels, all deployment IDs, timestamps) | ✅ | ✅ | **Live** — new "Versions" tab lists every version's semver label, deployment ID and timestamp, and flags the current one (`subgraph-versions` route + `VersionsTable`) |
| **Activity log** (deployments, signals, queries over time) | ✅ | ✅ | **Live** — "Activity" tab merges version-publish + curator-signal events into a timeline (`ActivitySection`) |
| **Network gateway query URL** displayed + copyable | ✅ | ✅ | **Live** — real `gateway.thegraph.com/api/<api-key>/deployments/id/[hash]` shown + copyable on the playground tab |
| Per-subgraph indexer status table (stake, fees, sync status) | ✅ | ✅ | Live — IndexerStatus section shows all allocating indexers |
| Signal / Unsignal on-chain from subgraph page | ✅ | ✅ | Live (via /curate) |
| Schema browser | ✅ | ✅ | Live |
| Curator breakdown | ✅ | ✅ | Live |
| Signal/stake/fees history chart | ✅ | ✅ | Live |
| Manifest & complexity analysis | ❌ | ✅ | Lodestar leads |

---

### 3. Indexer Table & Directory

| Feature | Explorer | Lodestar | Verified Status |
|---|---|---|---|
| **Cooldown remaining** column (time until delegation params can change) | ✅ | ✅ | **Live** — sortable "Cooldown" column (days remaining) added to `IndexerTable.tsx` |
| Query Fee Cut % | ✅ | ✅ | Live |
| Effective Reward Cut | ✅ | ✅ | Live |
| Owned / Delegated / Allocated stake columns | ✅ | ✅ | Live |
| Available delegation capacity | ✅ | ✅ | Live |
| Lifetime query fees | ✅ | ✅ | Live |
| Search by address / name | ✅ | ✅ | Live |
| Risk score (A–F) | ❌ | ✅ | Lodestar leads |
| REO badge | ❌ | ✅ | Lodestar leads |
| Rolling 30/90d APY columns | ❌ | ✅ | Lodestar leads |

---

### 4. Indexer Detail Page

| Feature | Explorer | Lodestar | Verified Status |
|---|---|---|---|
| **Disputes / slashing history tab** | ✅ | ✅ | **Live** — "Disputes & Slashing" section (type/status/slashed/burned/fisherman) from the ingested `disputes` table (`DisputesSection`); shows "clean record" when none |
| **Operator address** display | ✅ | ✅ | **Live** — `account.operators` shown under the indexer address, linked to Arbiscan |
| **Historical / closed allocations** | ✅ | ✅ | **Live** — "Closed Allocations" table (most recent 50) showing allocated stake, indexing rewards, query fees, duration in epochs and a force-closed flag (`ClosedAllocationsTable`) |
| **Cooldown remaining** on detail page | ✅ | ✅ | Live — shown inline in the parameters card as "Locked for Xd" when cooldown active |
| Live node syncing status per deployment | ❌ | ✅ | Lodestar leads |
| REO eligibility + renewal countdown | ❌ | ✅ | Lodestar leads |
| QoS oracle chart | ❌ | ✅ | Lodestar leads |
| Parameter change history timeline | ❌ | ✅ | Lodestar leads |
| 11-dimensional risk score breakdown | ❌ | ✅ | Lodestar leads |

---

### 5. Network & Epochs

| Feature | Explorer | Lodestar | Verified Status |
|---|---|---|---|
| **Epoch status per row**: Active / Settling / Distributing / Finalized | ✅ | ✅ | **Live** — derived from epoch number vs current (`epochStatus`); no on-chain status field exists, so it's a labelled approximation |
| Per-epoch query fees + indexing rewards **table** | ✅ | ✅ | **Live** — "Recent Epochs" table on the network page (`EpochTable`) with status + fees + rewards + block range |
| Genesis-to-now cumulative token supply (minted / burned) | ✅ | ✅ | **Live** — "Total Supply" headline stat card (chart already existed for the trend) |
| Annual issuance rate displayed | ✅ | ✅ | **Live** — computed "Annual Issuance (est.)" stat from `networkGRTIssuancePerBlock` × L1 blocks/yr ÷ supply (≈8.6% live; the doc's old "2.75%" was stale) |
| Current epoch number + progress | ✅ | ✅ | Live |
| Protocol parameters grid | ✅ | ✅ | Live |
| Participant counts (indexers / delegators / curators) | ✅ | ✅ | Live |

---

### 6. User Profile / Delegator Portfolio

| Feature | Explorer | Lodestar | Verified Status |
|---|---|---|---|
| **Delegation status column**: Delegating / Undelegating / Withdrawable | ✅ | ✅ | **Live** — a distinct "Withdrawable" badge now surfaces in the portfolio table once the thaw completes, separate from in-progress "Thawing" (`deriveDelegationStatus` / `DelegationStatusBadge`) |
| **Withdraw thawed GRT** action | ✅ | ✅ | Live — full withdraw flow in `UndelegatePanel.tsx` with mode tabs, transaction status, and calendar reminder |
| **Undelegate** action (with 25%/50%/ALL quick inputs) | ✅ | ✅ | Live |
| **Indexer's own tabbed profile** (allocations / delegations / curations / settings) | ✅ | 🟡 | 🚫 Won't do — all data is present on the detail page; tabbing it is a cosmetic refactor with regression risk and no new data |
| **Operator address configuration** (for indexers) | ✅ | ❌ | Missing |
| **ENS name configuration** | ✅ | ❌ | Missing |
| Published subgraphs you've created | ✅ | 🟡 | Partial — accessible via /dock |
| Thawing countdown timer | ✅ | ✅ | Live |
| Delegation position cards with full metrics | ✅ | ✅ | Live |
| Rewards CSV export | ❌ | ✅ | Lodestar leads |
| iCal thaw reminder | ❌ | ✅ | Lodestar leads |

---

### 7. Studio-Equivalent Developer Tools

| Feature | Studio | Lodestar | Verified Status |
|---|---|---|---|
| **API key management** — create, rename, regenerate, delete | ✅ | ❌ | Missing — all `GRAPH_API_KEY` references are server-side env vars, not user-managed keys |
| **API key domain/subgraph restrictions** | ✅ | ❌ | Missing |
| **Indexer routing preferences per key** (speed / price / freshness / security) | ✅ | ❌ | Missing |
| **Query usage monitoring per key** (queries executed, GRT spent, spending limits) | ✅ | ❌ | Missing |
| **Billing** — GRT deposit/withdraw, credit card, balance | ✅ | 🔒 | Out of scope |
| **Subgraph version history** list (all past deployment IDs + semver labels) | ✅ | ✅ | **Live** — surfaced via the Versions tab on the subgraph detail page (`subgraph-versions` route) |
| **Deploy key** display and regeneration | ✅ | ✅ | Live — `/api/studio/deploy-key` with display and regenerate button in /dock |
| Playground for unpublished / development subgraphs | ✅ | ❌ | 🚫 Won't do — /dock studio scope, deferred |
| Subgraph metadata editing (name, description, image, links) | ✅ | 🟡 | 🚫 Won't do (for now) — basic editing via /dock; completion deferred |
| Subgraph ownership transfer | ✅ | ❌ | 🚫 Won't do — irreversible on-chain GNS tx, /dock studio scope |

---

### 8. Ecosystem / Product Discovery

| Feature | Explorer | Lodestar | Verified Status |
|---|---|---|---|
| Token API discovery + links | ✅ | ❌ | Missing — nav link only needed, no build |
| Substreams discovery + links | ✅ | ❌ | Missing — nav link only needed, no build |
| AI/MCP gateway (in development at Graph) | Planned | ✅ | Lodestar leads with Lodie |

---

## Priority Tiers

### Tier 1 — High impact, core parity, buildable now

**✅ Shipped 2026-05-29:**

1. ~~**GraphQL playground upgrade**~~ — ✅ embedded GraphiQL v4 (schema browser, autocomplete, syntax highlighting) reusing the existing `/api/subgraph-playground/[hash]` proxy (`SubgraphGraphiQL.tsx`).
2. ~~**"Withdrawable" delegation status badge**~~ — ✅ distinct badge state via `deriveDelegationStatus` / `DelegationStatusBadge`, surfaced in the portfolio table.
3. ~~**Contract address search**~~ — ✅ `subgraph-search/route.ts` substring-matches the deployment manifest (`manifest_contains_nocase`). The originally-assumed `dataSources.source.address` field does **not** exist on the network subgraph — the raw manifest string is searched instead.
4. ~~**Subgraph version history tab**~~ — ✅ "Versions" tab + `subgraph-versions` route + `VersionsTable`, listing semver labels, deployment IDs and timestamps.
5. ~~**Historical / closed allocations**~~ — ✅ "Closed Allocations" table on indexer detail (`ClosedAllocationsTable`).

**Remaining:**

6. **API key management** — 🅿️ **explored & parked** (see `RFC-004`, branch `metered-gateway`). The metered prepaid-GRT gateway was designed and Phase 0 built, then parked: at-cost it's a **zero-margin resale of a commodity Studio offers directly** (mint keys, deposit GRT, see usage) while saddling Lodestar with fund custody + regulatory exposure. Conclusion: Lodestar's payable value is the **intelligence layer** (risk/REO/APY/advisor + Lodie AI + an enriched-data API), not the query pipe. Revisit only if monetising that intelligence or if a differentiated gateway angle emerges.

### Tier 2 — ✅ all shipped 2026-05-29

7. ~~**Cooldown remaining column**~~ — ✅ sortable column in `IndexerTable`.
8. ~~**Epoch status states + per-epoch table**~~ — ✅ `EpochTable` + derived `epochStatus`.
9. ~~**Subgraph activity log**~~ — ✅ "Activity" tab (`ActivitySection`).
10. ~~**Disputes / slashing history**~~ — ✅ `DisputesSection` from the ingested `disputes` table.
11. ~~**Subgraph category filter**~~ — ✅ DeFi/NFT/DAO via `metadata.categories`.
13. ~~**Operator address**~~ — ✅ shown on indexer detail.
14. ~~**Network gateway query URL**~~ — ✅ real gateway endpoint shown + copyable.

### Tier 3 — partial

17. ~~Cumulative token supply headline stat~~ — ✅ "Total Supply" card.
18. ~~Annual issuance rate~~ — ✅ computed "Annual Issuance (est.)" card (live ≈8.6%; the old "2.75%" was stale).
15. Token API & Substreams discovery links — nav additions only. *(not yet done — low priority)*
16. ENS name configuration in profile settings. *(not yet done — low priority)*

### 🚫 Won't do (decided 2026-05-29)

- **Per-subgraph query count** (#12) & **"Recently Created" sort** — query *count* isn't in the network subgraph (gateway-only analytic); "Most Queried" is already the Query Fees sort. Created-sort deferred as low-value.
- **Unified tabbed indexer profile** — pure cosmetic refactor of a large working page (all data already present); regression risk outweighs benefit.
- **Subgraph ownership transfer** (#19), **dev-subgraph playground** (#20), **metadata-editing completion** — `/dock` studio scope; ownership transfer is an irreversible on-chain GNS tx. Parked until the studio is a priority.

---

## Notes

- **Billing** is out of scope — Lodestar doesn't charge users and shouldn't.
- **Cooldown remaining** is present on the indexer *detail* page already; the gap is only the directory *table* column.
- **Deploy key** in /dock is fully live — not a gap.
- **Delegation withdraw** is fully live — not a gap.
- **GraphQL playground** is now full GraphiQL (schema browser / autocomplete / highlighting) — gap closed.
- **Contract-address search** searches the raw deployment manifest string; the network subgraph exposes no indexed data-source address field, so per-address `where` filtering isn't possible — `manifest_contains_nocase` is the workable approach.
- **Closed allocations** are capped at the 50 most recent (history can be very large); the cap is intentional, not pagination.
- Tier 1 item #6 (API key management) is now the biggest remaining lift — the most differentiating Studio feature Lodestar doesn't touch at all.
