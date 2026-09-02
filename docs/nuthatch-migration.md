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

## What happens when a nest is down

Decided, and the measurement that forced the decision is below. Tracked as `nuthatch#1080`.

### The policy

**Fail visibly. Never fall back to The Graph, and never serve data without saying how current it is.**

That is already the stated rule at the top of this document, and it is already the de facto behaviour
of the panels migrated in 4.26.0, which need a configured Nuthatch origin and have no alternate
source. What follows makes it enforceable rather than conventional.

1. **A serving route must consult `/ready` before answering**, not merely have someone alerting on it
   elsewhere. `/ready` is the nest's own judgement: it 503s when quarantined or stalled and carries
   `lag_blocks`, `sealed_through` and `cursorless` to explain itself.
2. **An unready nest produces an error the caller can render**, with the nest's reason attached. A
   panel saying "delegation data is 3 weeks behind" is useful. A panel quietly showing 3-week-old
   numbers is worse than a blank one.
3. **Every response carries its own freshness** - `as_of` and `sealed_through` from `/sql` provenance
   - so a caller can decide for itself. This is *better* than the gateway, which cannot say.
4. **No route may fall back to The Graph.** A dual-source route is two sources of truth and one of
   them is wrong; the whole point of the migration is that we stop guessing which.

### Why this needed deciding rather than assuming

Measured 2026-09-01 across the five routes already served by a nest:

| route | checks `/ready` before serving | reports data freshness |
|---|---|---|
| `/api/delegation-events` | no | no |
| `/api/delegation-flows` | no | no |
| `/api/developer-activity` | no | no |
| `/api/dips` | no | no |
| `/api/sql/query` | no | no |

**Zero of five.** `src/lib/nest-health.ts` exists, probes `/ready` correctly, and reasons about why
`/ready` beats `/health` - but its only three consumers are `cron/check-nest-health`,
`lib/notifications/nest-health.ts` and `cron-expectations.ts`. Every one of them is **alerting**.
Nothing gates serving.

So today a stalled or quarantined nest still answers with 200 and stale rows, and the only signal is
an out-of-band cron that alerts somebody separately. That is precisely the case this document's own
opening rules out, and it is the current behaviour of every migrated panel.

A note on how that was almost missed: grepping these routes for `as_of|sealed_through|stale` returns
a hit in four of five, which reads as freshness reporting. Every one of those hits is
`stale-while-revalidate` in a `Cache-Control` header, which is HTTP caching and says nothing about
the data. The right answer needed reading the lines rather than counting them.

### What this blocks

**No further surface switches to a nest until 1-3 are implemented.** #1078 moves several network-state
surfaces at once; doing that on top of a serving path with no readiness gate multiplies a nest
restart into a dashboard of confidently wrong numbers. #1078 is blocked on the nest deploying anyway,
so this costs no time.

## Running nests

| Nest | Data | State | Notes |
|---|---|---|---|
| `graph-staking-nest` | HorizonStaking delegation events | Live | Serves Delegation Activity. |
| `graph-gns-nest` | L2GNS `SubgraphPublished` | Live | Serves Developer Activity. |
| `horizon-nest` | Horizon lifecycle events | Available | Data is retained and will be wired route by route. |
| `graph-staking-history` | Full HorizonStaking history | Complete, stopped | Historical shadow retained on disk and disabled after the legacy parity run, to avoid archive-RPC follow-mode polling. |
| `graph-staking-legacy-history` | Legacy and Horizon delegation-flow events | Live, read-only | Sealed 504,702 events from block 42,449,585 to 497,849,211 on 24 August 2026. It serves Delegation Flows with no RPC configuration or cursor. The live staking nest supplies the post-backfill tail. |

Every Nuthatch service Lodestar queries runs Nuthatch 2.7.1. The legacy history service is deliberately
read-only; `horizon-nest` and `graph-staking-history` are not yet wired into Lodestar.

## Migrated to production

| Surface | Lodestar route | Nuthatch data | Status | Verification |
|---|---|---|---|---|
| Delegation Activity | `/api/delegation-events` | HorizonStaking delegation events | **Live** | Production reports `source: "nuthatch"`; no Graph code path remains. |
| Developer Activity | `/api/developer-activity` | L2GNS `SubgraphPublished` | **Live** | Production reports `source: "nuthatch"`; no Graph code path remains. |
| Delegation Flows | `/api/delegation-flows` | Read-only legacy history plus live HorizonStaking tail | **Live** | Production reports `source: "nuthatch"`; 30-day freshness verified and no DB or Graph code path remains. |

## Active parity work

| Surface | Lodestar route | State | What is known | Required before cutover |
|---|---|---|---|---|
| None | — | — | Delegation Flows passed its cutover verification. The 730-day comparison has one expected oldest partial cache-day difference, caused by the incumbent payload having been generated minutes earlier. | — |

The current HorizonStaking contract began late in 2025. Treating it as the whole of Arbitrum staking
history would make the chart appear healthy while silently dropping older activity, which is a
particularly tidy sort of fraud. It remains on the existing source until this is fixed.

## Planned route migrations

These routes still import the Graph client. They are grouped by the data family to be indexed and
verified, but each line remains a separate cutover.

### Network and indexer state

- [ ] `/api/indexers`
- [ ] `/api/indexer/[address]`
- [ ] `/api/indexer-stake-history/[address]`
- [ ] `/api/indexer-qos/[address]`
- [ ] `/api/network-stats`
- [ ] `/api/token-metrics`
- [ ] `/api/epochs`
- [ ] `/api/curators`
- [ ] `/api/ens`

### Subgraph, curation and discovery

