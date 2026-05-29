# [RFC] Sync Bounties: a trustless, market-based replacement for the Upgrade Indexer

## TL;DR

The Upgrade Indexer is a centralization crutch. It exists to solve exactly one problem — getting at least one indexer onto a fresh deployment before signal and rewards make it worth anyone's while — and it solves that problem the least decentralized way possible: a single, subsidized operator the whole long tail depends on.

Cold-start is a market failure, and markets have a standard fix: **let the party who wants the subgraph indexed pay for it directly.** I've built and deployed a contract that does this trustlessly on Arbitrum One — **BountyBoard** ([`0x1A922c7003D441e537EAE24b5AA0530EE274915F`](https://arbiscan.io/address/0x1A922c7003D441e537EAE24b5AA0530EE274915F)) — and a working reference implementation in Lodestar. This post argues we should treat it as the successor to the Upgrade Indexer, and asks you to pick it apart.

## The problem: a subsidy wearing a decentralization costume

The Upgrade Indexer quietly underwrites availability for the long tail of subgraphs that don't yet have enough signal to attract a regular indexer. Useful, yes. But look at what it actually is:

- **A single point of failure.** Availability of thousands of long-tail subgraphs depends on one operator's uptime and one operator's wallet.
- **A subsidy that distorts the fee market.** "Free" baseline service is not free; it's paid for by the protocol rather than by the party who benefits. That muddies every price signal downstream.
- **A permissioned bottleneck** in a network whose entire thesis is permissionlessness.

We tolerate it because cold-start is real. But a crutch you never put down is just a leg you've stopped using.

## The proposal: Sync Bounties

A developer who wants their deployment indexed posts a GRT bounty, escrowed in a contract. **Any** indexer can claim it — but only by actually doing the work, proven on-chain.

The contract (live on Arbitrum One — [`0x1A922c7003D441e537EAE24b5AA0530EE274915F`](https://arbiscan.io/address/0x1A922c7003D441e537EAE24b5AA0530EE274915F)) is small and boring on purpose:

**`post(deploymentId, amount, expiresAt)`**
- Escrows `amount` GRT (developer approves first).
- Optional expiry; if set, must be ≥72h out.

**`claim(bountyId, allocationId)`** — the whole pitch lives here. It reverts unless **all** of the following are true on-chain, read from the SubgraphService:
- `state.indexer == msg.sender` — you own the allocation you're claiming with.
- `state.subgraphDeploymentId == bounty.deploymentId` — right deployment.
- `state.closedAt == 0` — allocation is open.
- `state.lastPOIPresentedAt > bounty.postedAt` — you presented a **fresh** POI *after* the bounty was posted. No recycling old work.

First valid claimer is paid the full amount immediately. No oracle, no admin, no off-chain trust.

**`cancel(bountyId)`** — developer can reclaim funds, but **only after a 72h lock**, so they can't rug an indexer mid-sync.
**`refundExpired(bountyId)`** — anyone can return an expired, unclaimed bounty to the developer.

Querying the result reuses existing rails: resolve the winner on-chain, attach a TAP v2 receipt, proxy the query to the winning indexer. Lodestar already does this end to end.

## Why this beats a subsidized operator

| | Upgrade Indexer | Sync Bounties |
|---|---|---|
| Operators | 1 | N, permissionless |
| Who pays | Protocol (everyone) | The beneficiary (developer) |
| Trust model | Trust the operator | Trustless, verified on-chain |
| Price of availability | Hidden in a subsidy | Discovered by the market |
| Failure mode | Single point of failure | One indexer drops, repost the bounty |

The incentive alignment is the point: **the person who wants the subgraph indexed is the person who pays for it**, and competing indexers reveal what that availability actually costs per deployment instead of the protocol eating an undifferentiated subsidy.

## Reference implementation: Lodestar

This isn't a thought experiment. It's live:

- Contract deployed on Arbitrum One: [`0x1A922c7003D441e537EAE24b5AA0530EE274915F`](https://arbiscan.io/address/0x1A922c7003D441e537EAE24b5AA0530EE274915F)
- Developer flow: post a bounty against a deployment in a few clicks — https://lodestar-dashboard.com/dock
- Indexer flow: sync → present POI → claim, with both on-chain checks shown green before the button enables — https://lodestar-dashboard.com/blog/sync-bounty-indexer-guide
- A reconcile cron keeps the off-chain cache honest against the contract (the chain is the source of truth; the DB is only for rendering).

Come kick the tyres and try to break it.

## Open questions (where I want you to push back)

I'd rather pre-empt the obvious objections than have them land as gotchas:

1. **One-shot vs ongoing service.** A bounty pays for *initial sync*, not a perpetual SLA. Ongoing serving still relies on query fees + indexing rewards via signal. I'd argue that's the *correct* division of labour — bounties solve cold-start, the existing fee/reward market sustains what's actually used — but is there a class of subgraph that needs subsidized perpetual availability and genuinely can't get it this way?
2. **The truly-zero-demand long tail.** Some subgraphs nobody will pay even a token bounty for. Is "no one will pay" a legitimate signal that the network shouldn't spend resources on it — or is there a public-good argument for keeping a backstop?
3. **Latency.** The Upgrade Indexer is automatic and instant. A bounty needs to be posted and noticed. How much does first-index latency actually matter in practice, and can a notification/auto-post layer close the gap?
4. **Gaming the POI check.** The contract requires a fresh POI from an open allocation you own. Are there edge cases — POI freshness windows, allocation churn — that a motivated indexer could exploit to claim without real, useful sync?
5. **Protocol-native or app-layer?** Should this graduate into a GIP and live closer to the protocol, or stay a permissionless convention that any UI can implement against a shared contract?

## Ask

If you run an indexer: would you watch a bounty board and claim these? What bounty size moves you?
If you publish subgraphs: would you rather post a small bounty than wait on a subsidized backstop?
If you work on protocol economics: where does this break?

Tear it apart. If it survives, I think we can retire the crutch.
