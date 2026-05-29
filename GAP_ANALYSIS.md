# Lodestar vs. Graph Explorer & Studio — Replacement Analysis

> Last updated: 2026-05-29
> **Goal (revised): full replacement, not parity.** A subgraph developer should never need
> to open **Studio** again; nobody should need to open **Explorer** again.
> Status legend: ✅ Live | 🟡 Partial | ❌ Missing | 🛠️ Planned | 🔒 Out of scope
> All "Live" items verified by reading actual source code — not inferred.

---

## Thesis

Parity is already done and, in most areas, exceeded. The remaining question is **replacement**:
can a user of either official product do *100%* of their job inside Lodestar?

- **Explorer side (delegators / curators / observers): replacement is effectively complete.**
  Every Explorer surface is matched, and Lodestar adds a large differentiator set (the "moat"
  below) that Explorer has no answer to.
- **Studio side (subgraph developers): replacement is ~90% complete and under-documented.**
  `/dock` already does real on-chain publishing, versioning, deploy keys, IPFS upload, a query
  proxy and the sync-bounty flow. The single remaining tether to Studio is the **query-key
  lifecycle** (mint keys, restrict them, watch usage/spend, top up billing) — Studio's key API
  is private, so the only way to cut that tether is to **become the gateway** (RFC-004).

This document is now organised as a **replacement roadmap**, not a parity checklist.

---

## Lodestar's Moat (features the official products don't have)

These are Lodestar's differentiators — don't lose them chasing replacement.

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

## Studio Replacement — current reality

The previous revision of this doc badly undersold `/dock`. Verified against
`src/app/dock/page.tsx`, `src/lib/studio/*` and `src/app/api/studio/*`:

| Studio capability | Lodestar | Verified status |
|---|---|---|
| Wallet sign-in / auth | ✅ | Signed-message auth + HMAC stateless session cookie (`src/lib/studio/auth.ts`, `/api/studio/auth`) |
| Create / rename / delete a subgraph | ✅ | Authenticated CRUD persisted in Postgres (`/api/studio/subgraphs`, `/subgraphs/[id]`) |
| Deploy key — display / generate | ✅ | Real 32-byte key, hashed in DB, shown once (`/api/studio/deploy-key`) |
| `graph-cli` deploy target | ✅ | JSON-RPC endpoint accepts `subgraph_create` / `subgraph_deploy` (`/api/studio/node`); records IPFS hash. No private graph-node — direct-to-network by design |
| IPFS upload (WASM + manifest) | ✅ | Authenticated proxy to `GRAPH_IPFS_URL` (`/api/studio/ipfs/[...path]`) |
| Metadata → IPFS (subgraph + version) | ✅ | Uploads to The Graph IPFS, returns CIDv0 + bytes32 (`/api/studio/metadata`) |
| **Publish new subgraph (on-chain)** | ✅ | Real `GNS.publishNewSubgraph(deploymentId, versionMeta, subgraphMeta)` write on Arbitrum One; extracts NFT id from Transfer logs |
| **Publish new version (on-chain)** | ✅ | Real `GNS.publishNewVersion(subgraphId, deploymentId, versionMeta)` write |
| GraphQL playground / query | ✅ | Session-auth'd gateway proxy (`/api/studio/query/[id]`) + embedded GraphiQL on the public subgraph page |
| Post / claim / cancel / refund sync bounties | ✅ | Full BountyBoard flow on-chain (`post`/`claim`/`cancel`/`refundExpired`) |
| **Update subgraph metadata on-chain (post-publish)** | 🛠️ Planned | Only off-chain display-name/description edited today; on-chain `updateSubgraphMetadata` not yet wired |
| **Transfer subgraph ownership** | 🛠️ Planned | GNS NFT transfer — not yet wired (previously "won't do", now committed) |
| **Deprecate / archive subgraph** | 🛠️ Planned | GNS `deprecateSubgraph` — not yet wired |
| **Subgraph health monitor + alerting** | 🛠️ Planned | Sync status/health/errors visible (`/api/indexing-status`); webhook/Discord/Slack alerting not built |
| **API-key lifecycle** (mint / restrict / usage / spend) | 🛠️ Planned | The one true tether to Studio. See **Metered Gateway (RFC-004)** below |
| Billing — GRT deposit/withdraw/balance | 🛠️ Planned | Part of the gateway plan; on-chain billing ledger |