- [ ] `/api/subgraph-curation/[hash]`
- [ ] `/api/subgraph-deployments`
- [ ] `/api/subgraph-fees-30d`
- [ ] `/api/subgraph-history/[hash]`
- [ ] `/api/subgraph-names`
- [ ] `/api/subgraph-search`
- [ ] `/api/subgraph-versions/[hash]`
- [ ] `/api/poi`

### Financial and protocol lifecycle

- [ ] `/api/grt-flow`
- [ ] `/api/payments`
- [ ] `/api/portfolio`
- [ ] `/api/provisions`
- [ ] `/api/rewards-history`
- [ ] `/api/apr-provenance/[address]`

### Scheduled ingestion and snapshots

- [ ] `/api/cron/ingest-allocations`
- [ ] `/api/cron/ingest-disputes`
- [ ] `/api/cron/ingest-epochs`
- [ ] `/api/cron/ingest-horizon-activity`
- [ ] `/api/cron/ingest-qos`
- [ ] `/api/cron/ingest-rav`
- [ ] `/api/cron/snapshot-network`
- [ ] `/api/cron/tap-provision`

## Intended Graph surfaces - not migration work

Recorded because "Lodestar still has N files touching the gateway" is true, alarming and misleading,
and without this list somebody eventually tries to migrate a GraphiQL component off GraphQL. These
are **correct as they are**, and they are not counted in the completion figure. Cross-referenced with
`nuthatch#1074`'s inventory, which classifies every gateway-touching file in this repository.

**The gateway, or an indexer, is the subject.** No on-chain indexer can serve these, because the
thing being measured is the serving:

| Surface | Why it stays |
|---|---|
| `/api/subgraph-playground/[hash]` | proxies a query to a user-chosen deployment. A playground with no subgraph is a deleted feature, not a migrated one. |
| `/api/x402/query` | keyless pay-per-query proxy to the gateway. The gateway is the product being resold. |
| `/api/studio/query/[id]` | queries an arbitrary studio subgraph by id. |
| `/api/bounty-query/[id]` | proxies a query to the winning indexer's own endpoint. |
| `/api/gateway/[key]` | the metered query gateway proxy. |
| `/api/indexer-status/[address]` | reads indexers' own `/status` endpoints. Serving telemetry, not chain state. |
| `/api/indexing-status/[hash]` | same: probes which indexers are serving a deployment, and how far behind. |
| `/api/cron/check-subgraph-health` | alerts on serving health. Cannot be answered by not querying. |
| `/api/indexer-trends` | community Horizon performance timeseries, a third party's subgraph. |
| `lib/gateway-probe.ts` | fires a live query *through* the gateway. That is the measurement. |
| `components/SubgraphGraphiQL.tsx` | GraphiQL against a user-chosen deployment. |

**On chain you get a hash; the meaning lives off chain.** The `subgraph-*` routes and the disassembly
helpers read curation signal and allocations - both on chain and both already declared in
`graph-allocations-nest` - alongside display names, schemas and manifests, which exist only on IPFS.
Nuthatch forbids IPFS at runtime by design. **These are therefore split, not excluded**: the on-chain
half is migration work and stays in the checklists above; the name beside it is not, and never will
be. A route is not "migrated" until it can render an unresolved hash honestly rather than silently
showing nothing.

`/api/ens` is the same shape with a different reason: ENS lives on Ethereum mainnet, which is a
different chain, a different cursor and a different nest. In scope for a future mainnet nest; out of
scope for the Arbitrum ones.

`/api/indexer-qos/[address]` and `lib/ingest/qos.ts` are a genuine boundary case and are **still
counted** as migration work. QoS is gateway telemetry, but it reaches us through a subgraph of an
on-chain oracle, so the data is on chain by construction. The open question is shape rather than
remit - whether the oracle's payload is decodable as events - and until that is answered they stay in
the denominator. See `nuthatch#1083`.

## Supporting work

- [x] Add the legacy Arbitrum staking ABI and event topics to an isolated history nest.
- [x] Finish the legacy backfill, catch it up to tip, and stop it before follow-mode polling.
- [x] Apply the exact timestamp cutoff in Delegation Flows' Nuthatch query and serve the completed history read-only.
- [x] Verify the deployed Delegation Flows route and mark it Live.
- [ ] Define a versioned Nuthatch query contract for every migrated route, including cursor and
      ordering semantics.
- [ ] Keep fixed-block parity fixtures for each route in CI before its production switch.
- [ ] Remove the corresponding Graph client query and Graph API-key requirement only after the route
      is Live.
- [ ] Remove the Graph **Network subgraph** queries and the routes' dependence on them once every
      route in the checklists above is Live. **Not** the Graph client, the environment variables or
      the dependencies: the surfaces under "Intended Graph surfaces" keep needing all three, so
      `GRAPH_API_KEY` remains configured after the migration completes. The defensible goal, per
      `nuthatch#638`, is that the key is no longer load-bearing for Lodestar's own dashboard - not
      that it disappears from the repository.
- [ ] Expose `seal-direct` backfill progress through `/metrics` and the TUI. Tracked in
      [nuthatch#807](https://github.com/nightswatchhq/nuthatch/issues/807).

The final checkbox is intentionally last. Deleting the Graph dependency before the individual data
families are indexed would not be a migration. It would be an outage with excellent intentions.

It is also deliberately narrower than it used to read. The previous wording promised to remove the
Graph client "once every route above is Live", which was unreachable: five of the routes then listed
as planned cannot be served by an indexer at all, so the condition could never be met and the
checklist would have sat permanently one item short with no explanation of why.
