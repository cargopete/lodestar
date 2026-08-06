---
title: "We're Stopping the Lodestar Indexer"
date: "2026-05-17"
author: "cargopete"
tags: ["lodestar", "indexing", "horizon", "infrastructure", "indexers"]
category: "News"
excerpt: "We registered lodestar-indexer.eth two weeks ago. We're shutting it down. Here's the honest accounting."
---

We registered lodestar-indexer.eth two weeks ago. We're shutting it down. Here's the honest accounting.

---

## The Numbers Didn't Work

Running a Graph Protocol indexer at small scale in 2026 is not economically viable. We knew this going in; the [post announcing the registration](/blog/lodestar-is-now-an-indexer) didn't pretend otherwise. But knowing something intellectually and watching it play out in a spreadsheet are different things.

The costs are fixed regardless of allocation size:

- **VPS** (Hetzner, 16 vCPU / 64 GB RAM / 2 TB NVMe): €89/month
- **Chainstack archive nodes** (Arbitrum + Base): $200/month
- **graph-node storage**: ~800 GB provisioned, growing
- **Operator time**: non-trivial

The rewards are proportional to stake. Our **147,720 GRT** self-stake is a rounding error against the network's ~2.8 billion GRT total supply and the allocation pools on any meaningful subgraph. The reward arithmetic is unambiguous: at current GRT price and indexing reward rates, monthly earnings at our stake size cover roughly 12% of infrastructure costs. That's before accounting for the unbonding thaw period, which locks capital for 28 days every time you reallocate.

We'd need to be roughly 8–10x larger in stake to break even on infra alone, before valuing time. That's a different financial commitment than we're prepared to make right now.

---

## What's Happening to the GRT

The 147,720 GRT provisioned to both SubgraphService and Dispatch will be deprovisionned and returned to the operator wallet after the standard thaw period. No stake is being slashed: no allocations were open long enough to generate disputes, and no incorrect POIs were submitted (no POIs were submitted at all, in the end).

Timeline:
- Allocations closed: today
- Provision thaw: 28 days
- GRT returned to wallet: mid-June

The GRT stays in the protocol's control during thaw. Nothing exotic happens.

---

## What This Isn't

It's not a statement about The Graph protocol. The indexing economics are deliberately designed to reward large, committed operators, and that's a reasonable design choice for a network that needs reliable, high-uptime infrastructure. We're not the right shape for that right now.

It's not the end of Lodestar. The dashboard continues. We built it because we wanted better tooling for understanding the network as participants; that motivation doesn't disappear because we're stepping back from one mode of participation.

It's not the end of Dispatch either, though that's a separate decision being made separately. Dispatch's economics are different: the marginal cost of serving an RPC request over already-paid-for Chainstack nodes is low, and we have an existing user base. More on that soon.

---

## What We Learned Running It

Two weeks of operating a live indexer (even an idle one) taught us things that months of dashboard-building didn't.

The tap-agent / indexer-agent / indexer-service-rs stack is genuinely complex to operate. Not broken, but complex. The interaction between thaw periods, allocation close timing, and POI submission windows requires careful attention. If your operator scripts aren't right, you don't get slashed immediately; you just silently earn nothing, which is almost worse.

The [Dispatch dogfooding post](/blog/dispatch-dogfooding) documented four bugs we found by pointing real indexer traffic at the system. Those bugs were worth finding. The infrastructure for finding them cost roughly €180 and three weeks of attention. That's a reasonable price for production validation of a system we care about.

We'd do it again. Just not at ongoing monthly cost.

---

## An Honest Retrospective

The announcement post said: *"This is a small stake and a long list of work still ahead."*

That was accurate. The work ahead turned out to be longer than the financial runway we'd set aside for it. The right response to that is to stop clearly, document what happened, and move on, rather than keep paying for infrastructure that isn't earning its keep on the hope that something changes.

The dashboard page for lodestar-indexer.eth (`0xb43b2cccceada5292732a8c58ae134adefce09bb`) will continue to show the historical record. At some point it will show: stake returned, allocations zero, rewards earned: a small number. That's an accurate record of a brief, instructive experiment.

We'll keep building Lodestar. Just not as an indexer.

---

*Lodestar is an independent Graph Protocol analytics dashboard. Dashboard: [lodestar-dashboard.com](https://www.lodestar-dashboard.com).*