**Verdict:** the publish pipeline is real and on-chain. The replacement-blocking gaps are
(1) the query-key lifecycle, (2) the cheap on-chain lifecycle writes, and (3) health alerting.
All three are now committed work (below) rather than "won't do".

---

## Gap Table by Feature Area

### 1. Subgraph Discovery & Filtering

| Feature | Explorer | Lodestar | Verified Status |
|---|---|---|---|
| Search by **contract address** | ✅ | ✅ | **Live** — `subgraph-search/route.ts` substring-matches the deployment manifest (`manifest_contains_nocase`); network subgraph has no indexed data-source address field |
| Category filter: DeFi / NFTs / DAOs | ✅ | ✅ | **Live** — filters on `metadata.categories` with URL sync (`subgraphs/page.tsx`) |
| Sort: Most Queried | ✅ | ✅ | **Live (as Query Fees)** — network subgraph exposes only `queryFeesAmount`, not query count |
| Sort: Recently Created / Updated | ✅ | 🛠️ Planned | Promoted from "deferred" — needed for full Explorer replacement; add a sortable "Created" column |
| Per-subgraph **query count** | ✅ | ❌ | Not buildable from the network subgraph (gateway-only analytic). **Becomes buildable** for subgraphs routed through the Lodestar gateway (RFC-004) |
| Filter by indexed chain | ✅ | ✅ | Live |
| Sort by signal / stake / fees | ✅ | ✅ | Live |
| Complexity filter (Light/Moderate/Heavy/Extreme) | ❌ | ✅ | Lodestar leads |
| Elite filter (>1K GRT fees) | ❌ | ✅ | Lodestar leads |

---

### 2. Subgraph Detail Page

| Feature | Explorer | Lodestar | Verified Status |
|---|---|---|---|
| **Built-in GraphQL playground** | ✅ | ✅ | **Live** — embedded GraphiQL v4 (schema browser, autocomplete, highlighting), server-proxied (`SubgraphGraphiQL.tsx`) |
| **Subgraph version history** | ✅ | ✅ | **Live** — Versions tab (`subgraph-versions` route + `VersionsTable`) |
| **Activity log** | ✅ | ✅ | **Live** — Activity tab merges version-publish + curator-signal events (`ActivitySection`) |
| **Network gateway query URL** | ✅ | ✅ | **Live** — real gateway endpoint shown + copyable |
| Per-subgraph indexer status table | ✅ | ✅ | Live — IndexerStatus section |
| Signal / Unsignal on-chain | ✅ | ✅ | Live (via /curate, real `mintSignal`/`burnSignal`) |
| Schema browser | ✅ | ✅ | Live |
| Curator breakdown | ✅ | ✅ | Live |
| Signal/stake/fees history chart | ✅ | ✅ | Live |
| Manifest & complexity analysis | ❌ | ✅ | Lodestar leads |

---

### 3. Indexer Table & Directory

| Feature | Explorer | Lodestar | Verified Status |
|---|---|---|---|
| **Cooldown remaining** column | ✅ | ✅ | **Live** — sortable column in `IndexerTable.tsx` |
| Query Fee Cut % | ✅ | ✅ | Live |
| Effective Reward Cut | ✅ | ✅ | Live |
| Owned / Delegated / Allocated stake | ✅ | ✅ | Live |
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
| **Disputes / slashing history** | ✅ | ✅ | **Live** — `DisputesSection` from ingested `disputes` table |
| **Operator address** display | ✅ | ✅ | **Live** — `account.operators` linked to Arbiscan |
| **Historical / closed allocations** | ✅ | ✅ | **Live** — `ClosedAllocationsTable` (most recent 50) |
| **Cooldown remaining** | ✅ | ✅ | Live — inline "Locked for Xd" in parameters card |
| Live node syncing status per deployment | ❌ | ✅ | Lodestar leads |
| REO eligibility + renewal countdown | ❌ | ✅ | Lodestar leads |
| QoS oracle chart | ❌ | ✅ | Lodestar leads |
| Parameter change history timeline | ❌ | ✅ | Lodestar leads |
| 11-dimensional risk score breakdown | ❌ | ✅ | Lodestar leads |

