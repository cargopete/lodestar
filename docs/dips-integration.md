# DIPS integration

Last checked: 2 September 2026.

Direct Indexer Payments are wired on Arbitrum One and allocated nothing. Every contract is
deployed, every configuration step has been taken, and the indexing-agreement allocation is zero.
The whole thing turns on one governance transaction that nobody can predict the hour of.

That shapes everything below. This is a surface whose subject **has not happened yet**, so every
table that will matter is empty, every query returns no rows, and an empty result is
indistinguishable from a broken one. Absent data rendering as healthy is the failure mode here, not
a slow page.

This document records what Lodestar reads today, what the nest already holds that nothing reads,
and how any of it can be validated before the day it matters.

## Ground truth, measured

Read from the IssuanceAllocator at `0xb64f29b2d81140ffc3a135e319561a1bd03b1a7e` over RPC on
2 September 2026:

```
getIssuancePerBlock : 120.73 GRT/block

target                                       total   allocMint   selfMint
0x28cd…dde1e  DefaultAllocation               0.000      0.000      0.000
0x971b…a525   RewardsManager                 96.584      0.000     96.584
0x2ff0…b16e   InnovationAllocation           24.146     24.146      0.000

sum of per-target total: 120.73 == getIssuancePerBlock
```

Three things follow, and each of them cost something to learn.

**A target's share is `allocatorMintingRate + selfMintingRate`.** The two fields are mechanism, not
amount: the allocator either mints the share and sends it, or the target mints its own. `Allocation`
exposes the sum as `totalAllocationRate`, but `TargetAllocationUpdated` carries only the two parts,
so anything reading the event has to add them back. Reading either field alone is wrong in both
directions: self-only zeroes InnovationAllocation, allocator-only zeroes the RewardsManager.

**The `Allocation` struct has three fields, not two.** `(totalAllocationRate, allocatorMintingRate,
selfMintingRate)`. A two-field ABI decodes without error and returns values shifted by one position,
which is a wrong answer that looks exactly like a right one. Decode against the ABI in
`nightswatchhq/dips-nest/abis/`, never against a reading of the docs.

**The sum is an exact invariant.** Per-target totals equal `getIssuancePerBlock()`. Not
approximately, exactly. That is the cheapest correctness check available on this surface and it is
what caught the bug described below.

## What Lodestar reads today

The configuration surface, and nothing else. `dips-nest` exposes 56 tables; two views are consumed.

| Surface | Source | State |
|---|---|---|
| `GET /api/dips` | `dips_current_allocation`, `dips_timeline` | Live behind `NUTHATCH_DIPS` |
| `DipsStatus` panel | the above | Live on the homepage |
| `check-dips` cron | same two views, read direct | Every 10 minutes |
| Public SQL dataset `dips` | `/dips/sql` | Live |
| Named queries | `dips_agreements` and one other | Live |
| Nest health | `/dips/ready` via `check-nest-health` | Every 15 minutes |

There is deliberately **no subgraph fallback**. Nothing else indexes these three contracts, which is
the entire reason the panel exists, and a fallback would only be a way of inventing numbers. The
cost of that decision is that the surface has no second opinion, which is what the validation
section is about.

### The bug this document was written after

Until 2 September the panel summed self-minted rates alone. Production therefore reported
InnovationAllocation at `0.00` and `0%` while it drew 24.146 GRT/block, a fifth of all issuance, and
put the total at 96.584 against a real 120.73.

The same defect sat in `check-dips`, where it mattered more. `dips_live` is the alert for the single
event this entire workstream waits on. Had governance funded DefaultAllocation through the
allocator-minted field, that alert would never have fired and the dashboard would have gone on
reading **Armed**.

Neither was visible from the dashboard, because both rendered as plausible numbers.

## What the nest holds and nothing reads

The full agreement lifecycle is already indexed. Every table below exists in `dips-nest` today and
every one of them is empty, which is the argument for building against them now rather than in a
hurry on the day they fill.

| Stage | Table | Carries |
|---|---|---|
| Offer | `recurring_collector__offer_stored` | `agreementId`, `payer`, `offerType`, `offerHash` |
| Offer withdrawn | `recurring_collector__offer_cancelled` | `caller`, `agreementId`, `hash` |
| Acceptance | `recurring_collector__agreement_accepted` | `dataService`, `payer`, `serviceProvider`, `endsAt`, `maxInitialTokens`, `maxOngoingTokensPerSecond`, `min`/`maxSecondsPerCollection` |
| Registration | `recurring_agreement_manager__agreement_added` | `agreementId`, `collector`, `dataService`, `provider` |
| Refusal | `recurring_agreement_manager__agreement_rejected` | `agreementId`, `collector`, `reason` (enum) |
| Amendment | `recurring_collector__agreement_updated` | revised terms |
| Reconciliation | `recurring_agreement_manager__agreement_reconciled` | `oldMaxNextClaim`, `newMaxNextClaim` |
| Collection | `recurring_collector__rca_collected` | `collectionId`, `tokens`, `dataServiceCut` |
| Payment | `recurring_collector__payment_collected` | `paymentType`, `payer`, `receiver`, `tokens` |
| Cancellation | `recurring_collector__agreement_canceled` | `canceledBy` |
| Removal | `recurring_agreement_manager__agreement_removed` | `agreementId` |
| Escrow | `recurring_agreement_manager__escrow_funded` / `__escrow_withdrawn` | `provider`, `collector`, `deposited` / `tokens` |
| Signer authority | `recurring_collector__signer_authorized` / `__signer_thawing` / `__signer_revoked` | `authorizer`, `signer` |

