# April 2026 — Community Feature Requests

Tracking community-requested features and enhancements from user feedback.

---

## Andrew Clews (via EthCC, 30 Mar 2026)

### 1. Delegator Historical Inflows/Outflows Chart
- **Page:** `/delegators`
- **Request:** Chart over time showing net historical inflows and outflows
- **Effort:** Medium
- **Status:** Not started

**What we have:**
- `delegation_events` table already ingested continuously (event_type, delegator, indexer, tokens_grt, timestamp)
- `indexer_db.net_flow_grt_7d` already aggregated for 7d window
- `IndexerTrendsChart` component is a good pattern to follow (tabbed AreaChart/BarChart)

**Plan:**
1. New API route `/api/delegation-flows` — aggregate `delegation_events` by day, splitting inflows (StakeDelegated) vs outflows (StakeUndelegated), with configurable time range (30d/90d/1y)
2. New `DelegationFlowChart` component — stacked bar or area chart (green inflows, red outflows, line for net flow)
3. New hook `useDelegationFlows(days)` — React Query wrapper
4. Place on `/delegators` page above or below the existing DelegationFeed

### 2. Net Token Issuance / Burn Over Time
- **Request:** Historical chart of net GRT issuance vs burn
- **Bonus:** Break out burn source by type (curation tax, query fee burn, etc.)
- **Effort:** Medium-High
- **Status:** Not started

**What we have:**
- `epochs` table has `total_rewards` (issuance), `taxed_query_fees` (fee burn), per-epoch
- `disputes` table has `tokens_burned_grt` (slashing burn)
- `network_snapshots` captures staked/delegated/signalled but NOT `totalSupply`
- `networkGRTIssuancePerBlock` fetched in refresh.ts but not persisted historically

**Plan:**
1. Add `total_supply_grt` column to `network_snapshots` — store from `graphNetwork.totalSupply` during snapshot cron
2. New API route `/api/token-metrics` — join epochs + disputes to compute per-epoch: issuance, dispute burn, query fee tax burn, net issuance
3. New `TokenIssuanceChart` component — stacked area chart with burn breakdown by source
4. Place on `/delegators` or a new `/network` overview page

**Burn sources to break out:**
- Indexing reward issuance (positive)
- Query fee tax burn (negative)
- Dispute/slashing burn (negative)
- Delegation tax (removed in Horizon — historical only)

---

## IroqouisPliskin (via GRT chat, 30 Mar 2026)

### 3. Subgraph Detail — Show Name & Network at Top
- **Page:** `/subgraphs/[hash]`
- **Request:** Display high-level info (subgraph name, network) prominently at the top so users can distinguish between multiple open tabs
- **Effort:** Low
- **Status:** Not started

**What we have:**
- Detail page currently only shows "Deployment" + IPFS hash in header
- `displayName` is available from the subgraph deployments API but not passed to detail page
- Network is available via `useManifestAnalysis(hash)` (already fetched on detail page for ManifestSection)

**Plan:**
1. Fetch subgraph metadata on detail page (either pass via link state or add a lightweight lookup endpoint)
2. Pull network from manifest analysis (already loaded)
3. Update header: show subgraph name as `<h1>`, network badge, IPFS hash as secondary info
4. Update `<title>` tag so browser tabs show the subgraph name too

### 4. Subgraph List — Retain Filter State on Back Navigation
- **Page:** `/subgraphs`
- **Request:** When filtering the list, clicking into a subgraph, then pressing back, the filters should be preserved rather than reset
- **Effort:** Low-Medium
- **Status:** Not started

**What we have:**
- Filters are all React state: `page`, `sortKey`, `sortDesc`, `searchQuery`, `feeWindow`, `eliteOnly`, `networkFilter`, `complexityFilter`
- Zero URL search params currently — back button resets everything
- Back link is hardcoded `<Link href="/subgraphs">`

**Plan:**
1. Sync all filter state to URL search params via `useSearchParams` + `useRouter.replace`
2. On mount, read initial state from URL params (fallback to defaults)
3. Change "Back to Subgraphs" link on detail page to use `router.back()` or preserve the query string
4. This also gives users shareable filtered views for free

---

## Status

| # | Feature | Status |
|---|---------|--------|
| 1 | Delegation inflows/outflows chart | Done |
| 2 | Token issuance/burn chart | Done |
| 3 | Subgraph name/network header | Done |
| 4 | Filter state persistence | Done |

## Pre-deploy: Database Migration

Run this on the production database before deploying:

```sql
ALTER TABLE network_snapshots ADD COLUMN IF NOT EXISTS total_supply_grt NUMERIC;
```

This enables future snapshots to capture GRT total supply. Historical issuance/burn data
uses epoch-level data which is already in the database.