---

### 5. Network & Epochs

| Feature | Explorer | Lodestar | Verified Status |
|---|---|---|---|
| **Epoch status per row** | ✅ | ✅ | **Live** — derived (`epochStatus`); labelled approximation (no on-chain status field) |
| Per-epoch query fees + rewards **table** | ✅ | ✅ | **Live** — `EpochTable` on the network page |
| Cumulative token supply (minted/burned) | ✅ | ✅ | **Live** — "Total Supply" headline card |
| Annual issuance rate | ✅ | ✅ | **Live** — computed "Annual Issuance (est.)" (~8.6% live) |
| Current epoch number + progress | ✅ | ✅ | Live |
| Protocol parameters grid | ✅ | ✅ | Live |
| Participant counts | ✅ | ✅ | Live |

---

### 6. User Profile / Delegator Portfolio

| Feature | Explorer | Lodestar | Verified Status |
|---|---|---|---|
| **Delegation status**: Delegating / Undelegating / Withdrawable | ✅ | ✅ | **Live** — distinct "Withdrawable" badge (`deriveDelegationStatus` / `DelegationStatusBadge`) |
| **Withdraw thawed GRT** | ✅ | ✅ | Live — full flow in `UndelegatePanel.tsx` |
| **Undelegate** (25%/50%/ALL) | ✅ | ✅ | Live |
| Indexer's own tabbed profile | ✅ | 🟡 | All data present on detail page; tabbing is a cosmetic refactor — low priority, not blocking replacement |
| **Operator address configuration** (indexers) | ✅ | 🛠️ Planned | Promoted from "won't do" — needed so an indexer never opens Explorer settings either |
| **ENS name configuration** | ✅ | 🛠️ Planned | Promoted from "won't do" for the same reason |
| Published subgraphs you've created | ✅ | ✅ | Surfaced via `/dock` (developer's own subgraph list) |
| Thawing countdown timer | ✅ | ✅ | Live |
| Delegation position cards | ✅ | ✅ | Live |
| Rewards CSV export | ❌ | ✅ | Lodestar leads |
| iCal thaw reminder | ❌ | ✅ | Lodestar leads |

---

### 7. Studio-Equivalent Developer Tools