`agreement_rejected` deserves particular note: it carries a reason enum, which is the "why did my
agreement not take" signal an indexer will actually want, and it is the sort of thing that is
miserable to reconstruct after the fact.

A per-indexer portfolio keys off `serviceProvider` on the collector tables and `provider` on the
manager tables. No additional indexing is required for it.

## Two corrections to the roadmap's plan

**POI presentation does not belong in this lifecycle.** The roadmap's lifecycle bullet reads
"offer → acceptance → POI presentation → collection → cancellation". POIs are presented to the data
service, not to the RecurringCollector, and no event in any of these three contracts carries one.
`dips-nest` cannot answer that leg at all. It needs either a second nest over the SubgraphService or
the bullet redrawn to stop at what these contracts actually see.

**Configured is not the same as distributed.** The panel currently reports the configured rate.
`IssuanceDistributed` and `IssuanceSelfMintAllowance` are the events that say GRT actually moved. A
rate set but never distributed would read as **Live** with nothing flowing, which is a subtler
version of exactly the failure the panel exists to prevent.

## The Dipper

Not integrated, and it should stay that way. The Dipper is the Foundation's gateway-internal
component under GIP-0081's off-chain MVP. DIPS settles through `RecurringCollector` under GIP-0087,
which is a different path, and `nightswatchhq/weaver` already covers it: it builds, signs and checks
Recurring Collection Agreements with the EIP-712 hashing verified against the deployed contract
rather than against a reading of the spec.

The roadmap's old "Dipper client in the gateway" task is struck through for this reason. Every
remaining mention of the Dipper in this repo is prose.

There is a Vercel project named `dipper` on the account. It serves a 404 and holds nothing.

## Validating a surface whose subject has not happened

Four things, roughly in order of how much they buy.

### 1. A Sepolia nest

The highest-value move, and not yet done. Chain 421614 carries the full contract set, including its
own `DefaultAllocation` and `InnovationAllocation`, and `weaver` has already exercised `accept()`
there in fork tests. A `dips-nest` pointed at Arbitrum Sepolia would produce genuinely non-empty
lifecycle data to build every view and query against.

Without it, every lifecycle view has to be written blind against tables that have never held a row,
and its first contact with real data is the day the numbers matter most.

### 2. Cross-check the nest against the chain

Done, in #33. `/api/cron/check-dips-chain` runs hourly. The allocator answers `getTargets()`, `getTargetAllocation(address)`,
`getTotalAllocation()` and `getIssuancePerBlock()` directly, which is an independent oracle for an
otherwise unopposed surface.

`/ready` catches a nest that has stopped. Nothing catches a nest that is running happily and merely
missed a log, and that failure renders as a plausible number. The invariant above is exact, so the
check is cheap and unambiguous: if the per-target shares stop summing to `getIssuancePerBlock()`, a
log went missing.

Running this by hand once found both the totalling bug and the fact that InnovationAllocation had
arrived on mainnet at all.

### 3. Fixtures for the path that has never executed

Done for `/api/dips` and `check-dips` as of 2 September. This is the only way to test the switch
being flipped, since it cannot be observed. The cases worth holding: the flip arriving on either
minting field, an absent allocation staying distinguishable from a measured zero, an unlabelled new
target still appearing rather than being dropped, and an unready nest producing an error rather than
a confident zero.

### 4. Address-book drift

The labels in `/api/dips` were reconciled against `packages/issuance/addresses.json` in
`graphprotocol/contracts`, chain 42161. That file is the thing to diff against. InnovationAllocation
sat in it, funded, while the roadmap still carried it as "on Sepolia only today", and nothing
noticed because an unlabelled address at a plausible rate looks like noise.

## Work

Ordered by what unblocks what.

- [x] Cross-check cron against the allocator over RPC (#31). Landed in #33 as
      `/api/cron/check-dips-chain`, hourly. Reads `getTargets`, `getTargetAllocation` and
      `getIssuancePerBlock`, compares against `dips_current_allocation` in exact wei, and
      edge-triggers on a signature of the divergence set so a standing one does not become
      wallpaper. A missing target counts as a divergence even at zero, because a zero the nest has
      never recorded is a missed log rather than an empty allocation.
- [ ] `dips-nest` on Arbitrum Sepolia, so the lifecycle views can be written against real rows.
- [ ] Agreement lifecycle view, from the tables above. Redraw the roadmap bullet to drop the POI
      leg, or scope a second nest for it.
- [ ] Per-indexer agreement portfolio, keyed on `serviceProvider`.
- [ ] Distinguish configured from distributed issuance using `IssuanceDistributed` and
      `IssuanceSelfMintAllowance`.
- [ ] Alert on a new allocation *target*, not only a new rate. `target_allocation_set` does fire for
      one, but nothing has ever tested that path and InnovationAllocation went unremarked.

## Related

- `docs/catalyst-community-roadmap.md`, CAT-1, for how this fits the wider workstream.
- `docs/nuthatch-migration.md` for the nest-down policy these routes inherit.
- [nightswatchhq/dips-nest](https://github.com/nightswatchhq/dips-nest) for the schema and views.
- [nightswatchhq/weaver](https://github.com/nightswatchhq/weaver) for the agreement tooling.
