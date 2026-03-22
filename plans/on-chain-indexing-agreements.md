# On-Chain Indexing Agreements Tracker

**Status:** Parked — GIP-0087/0088 contracts not deployed (draft since 2026-03-06)
**Priority:** #2 in Horizon top-5
**Revisit when:** RecurringAgreementManager appears on Arbitrum Sepolia testnet

## Why this matters

GIP-0087/0088 is the biggest structural change to protocol economics since launch. A new marketplace layer (offers, acceptances, POI presentations, escrow, payments) plus the Issuance Allocator redirecting ~5% of GRT issuance (~6 GRT/block) from the Rewards Manager to fund on-chain agreements. First tool to surface this data gets a durable moat.

## Current deployment state (as of 2026-03-22)

### NOT deployed (anywhere)
- `RecurringAgreementManager` — manages agreement lifecycles, receives minted GRT
- `IssuanceAllocator` — splits issuance between RewardsManager and agreement funding
- `RecurringCollector` — collects payments for recurring agreements

### Code status (graphprotocol/contracts repo)
- IssuanceAllocator: merged to main (PRs #1257, #1280), audited, deployment scripts exist
- RecurringCollector / Indexing Payments (PR #1217): audited, still open PR
- RecurringAgreementManager (PR #1301): under audit review as of 2026-03-10

### Deployed and live on Arbitrum One (foundation layer)
| Contract | Address |
|----------|---------|
| PaymentsEscrow | `0xf6Fcc27aAf1fcD8B254498c9794451d82afC673E` |
| GraphTallyCollector | `0x8f69F5C07477Ac46FBc491B1E6D91E2bb0111A9e` |
| GraphPayments | `0x7Aae8ae011927BC36Cb4d0d3e81f2E6E30daE06D` |
| RewardsManager | `0x971B9d3d0Ae3ECa029CAB5eA1fB0F72c85e6a525` |

### Subgraph entities available now
- `PaymentsEscrowAccount` (payer, collector, receiver, balance, thawing)
- `PaymentsEscrowTransaction` (hash, type, amount, payer, collector, receiver)
- `GraphTallyTokensCollected` (collector, payer, receiver, collection ID)

## Phased build plan

### Phase 1: Payment pipeline dashboard (buildable NOW)
Surface the live Horizon payment infrastructure that nobody else shows:
- Escrow balances per payer/receiver pair
- TAP/GraphTally collection events and RAV redemptions
- Payment flow visualisation between gateways and indexers
- Escrow health monitoring (thawing alerts, low balance warnings)

This is real data, actively managed by indexers with zero dashboard visibility.

### Phase 2: Agreements data model + scaffolding (build when contracts hit testnet)
- Types: `IndexingAgreement`, `AgreementOffer`, `AgreementAcceptance`
- API routes: `/api/agreements`, `/api/agreements/[id]`
- Hooks: `useAgreements()`, `useAgreementDetail()`
- UI: agreement lifecycle cards, offer/acceptance flow, status timeline

### Phase 3: Full agreements tracker (build when contracts hit mainnet)
- Agreement marketplace: browse offers, acceptance rates, pricing data
- Agreement lifecycle: offer -> acceptance -> POI presentations -> payment -> cancellation
- Escrow integration: link agreement payments to escrow balances
- Issuance flow: show how GRT issuance splits between RewardsManager and agreements
- Per-indexer agreement portfolio: active agreements, revenue, compliance

## Key GIP references
- GIP-0087: On-Chain Indexing Agreements (forum.thegraph.com/t/6869)
- GIP-0088: Issuance Allocator Deployment and Configuration (same thread)
- GIP-0076: Issuance Allocator Contract (forum.thegraph.com/t/6867)
- GIP-0081: Indexing Payments model (prerequisite)
- GIP-0066: PaymentsEscrow (deployed, live)
- GIP-0068: SubgraphService (deployed, live)

## Realistic timeline
- Q2-Q3 2026: "DIPs Subgraph Service" — indexing agreements system deployment
- Q3-Q4 2026: DIPs Amp Service, network-first chain integrations

## Decision log
- 2026-03-22: Parked. Contracts not deployed, GIPs in draft. Phase 1 (payment pipeline) is buildable independently and worth doing as a standalone feature. Revisit monthly or when testnet deployment spotted.