| Feature | Studio | Lodestar | Verified Status |
|---|---|---|---|
| **Subgraph create / publish / version (on-chain)** | ✅ | ✅ | **Live** — real GNS writes (see Studio Replacement table) |
| **Deploy key** display + regeneration | ✅ | ✅ | Live (`/api/studio/deploy-key`) |
| **Playground / query proxy** | ✅ | ✅ | Live (`/api/studio/query/[id]` + GraphiQL) |
| **IPFS upload for `graph-cli`** | ✅ | ✅ | Live (`/api/studio/ipfs/[...path]`) |
| **On-chain metadata update (post-publish)** | ✅ | 🛠️ Planned | `GNS.updateSubgraphMetadata` — cheap, we already do GNS writes |
| **Subgraph ownership transfer** | ✅ | 🛠️ Planned | GNS NFT transfer — promoted from "won't do" |
| **Deprecate / archive subgraph** | ✅ | 🛠️ Planned | `GNS.deprecateSubgraph` |
| **Subgraph health monitor + alerting** | ✅ | 🛠️ Planned | Sync/health/errors visible; add webhook/Discord/Slack alerting (Tier 4 #17) |
| **API key management** (create/rename/regenerate/delete) | ✅ | 🛠️ Planned | Metered Gateway RFC-004 — the replacement-blocker |
| **API key domain/subgraph restrictions** | ✅ | 🛠️ Planned | RFC-004 Phase 4 (domain/deployment allow-lists) |
| **Indexer routing preferences per key** | ✅ | 🛠️ Planned | The RFC's *differentiator*: route by Lodestar risk/REO/QoS scores. Out of scope as a commodity, in scope as intelligence-layer routing |
| **Query usage monitoring per key** | ✅ | 🛠️ Planned | RFC-004 `api_key_usage` metering — **plus a Lodestar analytics overlay Studio lacks** (ships in non-custodial Phase 1) |
| **Billing** — GRT deposit/withdraw/balance | ✅ | 🛠️ Planned | RFC-004 Phase 2 — prepaid GRT balance, reserve-then-reconcile (the custody step) |

---

### 8. Ecosystem / Product Discovery

| Feature | Explorer | Lodestar | Verified Status |
|---|---|---|---|
| Token API discovery + links | ✅ | 🟡 | Low value; revisit only if it blocks an Explorer user. Not prioritised |
| Substreams discovery + links | ✅ | 🟡 | Same |
| AI/MCP gateway | Planned | ✅ | Lodestar leads with Lodie |

---

## The Metered Gateway (RFC-004) — the last tether to Studio

**Decision (2026-05-29): revive it.** The one thing keeping a developer in Studio is the
query-key lifecycle, and Studio's key API is private — there is no public endpoint to mint
keys on a user's behalf. The only way to give developers a Studio-free key lifecycle is to
**become the gateway**: Lodestar mints its own keys, meters per-developer usage, and debits a
prepaid GRT balance.

### What Phase 0 already built (on `metered-gateway` branch)

Phase 0 is "Foundations — no money, no proxy". Verified contents of the branch:

- `RFC-004-METERED-GATEWAY.md` — the full design (summary above): key format, reserve-then-
  reconcile at-cost billing, the Path-B VPS proxy architecture, the 5-phase plan (0–4),
  parking rationale, and open verification items.
- `scripts/migrate-studio-v5.sql` — Postgres schema: `billing_accounts`, `billing_transactions`
  (append-only, idempotent on `tx_hash`), `studio_api_keys`, `api_key_usage`.
- `src/lib/studio/billing.ts` — **pure** billing math (no DB/Redis/RPC/Next imports so the
  standalone proxy can import it): `usdToGrt`/`grtToUsd`, `reserveRateGrt` (1.3× buffer over
  the $2/100k published rate), `canAfford`, `debit`, `reconcileRefund` (pro-rata true-up,
  never negative — Lodestar absorbs under-coverage, so the free 100k/mo tier passes through).
- `src/lib/studio/api-keys.ts` — `generateApiKey()` → `lod_live_` + 48 hex; `hashApiKey()`
  SHA-256 at rest; `isValidApiKeyFormat()`.
- Exhaustive unit tests for both libs; `scripts/backup-lodestar-db.sh` (a hard gate before any
  money moves).

**Not yet built** (Phases 1–4): the actual proxy, Redis reserve-commit, deposit watcher,
reconciliation cron, key-CRUD routes, and the `/dock` billing UI. Phase 0 is the safe,
money-free groundwork — the libs are reusable even if we never operate a custodial gateway.

### The honest risk (verbatim from the RFC, kept in view)

At cost this is a **zero-margin resale of a commodity** Studio gives away free. Operating it
adds **custody of user funds + treasury ops + money-transmitter/regulatory exposure**, plus a
**SPOF** — our proxy in front of the decentralised gateway "undoes part of decentralisation"
(the RFC's own words). It only pays when **bundled with the intelligence layer** Lodestar
uniquely has: routing queries to indexers by Lodestar's risk/REO/QoS scores, SLA-backed
analytics, per-query indexer selection. That's a differentiated product, not a commodity resale.

### Staged rollout (the RFC's own phasing — note Phase 1 is already non-custodial)

The decision is "own the pipe", but the RFC's phasing already front-loads value **before**
custody, which is exactly the de-risked path:

0. **Phase 0 — Foundations.** ✅ DONE (above).
1. **Phase 1 — Key CRUD + free tier only.** Mint/list/revoke `lod_live_` keys, proxy with a
   free 100k/month quota, **NO billing — non-custodial**. This already ships the usage
   dashboard (the one thing Studio's usage view doesn't match) with **zero regulatory exposure**.
   Build the proxy + key-CRUD routes + `/dock` keys panel; reuse the existing session auth.
2. **Phase 2 — Deposits + metering.** Deposit watcher (Arbitrum GRT `Transfer` → treasury),
   prepaid balance, reserve-commit on the proxy (Redis Lua). **This is the custody step.**
3. **Phase 3 — Reconciliation + refunds.** True-up cron against real gateway fees, refund
   excess, low-balance alerts.
4. **Phase 4 — Key restrictions + recalibration.** Domain/deployment allow-lists, spend caps,
   recalibrate the per-query rate from real spend. After this the developer never opens Studio.

> Jenny's note, Chief: Phase 1 is the sweet spot — it closes the *perceived* gap (keys +
> usage dashboard, non-custodial) with none of the legal weather. Phase 2 is where we actually
> become a money-handler, and the RFC itself flags a money-transmitter legal review as a hard
> precondition. Don't hold a single wei of anyone else's GRT before that review and the
> intelligence-layer bundling are both settled.

---

## Replacement Roadmap (priority tiers)

### Tier 0 — Already shipped (parity + most of Studio)
Everything marked ✅ above. Explorer replacement is effectively complete; Studio publish
pipeline is real and on-chain.

### Tier 1 — Cheap on-chain lifecycle writes (we already do GNS writes)
Highest value-to-effort: reuses the existing `/dock` wagmi/viem write infrastructure.

1. 🛠️ `GNS.updateSubgraphMetadata` — edit published subgraph metadata on-chain.
2. 🛠️ `GNS` ownership transfer (NFT transfer) — hand a subgraph to another wallet.
3. 🛠️ `GNS.deprecateSubgraph` — deprecate / archive.
4. 🛠️ "Recently Created / Updated" sort on the subgraph directory (Explorer-replacement polish).

### Tier 2 — Metered Gateway, non-custodial first (RFC-004 Phase 1)
5. 🛠️ RFC-004 **Phase 1** — Lodestar-minted `lod_live_` keys + free 100k/mo quota + the
   standalone proxy + key-CRUD routes + `/dock` keys & usage panel. **Non-custodial, no
   billing.** Ships the usage dashboard (Studio's weak spot) with zero regulatory exposure.

### Tier 3 — Health monitoring + alerting
6. 🛠️ Subgraph health monitor with webhook / Discord / Slack alerting (roadmap-q2 Tier 4 #17).
7. 🛠️ Indexer/operator settings writes (operator address, ENS) so indexers also never open Explorer.

### Tier 4 — Custodial gateway (gated)
8. 🛠️ RFC-004 **Phase 2** — deposit watcher + prepaid balance + reserve-commit metering.
   **This is the custody step. Blocked on a money-transmitter legal review + the
   intelligence-layer bundling.** Do not start before both are resolved.
9. 🛠️ RFC-004 **Phase 3** — reconciliation/refund cron + low-balance alerts.
10. 🛠️ RFC-004 **Phase 4** — per-key domain/deployment restrictions, spend caps, rate recalibration.

### 🔒 Out of scope / deferred
- **Indexer routing preferences per key** — gateway-internal at The Graph; not ours to control
  unless we operate routing ourselves.
- **Token API / Substreams discovery links** — low value; revisit only if it blocks a user.
- **Unified tabbed indexer profile** — cosmetic refactor, all data already present.

---

## Notes

- **`/dock` is a real Studio replacement today** — wallet auth, subgraph CRUD, deploy keys,
  `graph-cli` deploy, IPFS upload, on-chain GNS publish + versioning, query proxy, sync bounties.
  The earlier "won't do: metadata editing / dev playground" lines were stale and are corrected.
- **The only genuine Studio tether is the query-key lifecycle** — and it's private at The Graph,
  hence RFC-004.
- **Custody is the real risk**, not the engineering. The gateway is buildable in weeks; holding
  other people's GRT is a legal/regulatory decision. Non-custodial Phase 1 sidesteps it.
- **Per-subgraph query count** (un-buildable from the network subgraph) **becomes buildable**
  for traffic routed through the Lodestar gateway — a replacement bonus, not just parity.
- **Closed allocations** capped at 50 most recent — intentional, not pagination.
- The intelligence layer (risk/REO/APY/advisor + Lodie + enriched data) remains the moat that
  makes the gateway economics work; without it the gateway is a zero-margin commodity resale.
