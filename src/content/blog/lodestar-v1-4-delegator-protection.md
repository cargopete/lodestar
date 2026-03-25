---
title: "v1.4: Delegator Protection & Rolling APY"
date: "2026-03-25"
author: "cargopete"
tags: ["release", "delegators", "apy"]
excerpt: "New warnings for 100% reward cut indexers, rolling 30d/90d APY from real allocation data, and a filterable delegation activity feed."
---

## The problem

Delegators keep delegating to dead indexers that take 100% of rewards. The UI gave zero indication that a 100% cut means zero earnings. This came up as [Issue #1](https://github.com/cargopete/lodestar/issues/1) from PaulieB14 — a fair point, and one worth fixing properly.

## What's new

### Greedy indexer warnings

Any indexer with a 100% reward cut is now flagged across the entire UI:

- **Red text and tooltip** on the reward cut column in the indexer table
- **Warning banner** on the indexer detail page explaining that delegating earns 0% APR
- **Portfolio-level warning** on the delegator page if any active position is with a greedy indexer
- **"Earning 0%" badge** on individual positions in the delegator portfolio
- **Risk score penalty** — the cut stability dimension is hard-capped at 5/100 for 100% cut indexers, pulling their composite score down significantly

### Rolling APY (30d / 90d)

We now compute rolling delegator APY from actual closed allocation rewards stored in Supabase, rather than relying solely on instantaneous theoretical APR.

- **APY 30d column** in the indexer table — hover for 90d APY and instantaneous APR comparison
- Annualised from real reward data: `(delegatorRewards / delegatedGRT) × (365 / windowDays)`
- Falls back gracefully to instantaneous APR when historical data isn't available yet

### Delegation activity feed

Matthew Darwin asked for the ability to filter delegation events by indexer. Now you can:

- **Filter by indexer name or address** — type "pinax" or paste an address
- **Delegation feed on every indexer detail page**, pre-filtered
- **Full addresses** and **indexer names** displayed throughout

### Other improvements

- Allocation table paginated (25 per page, was capped at 10)
- Full delegator addresses with clickable links in Top Delegators
- Supabase backend for historical allocation and delegation data

## What's next

We're continuing to build out the historical data layer. With closed allocations in Supabase, we can start tracking APY trends over time, indexer performance history, and delegation flow analytics. More on that soon.
