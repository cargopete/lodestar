---
title: "Lodestar Is Now an Indexer"
date: "2026-05-04"
author: "cargopete"
tags: ["lodestar", "indexing", "horizon", "dispatch", "subgraphs", "indexers"]
category: "News"
excerpt: "We've spent months building a dashboard that tracks indexers. Today we became one."
---

We've spent months building a dashboard that tracks indexers. Today we became one.

As of today, **lodestar-indexer.eth** (`0xb43b2cccceada5292732a8c58ae134adefce09bb`) is registered on both the **SubgraphService** and **Dispatch** — the two active data services on The Graph's Horizon protocol.

No subgraphs are being indexed. No allocations are open. The status badge in our own dashboard says "Ineligible." We're aware of the irony.

---

## What we registered on

**SubgraphService** — the original Graph data service, running under Horizon. Indexers provision GRT, open allocations against specific subgraph deployments, serve queries, and earn rewards proportional to their stake and the quality of their work. We have **147,720 GRT provisioned** and nothing allocated yet. That changes once graph-node is running and we've chosen which subgraphs to index.

**Dispatch** — our own experimental JSON-RPC data service, [described here](/blog/dispatch-json-rpc-horizon), serving Arbitrum One. We've been operating the infrastructure since launch. The registration today formalises it properly under HorizonStaking — same 147.72K GRT provision, two data services.

One way to read this: we have skin in the game on both fronts now. If Dispatch has reliability problems, we feel them as a provider rather than just as observers. If SubgraphService reward mechanics shift, we're in the same position as every other indexer watching that in the dashboard.

---

## The dashboard watching itself

lodestar-indexer.eth now has an indexer profile page on Lodestar:

`lodestar-dashboard.com/indexers/0xb43b2cccceada5292732a8c58ae134adefce09bb`

Currently it shows: 147.72K GRT self-stake, 0 delegators, 0 allocations, 0 rewards earned. "No QoS data available." The delegation capacity widget reports 2.36M GRT of headroom that nobody is filling yet.

It's a peculiar thing, building a tool that now monitors you.

---

## What comes next

A few things need to happen before this is an active indexer rather than a registered one.

**Subgraph selection.** We need to decide which deployments to allocate to. The obvious candidates are the subgraphs Lodestar itself depends on — the Graph Network subgraph and the subgraphs we use for protocol data. Starting with what you actually use is the sensible approach.

**The stack.** graph-node, indexer-agent, indexer-service-rs, tap-agent. The architecture is [documented](/blog/graph-node-stack-architecture); running it is a different thing. We'll write about what we encounter.

**Eligibility.** The "Ineligible" badge goes away once allocations are open and POIs are being submitted. The Rewards Eligibility Oracle is watching, as it should be.

On the Dispatch side, the service is already running. What's still being wired up is TAP aggregation — the piece that batches signed receipts into RAVs for on-chain settlement.

---

This is a small stake and a long list of work still ahead. But it's the right kind of commitment — the kind where you're using the thing you're building about.

Updates as the infrastructure comes online.
