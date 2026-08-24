# Nuthatch migration checklist

Last checked: 24 August 2026.

This is the operational ledger for removing The Graph from Lodestar. A row is not migrated because
there is a Nuthatch query which looks plausible. It is migrated only when production serves it from
a nest, reports that provenance, and a fixed-block comparison has passed against the incumbent data.
An unavailable nest must produce a visible error, never a silent Graph fallback.

## Legend and cutover gate

- **Live**: production is Nuthatch-only.
- **Shadow**: a nest is running and comparisons are in progress. Production still uses its existing source.
- **Planned**: no Nuthatch replacement is running yet.
- **Blocked**: a known data or schema gap prevents a safe cutover.

Before changing a route to **Live**, record all of the following in the migration PR or issue:

1. The contracts, events, start block and Nuthatch query used.
2. Exact parity at one fixed block over the route's retained history, including pagination and ordering.
3. A fresh-data check at the current tip, with source reported as `nuthatch` in the API response.
4. Failure behaviour: Nuthatch outage returns an error and does not call The Graph.
5. A rollback procedure that restores the previous release, not a hidden secondary data path.

## Running nests

| Nest | Data | State | Notes |
|---|---|---|---|
| `graph-staking-nest` | HorizonStaking delegation events | Live | Serves Delegation Activity. |
| `graph-gns-nest` | L2GNS `SubgraphPublished` | Live | Serves Developer Activity. |
| `horizon-nest` | Horizon lifecycle events | Available | Data is retained and will be wired route by route. |
| `graph-staking-history` | Full HorizonStaking history | Complete, stopped | Historical shadow retained on disk and disabled after the legacy parity run, to avoid archive-RPC follow-mode polling. |
| `graph-staking-legacy-history` | Legacy and Horizon delegation-flow events | Read-only | Sealed 504,702 events from block 42,449,585 to 497,849,211 on 24 August 2026. It is served read-only for Delegation Flows, with no RPC configuration or cursor. The live staking nest supplies the post-backfill tail. |

All three public Lodestar nests run Nuthatch 2.7.1. The history nest is deliberately not exposed to
Lodestar yet.

## Migrated to production

| Surface | Lodestar route | Nuthatch data | Status | Verification |
|---|---|---|---|---|
| Delegation Activity | `/api/delegation-events` | HorizonStaking delegation events | **Live** | Production reports `source: "nuthatch"`; no Graph code path remains. |
| Developer Activity | `/api/developer-activity` | L2GNS `SubgraphPublished` | **Live** | Production reports `source: "nuthatch"`; no Graph code path remains. |

## Active parity work

| Surface | Lodestar route | State | What is known | Required before cutover |
|---|---|---|---|---|
| Delegation flows | `/api/delegation-flows` | **Cutover verification** | The read-only legacy nest plus the live staking tail match 729 of 730 daily buckets. The lone difference is the oldest partial cache day, caused by the incumbent payload having been generated minutes earlier. | Deploy the Nuthatch-only route and verify public provenance and freshness. No further backfill is needed. |

The current HorizonStaking contract began late in 2025. Treating it as the whole of Arbitrum staking
history would make the chart appear healthy while silently dropping older activity, which is a
particularly tidy sort of fraud. It remains on the existing source until this is fixed.

## Planned route migrations

These routes still import the Graph client. They are grouped by the data family to be indexed and
verified, but each line remains a separate cutover.

### Network and indexer state

- [ ] `/api/indexers`
- [ ] `/api/indexer/[address]`
- [ ] `/api/indexer-status/[address]`
- [ ] `/api/indexer-stake-history/[address]`
- [ ] `/api/indexer-trends`
- [ ] `/api/indexer-qos/[address]`
- [ ] `/api/network-stats`
- [ ] `/api/token-metrics`
- [ ] `/api/epochs`
- [ ] `/api/curators`
- [ ] `/api/ens`

### Subgraph, curation and discovery

- [ ] `/api/indexing-status/[hash]`
- [ ] `/api/subgraph-curation/[hash]`
- [ ] `/api/subgraph-deployments`
- [ ] `/api/subgraph-fees-30d`
- [ ] `/api/subgraph-history/[hash]`
- [ ] `/api/subgraph-names`
- [ ] `/api/subgraph-search`
- [ ] `/api/subgraph-versions/[hash]`
- [ ] `/api/bounty-query/[id]`
- [ ] `/api/poi`

### Financial and protocol lifecycle

- [ ] `/api/grt-flow`
- [ ] `/api/payments`
- [ ] `/api/portfolio`
- [ ] `/api/provisions`
- [ ] `/api/rewards-history`
- [ ] `/api/apr-provenance/[address]`

### Scheduled ingestion and snapshots

- [ ] `/api/cron/check-subgraph-health`
- [ ] `/api/cron/ingest-allocations`
- [ ] `/api/cron/ingest-disputes`
- [ ] `/api/cron/ingest-epochs`
- [ ] `/api/cron/ingest-horizon-activity`
- [ ] `/api/cron/ingest-qos`
- [ ] `/api/cron/ingest-rav`
- [ ] `/api/cron/snapshot-network`
- [ ] `/api/cron/tap-provision`

## Supporting work

- [x] Add the legacy Arbitrum staking ABI and event topics to an isolated history nest.
- [x] Finish the legacy backfill, catch it up to tip, and stop it before follow-mode polling.
- [x] Apply the exact timestamp cutoff in Delegation Flows' Nuthatch query and serve the completed history read-only.
- [ ] Verify the deployed Delegation Flows route and mark it Live.
- [ ] Define a versioned Nuthatch query contract for every migrated route, including cursor and
      ordering semantics.
- [ ] Keep fixed-block parity fixtures for each route in CI before its production switch.
- [ ] Remove the corresponding Graph client query and Graph API-key requirement only after the route
      is Live.
- [ ] Remove the Graph client, Graph environment variables and Graph dependencies once every route
      above is Live.
- [ ] Expose `seal-direct` backfill progress through `/metrics` and the TUI. Tracked in
      [nuthatch#807](https://github.com/nightswatchhq/nuthatch/issues/807).

The final checkbox is intentionally last. Deleting the Graph dependency before the individual data
families are indexed would not be a migration. It would be an outage with excellent intentions.
