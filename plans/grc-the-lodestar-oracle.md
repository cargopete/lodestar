# GRC-XXX: The Lodestar Oracle

**Status:** draft for comment
**Author:** petko (Lodestar / The Night's Watch)
**Supersedes in practice:** the V1 Gateway QoS Oracle pipeline for consumers who need it to work
**Builds on:** [GRC-002: QoS Oracle V2](https://forum.thegraph.com/t/grc-002-qos-oracle-v2/5756)

## Abstract

An independent quality-of-service oracle for The Graph that has no operational dependency on any
single team. It produces its own measurements, publishes them as **events** on Arbitrum rather than
as IPFS pointers, and is indexed by a nuthatch nest that anyone can run to reproduce the same numbers
byte for byte.

The design goal is narrow and specific: **no component in the read path can fail silently.** The
current oracle failed silently for 34 days and nobody could tell, which is the actual problem worth
solving.

## Motivation

The V1 QoS oracle has two failure modes. Only one of them is visible.

**The visible one.** The publisher stops posting. It did this on 2026-07-29 for ~38 hours and again
from 2026-08-04 00:00 UTC for 37+ hours. On both occasions the relayer was demonstrably healthy —
funded, no failed transactions, contiguous nonces — so nothing on-chain indicated a fault. It also
resumed from tip without backfilling: the last pre-stall bucket was `07-29 00:25` and the first
post-recovery bucket was `07-30 14:45`, leaving a permanent hole that reads as a quiet period.

**The invisible one, and the reason for this document.** Since **2026-07-01** the oracle's subgraph
has rejected *every* message the publisher sends:

```
valid: false
errorMessage: "0x8cbbe43f97f80efa6ba0a95f3d544e03f84db0ce is not a valid submitter."
```

That address is the publisher. The subgraph is synced to chain tip and reports
`hasIndexingErrors: false`. Its newest `OracleMessage` is from 2026-08-04; its newest
`MessageDataPoint` is from **2026-07-01 03:20**. For over a month the posts kept arriving and none of
them became data, and every consumer received July figures with no indication they were stale.

A feed that answers queries with month-old data, while reporting itself healthy, is worse than one
that returns an error. This is the failure class the design below is built to make impossible.

### The data was never unavailable

Worth stating plainly, because it changes what needs building: the CIDs are in DataEdge calldata on
Gnosis, permanently, and the payloads are pinned and fetchable from public IPFS today. A payload
pulled from inside the gap (2026-07-04) returned a 1.86 MB JSON array of 2,741 per-allocation records
containing every field the subgraph would have materialised.

Nothing was lost. It was **undecoded**, because there is exactly one sanctioned decoder and it
silently stopped accepting input.

## Prior art: GRC-002

GRC-002 (April 2024) identified the same structural problem and proposed the right shape: a
standalone Rust oracle run inside each gateway's stack, each operator publishing their own QoS, with
a canonical subgraph aggregating over a curated list of gateways. It reached consensus on breaking
backward compatibility.

`graphops/qos-oracle-v2` was created in June 2024. `main` contains two commits and empty `oracle/`
and `subgraph/` directories. There is exploratory work on branches (a ClickHouse approach), but
nothing shipped. Two years later V1 died quietly for a month.

This proposal is not a competing design. It is GRC-002's architecture, with two changes forced by
what actually broke, and an implementation that already substantially exists.

## Design goals

1. **No silent failure anywhere in the read path.** Every stage publishes its own liveness and its
   own data age, and they are different questions.
2. **No permissioned component.** Nothing that can reject a valid producer.
3. **Reproducible by third parties.** Anyone can run the indexer and derive identical numbers.
4. **Degrades visibly, never invisibly.** Absent data reads as absent, never as zero or as healthy.

## Architecture

Four stages, each independently verifiable.

```
producers ──► publisher ──► Arbitrum (events) ──► nuthatch nest ──► SQL / MCP / API
```

### Stage 1: producers

Two independent sources, which answer different questions and neither of which depends on E&N.

**Active probing (quality).** Block-pinned GraphQL probes dispatched directly to indexers, paid with
TAP receipts. Yields success rate, latency distribution, chainhead lag, and — uniquely —
**correctness**, by JCS-canonicalising responses (RFC 8785), hashing, and clustering: an indexer in
the minority cluster returned confident, well-formed wrong data. A 200-counting oracle cannot produce
this signal at all.

**On-chain settlement (economics).** TAP RAV redemptions on Arbitrum are public. They give realised
query fees per indexer per collection, from the chain, with nobody self-reporting. This is the half
that probing cannot produce.

Optionally, a third: any gateway operator running this stack contributes traffic-derived metrics for
queries they actually served, exactly as GRC-002 intended. `gateway_id` already exists on every entity
in the V1 schema; the format was designed for several publishers from the start.

### Stage 2: publisher — events, not IPFS pointers

**This is the one substantive departure from V1, and it is the fix.**

V1 posts a CID to a calldata-only DataEdge, and the payload lives on IPFS. That creates three
independent failure points in the read path — the pin, the fetch, and the single decoder that
resolves them — and it is why an indexer cannot verify the data without trusting somebody's
subgraph deployment.

The Lodestar Oracle emits the **summary figures themselves as event fields**, one event per
(indexer, deployment, day). No CID, no IPFS, nothing to resolve. Full 5-minute detail stays off-chain
where it belongs — on-chain data should be the verifiable summary, not the raw firehose.

Concretely: ~5,600 live allocations means ~5,600 events per day on Arbitrum. Gas at that volume is
negligible relative to what the data is worth, though see Open Questions — this figure has not been
measured, only estimated.

### Stage 3: indexing — the nuthatch nest

A [nuthatch](https://github.com/nightswatchhq/nuthatch) nest over the publisher contract. This works
**today, with no new capability**, precisely because the publisher emits events rather than calldata.

For the record, since it is the reason for the design choice above: nuthatch cannot index the V1
DataEdge. Verified at HEAD (`1185c4d`), `src/indexer.rs` refuses any nest configured for extraction —
*"needs an extraction source, and none is wired yet"* — because call traces require a colocated node,
and there is deliberately no `debug_*` RPC path. Nor does it resolve IPFS. A calldata-plus-IPFS
publication format is therefore unindexable by an ordinary self-hosted indexer, which is a good
argument that it was the wrong format for a public good.

What the nest gives: a single binary, no Postgres or Docker required, SQL over the data, an MCP
server for agents, and content-addressed sealed segments so two operators can prove they derived the
same history. Anyone verifying our numbers runs `nuthatch init <contract>` and compares.

### Stage 4: serving

Three surfaces, all already built and running:

- **REST** for the common queries, no API key
- **GraphQL** mirroring the V1 oracle's exact entity and field names, so existing consumers
  (indexer-tools, dashboards, ingest jobs) change a URL and nothing else
- **SQL / MCP** direct from the nest, for anyone self-hosting

## Anti-silent-failure requirements

Normative. An implementation that omits these has not solved the problem this document exists for.

1. Every response carries the **age of the data**, not the age of the sync. These differ, and
   conflating them is exactly how a 34-day outage hid.
2. Every response carries the **liveness of the publisher**, read from the chain it publishes to,
   never from the indexer's own view.
3. Every response carries whether the **indexer is accepting** the publisher's messages. Synced,
   error-free and rejecting everything is a real state and must be reportable.
4. Absent data is `null`, never `0`. "Not measured" and "measured as zero" are different facts.
5. Staleness thresholds derive from each source's **configured cadence**, not a constant.

Those five exist because we got each of them wrong first, shipped it, and had to correct it in public.

## What this replaces, and what it honestly does not

**Fully replaces:** indexer quality measurement. Success rate, latency (including percentiles, which
V1 does not publish), chainhead freshness, and correctness — which V1 cannot measure by construction.
Probe-dispatched measurement is unbiased in a way V1 is not, because the measurer chooses which
indexer answers.

**Replaces with a different basis:** economics. Realised query fees come from on-chain TAP settlement
rather than gateway self-report. Arguably stronger evidence; definitely different, and consumers must
be told which they are reading.

**Does not replace:** organic demand as observed by a specific gateway — how many queries E&N's
gateway routed to whom, and its resulting served-share. That is a property of their gateway's traffic
and cannot be derived by anyone who did not serve those queries. Under GRC-002's model that is not a
gap in the design; it is why the schema carries `gateway_id`, and why the answer is each gateway
publishing its own rather than one gateway publishing for everybody.

**A claim not to make:** that a probe-based feed measures user experience. It measures capability.
The distinction should be stated wherever the numbers are shown.

## Permissionless by construction — verified

The critical question for any independent producer is whether indexers will accept payment from an
unknown payer. Read from `indexer-rs` (`crates/service/src/tap.rs`), the validation pipeline is:

```
1.  AllocationEligible      allocation/collection exists and is active
2.  AllocationRedeemedCheck not closed/redeemed
3.  SenderBalanceCheck      sender has escrow balance > 0
4.  TimestampCheck          within acceptable bounds
5.  DenyListCheck           rejects DENIED senders
6.  ReceiptMaxValueCheck    caps value
7.  MinimumValue            meets the indexer's cost model
8.  ServiceProviderCheck    service provider matches the indexer
9.  PayerCheck              validates payer field (V2)
10. DataServiceCheck        receipt's data_service matches an allowed SubgraphService
```

**There is no sender allowlist.** It is a *denylist* (`tap_horizon_denylist`), and admission is a
non-zero escrow balance. Any party can fund escrow and pay any indexer without permission from
anyone. This is the property that makes an independent oracle possible at all, and it is worth
protecting in future protocol changes.

## Costs

Query fees, computed from the oracle's own published figures: **0.00073 GRT per query**
(weighted mean over the mirrored dataset; median 0.00054).

| Coverage | Cadence | Queries/day | Cost |
|---|---|---|---|
| Top 200 allocations | 15 min | 19,200 | ~14 GRT/day |
| All ~5,600 allocations | 6 h | 22,400 | ~16 GRT/day |
| All ~5,600 allocations | hourly | 134,400 | ~98 GRT/day |

Coverage and cadence are the two dials. The first two rows are cheap enough that a single operator
can fund them, which is the point: an oracle nobody has to be paid to run.

## Implementation status

Not a proposal for work that has not started.

**Running in production today** at https://www.lodestar-dashboard.com/qos — bucketed aggregation in
the V1 schema, GraphQL compatible with the oracle subgraph's entity and field names, REST, publisher
liveness read from Gnosis, subgraph-acceptance monitoring, staleness alerting to Discord, and a
mirror of the canonical history.

**Built and unpaid:** probe dispatch. Currently routed through E&N's gateway, which biases success
rate upward and starves correctness of corroboration. Direct dispatch needs only the TAP receipt
attached, and the signing machinery exists in [gib](https://github.com/nightswatchhq/gib).

**Not built:** the publisher contract, the nest, and one funded escrow.

## Adoption path

1. Fund escrow. Prove one paid query end to end to one indexer. This is the only unproven step.
2. Switch probe dispatch to direct. Success rate becomes unbiased; correctness coverage becomes real.
3. Deploy the publisher contract. Emit daily summaries as events.
4. Publish the nest definition so anyone can index it and check our arithmetic.
5. Invite other gateway operators to publish under their own `gateway_id`, per GRC-002.

Steps 1 and 2 deliver a working independent quality feed on their own. Steps 3 to 5 make it a public
good rather than one operator's dashboard.

## Open questions

- Measured Arbitrum gas for ~5,600 events/day. Estimated as negligible; not measured.
- Whether the V1 rejection is a rotated key, a changed allowlist, or a redeployment. The error names
  the submitter, but the mechanism is not public — which is itself an argument for auditability.
- Whether `juanmardefago/gateway-qos-oracle-example-subgraph` matches the deployed
  `Dtr9rETvwokot4BSXaD5tECanXfqfJKcvHuaaEgPDD2D`. Cannot be confirmed externally.
- Event schema versioning across breaking changes.
- Whether a curated publisher list should exist at all, given that it is the mechanism that failed.

## Appendix: reproducing the evidence

Everything above is checkable without special access.

**Publisher liveness** — read the DataEdge on Gnosis directly, decode the calldata (plain ASCII JSON,
`{topic, hash, timestamp}`), no subgraph and no API key required:
`0x5b4293b4c0f36cb5d4448950830bc777759b6c4f`

**Subgraph acceptance** — query the oracle subgraph for the newest `OracleMessage` and read `valid`
and `errorMessage`. If `valid` is false, no data is being produced regardless of sync status.

**Data age** — newest `dayNumber` against now. This is the check that catches everything, and the one
nobody had.

**Payload availability** — take any CID from DataEdge calldata and fetch it from a public IPFS
gateway.

---

*Written after a week spent finding out how the current one fails. Every figure here was verified
first-hand; where something was estimated rather than measured, it says so.*
