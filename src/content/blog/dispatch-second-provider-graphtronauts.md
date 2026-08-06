---
title: "Dispatch Has a Second Provider: PaulieB from Graphtronauts"
date: "2026-04-26"
author: "cargopete"
tags: ["dispatch", "rpc", "data-services", "horizon", "indexers", "community"]
category: "News"
excerpt: "A single-provider network is infrastructure theatre. Two providers is where actual decentralisation starts. PaulieB from the Graphtronauts community just provisioned on Dispatch. Here's what that means and why it matters."
---

> **Dispatch is an experimental, unofficial, community-led project.**
>
> It is not affiliated with, endorsed by, or supported in any way by The Graph Foundation or Edge & Node. It is an independent experiment exploring decentralised JSON-RPC on Horizon. Not production-ready. Use accordingly.

There's a specific kind of uncomfortable honesty baked into the [original Dispatch announcement](/blog/dispatch-json-rpc-horizon): "a single-provider network isn't decentralised." We wrote it because it's true, and it was the most glaring limitation of the project at launch. One provider serving all traffic isn't a decentralised network; it's a relay with extra steps.

Today that changes. **PaulieB**, a well-known member of the [Graphtronauts](https://graphtronauts.com) community, has provisioned on the Dispatch `RPCDataService` contract and is serving live traffic on Arbitrum One.

This is the first milestone that matters.

---

## Who is PaulieB, and who are the Graphtronauts?

If you've spent any time in The Graph's Discord or forum, you've almost certainly encountered the Graphtronauts. They're one of the oldest and most active grassroots communities in The Graph ecosystem: a group of long-term GRT holders, builders, and researchers who've followed the protocol through every cycle since the early days.

PaulieB is a prominent voice in that community. He's not running a commercial indexing operation backed by a protocol grant. He's a community member who looked at Dispatch, understood what it was trying to do, and decided to run a provider because he thought it was worth doing. That's the origin story you want for this kind of project.

The fact that the second provider came from the Graphtronauts rather than, say, a foundation-funded team says something meaningful about whether the tooling actually works.

---

## What technically changes with two providers

When Dispatch launched with one provider, the gateway's routing logic had exactly one candidate for every request. There was nothing to score, nothing to race, nothing to fall back to. The QoS system (with its latency EMA, availability tracking, and freshness scoring) was technically operational but practically pointless.

Now it has something to work with.

### Concurrent dispatch kicks in

For most JSON-RPC methods, the gateway uses [concurrent dispatch](/dispatch#how-the-gateway-routes-requests): it selects `k` providers, fires requests at all of them simultaneously, and returns the first valid response. The first response wins; the rest are cancelled.

With one provider, `k=1` and concurrent dispatch is just a regular request. With two providers at `k=2`, the gateway is now actually racing them. Your `eth_blockNumber` goes to both lodestar-indexer.eth and graphadvocate.eth at the same time. Whoever responds first wins. The slower one gets that latency recorded against its QoS score and will receive proportionally less traffic over time.

This is good for consumers immediately: lower p99 latency, because you're getting the best of two concurrent attempts rather than waiting on one.

### Quorum consensus becomes meaningful

For deterministic state methods (`eth_call`, `eth_getLogs`, `eth_getBalance`, `eth_getTransactionReceipt`) the gateway uses quorum dispatch: all `k` providers respond, and the majority result wins.

With one provider, "majority" means whatever one node says, unchallenged. With two, a disagreement between them is detectable and logged. Neither provider can silently return a wrong result without the gateway noticing a mismatch. This isn't full Byzantine fault tolerance at two providers (a true majority requires three), but it's a meaningful step toward honest response verification that simply wasn't possible before.

### Failover becomes real

When lodestar-indexer.eth goes down for maintenance, a restart, or a routing issue, previously all requests failed. Now they fall to PaulieB's provider. The 5% QoS floor weight means even a degraded provider still receives some traffic, which gives it a recovery path without being completely starved of requests.

This is the difference between "the network has downtime" and "the network routes around faults."

---

## What it means for consumers

The practical change is resilience and competitive latency.

Before today, pointing your app at the Dispatch gateway meant trusting that a single server in EU Central was always up and always fast. Any consumer who tried Dispatch was implicitly relying on one person's uptime. That's fine for experimentation; it's not fine as something you'd build on.

Two geographically distributed providers changes the risk profile. Not enough to call it production-ready (we're not going to pretend otherwise) but enough to make it genuinely usable for low-stakes applications, internal tooling, or development environments where Alchemy's rate limits are annoying and the exact 99.999% SLA doesn't matter.

For anyone currently using the [Dispatch gateway endpoint](https://www.lodestar-dashboard.com/dispatch#add-to-wallet): you're now automatically benefiting from this. The gateway's QoS-weighted selection and concurrent dispatch are routing across both providers without any configuration change on your end.

---

## What it means for other indexers

The Graphtronauts are a well-connected community. PaulieB running a Dispatch provider is visible to that audience.

The original Dispatch post identified the core problem clearly: "a single-provider network isn't decentralised." The corollary is that the path from "one provider" to "credibly decentralised" requires other Graph indexers to look at Dispatch, decide it's worth their time, and spin up a `dispatch-service` alongside their existing infrastructure.

The case for doing that is straightforward if you're already an indexer:

- You have GRT staked. The provisioning requirement is 25,000 GRT, a fraction of what most active indexers hold.
- You have Ethereum node infrastructure already running. `dispatch-service` is a sidecar, not a replacement.
- The payment mechanism is GraphTally (TAP v2), the exact same payment primitive the Subgraph network uses for query fees. It's not new territory.

What PaulieB has done, concretely, is walk the path from "I run Graph infrastructure" to "I'm a Dispatch provider" and demonstrate that it works. The documentation, the indexer agent, the Docker compose setup: they were there in theory; they're now validated in practice by a second independent operator.

If you're an indexer who has been watching Dispatch from a distance: the second provider is a reasonable signal that the onboarding experience is real.

---

## What comes next

Two providers is not where this stops. Here's what we're watching:

**More chains.** The RPCDataService supports permissionless chain registration: any provider can add a new chain with a 100,000 GRT bond. Ethereum mainnet is the obvious next addition. As providers join, chain coverage will expand.

**TAP aggregation.** Receipts are being signed per request. The aggregator that batches them into RAVs for on-chain settlement is the next piece. When that's wired up, GRT will actually flow from consumer escrow to providers on-chain in real time.

**Oracle.** The `dispatch-oracle` daemon feeds L1 state roots for Tier 1 slash verification, enabling provable slashing for wrong `eth_getBalance` responses. This is the cryptographic accountability layer that makes a decentralised RPC network meaningfully different from a trusted one.

None of this requires waiting. The contracts are deployed. The code is open source. The payment primitives are proven. What it requires is more people doing what PaulieB did: deciding the experiment is worth participating in.

---

## A note on what this still isn't

Two providers is a milestone, not an arrival.

Dispatch is still experimental. It is not affiliated with The Graph Foundation. It has no SLA. It has no dedicated support. If something breaks, the community fixes it.

What it is: a working proof of concept for decentralised JSON-RPC on Horizon, now with a second independent operator, running real traffic, on real infrastructure, paying real GRT micropayments for real requests.

The progress from "one provider, experimental" to "two providers, experimental" is not hype. It's a second person deciding the thing is worth running.

---

*Want to become a provider? Everything you need is at [github.com/cargopete/dispatch](https://github.com/cargopete/dispatch). Want to use Dispatch as a consumer? Head to [the Dispatch page](/dispatch) and grab a gateway URL; it takes under two minutes.*
