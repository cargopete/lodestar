# On-Chain Indexing Agreements Tracker

**Status:** UNPARKED 2026-08-28 — the whole DIPS contract stack is live on Arbitrum One
**Priority:** #2 in Horizon top-5
**Was parked:** 2026-03-22, on the trigger "revisit when RecurringAgreementManager appears on
Arbitrum Sepolia testnet". It appeared on Sepolia *and* on mainnet, and the trigger went unchecked
for five months. Set calendar reminders on parked triggers, not just prose ones.

Delivery tracking for this work now lives in [`../docs/catalyst-community-roadmap.md`](../docs/catalyst-community-roadmap.md)
under CAT-1. This file stays as the protocol-state reference.

## Why this matters

GIP-0087/0088 is the biggest structural change to protocol economics since launch. A new
marketplace layer (offers, acceptances, POI presentations, escrow, payments) plus the Issuance
Allocator redirecting ~5% of GRT issuance (~6 GRT/block) from the Rewards Manager to fund on-chain
agreements. First tool to surface this data gets a durable moat.

That moat is still unclaimed, and the window is now, because the rails are live and switched off.
When the allocation moves off zero, whoever is already indexing these contracts shows it happening;
everyone else reads about it in a forum post the next morning.

## Verified deployment state (2026-08-28)

Source: `graphprotocol/contracts` `packages/issuance/addresses.json` and
`packages/horizon/addresses.json`, each address then confirmed to hold bytecode via `eth_getCode`
on Arbitrum One, and the allocator's configuration read live with `cast call`.

### Live on Arbitrum One (42161)

| Contract | Address |
|---|---|
| IssuanceAllocator | `0xb64f29b2d81140ffc3a135e319561a1bd03b1a7e` |
| RecurringAgreementManager | `0x51f860b03dee6a6ea27392dcceccd908204149f2` |
| RecurringCollector | `0xff0dc7310fbfbcc2524dae230cd4f34727eb84ee` |
| DefaultAllocation | `0x28cd50e9e02856908f4c1966ab035b1f6c4dde1e` |
| ReclaimedRewards | `0xe26cdc4ef915d12551ea67a7cbb838e91a24bb37` |
| RewardsEligibilityOracleA | `0x02753bae61c08abd4351bce7f48524935c2cc78e` |
| RewardsEligibilityOracleB | `0xeebc4919a239c1315a7e0652e692812719bad591` |
| NetworkOperator | `0xae656A0aa51cd465B7506F98F2e8FBb82aa79894` |
| InnovationOperator | `0x7700d56D2cFAFa620048633B2586b063eCD93dd1` |

All are transparent proxies except the operators. `InnovationAllocation` exists on Sepolia
(`0x747f9083a4867314e2c6e16f77c1e814d4c9055c`) but **not yet in the mainnet address book**, which is
the thing to watch as GIP-0089 goes live on 2026-08-31.

### The allocator is wired, and set to zero

```
getIssuancePerBlock()   120.73 GRT/block
getTotalAllocation()    total 120.73 · allocator-minting 0 · self-minting 120.73
getTargets()            [DefaultAllocation, RewardsManager]

  RewardsManager     (0x971B…)  →  120.73 GRT/block   (100%)
  DefaultAllocation  (0x28cd…)  →  0                  (0%)
```

`RewardsManager.issuancePerBlock()` independently confirms 120.73, so nothing has been redirected
yet. **The GIP-0088 split is a parameter change, not a deployment.** The contracts are on mainnet,
configured, and distributing; the only thing standing between today and DIPS-funded indexing is
governance moving a number off zero.

This supersedes the March note ("NOT deployed anywhere") entirely, and it is more advanced than
the Foundation's public "DIPS plumbing is deployed and ready to enable" implies, because the
allocator has real targets and a live distribution state.

## Build plan

### Phase 1: DIPS observability — BUILDABLE AND UNBLOCKED (in progress)

A `dips-nest` (nuthatch) indexing the three contracts on Arbitrum One, feeding a Lodestar panel.
No dependency on gib's payment loop, no dependency on the Foundation. See CAT-1 in the Catalyst
tracker.

- [ ] `dips-nest`: index IssuanceAllocator, RecurringAgreementManager, RecurringCollector
- [ ] Allocation-split panel: current split, targets, the moment it moves off zero
- [ ] Agreement lifecycle: offer → acceptance → POI presentation → collection → cancellation
- [ ] Per-indexer agreement portfolio: active agreements, revenue, compliance
- [ ] Alerting on the split changing, because that is the starting gun

### Phase 2: Payment pipeline dashboard (buildable, partly done)

Surface the live Horizon payment infrastructure that nobody else shows: escrow balances per
payer/receiver pair, TAP/GraphTally collection events and RAV redemptions, payment flow between
gateways and indexers, escrow health (thawing alerts, low balance warnings).

### Phase 3: Participate, not just observe (blocked on CAT-2)

Creating and funding agreements from a gateway. Needs gib's payment loop closed first.

## Foundation-layer addresses (Arbitrum One)

| Contract | Address |
|----------|---------|
| PaymentsEscrow | `0xf6Fcc27aAf1fcD8B254498c9794451d82afC673E` |
| GraphTallyCollector | `0x8f69F5C07477Ac46FBc491B1E6D91E2bb0111A9e` |
| GraphPayments | `0x7Aae8ae011927BC36Cb4d0d3e81f2E6E30daE06D` |
| RewardsManager | `0x971B9d3d0Ae3ECa029CAB5eA1fB0F72c85e6a525` |
| HorizonStaking | `0x00669A4CF01450B64E8A2A20E9b1FCB71E61eF03` |
| L2GNS | `0xec9A7fb6CbC2E41926127929c2dcE6e9c5D33Bec` |

## Key GIP references

- GIP-0087: On-Chain Indexing Agreements (forum.thegraph.com/t/6869)
- GIP-0088: Issuance Allocator Deployment and Configuration (same thread)
- GIP-0076: Issuance Allocator Contract (forum.thegraph.com/t/6867)
- GIP-0081: Indexing Payments model (prerequisite, off-chain Dipper MVP)
- GIP-0066: PaymentsEscrow (deployed, live)
- GIP-0068: SubgraphService (deployed, live)

## Decision log

- **2026-08-28:** Unparked. Every contract the March note listed as undeployed is live on Arbitrum
  One with bytecode confirmed. The allocator is configured with two targets and is distributing,
  but DefaultAllocation's rate is zero, so 100% of issuance still reaches the Rewards Manager.
  Phase 1 starts now. Also: PRs #1217 and #1301 in `graphprotocol/contracts` show as closed rather
  than merged, yet `RecurringCollector.sol` and `RecurringAgreementManager` are both on main and
  deployed, so the work landed by another route. Do not read PR state as deployment state.
- 2026-03-22: Parked. Contracts not deployed, GIPs in draft. Phase 1 (payment pipeline) is
  buildable independently and worth doing as a standalone feature. Revisit monthly or when testnet
  deployment spotted.
