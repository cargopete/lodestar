---
title: "Lodestar 3.0.0"
date: "2026-05-19"
author: "cargopete"
tags: ["lodestar", "dashboard", "horizon", "dispatch", "release"]
category: "News"
excerpt: "Lodestar reaches 3.0.0. The dashboard is stable, the team is proud of what we built, and we're being honest about what comes next."
---

Lodestar reaches 3.0.0 today. The dashboard is stable, the team is proud of what we built, and we're being honest about what comes next.

---

## What 3.0.0 Is

This release formalises the state of the dashboard after a period of significant work: a complete leaderboard scoring system with community voting, Horizon-native Dispatch provider tracking, REO status, risk scoring, data service diversity metrics, allocation breadth, delegation retention, and a full suite of indexer profile and subgraph tooling.

It is a stable, working product. The test suite is green. The APIs are cached. The security surface has been audited. The infrastructure holds up.

We're proud of it.

---

## What 3.0.0 Is Not

It is not the beginning of a new feature sprint.

The honest reason is financial. [Stopping the Lodestar indexer](/blog/stopping-the-lodestar-indexer) cost us real money and took real time, and it's one of several decisions we've had to make in the past months about where to put limited resources. The dashboard is open source and self-sustaining operationally — the VPS pays for itself, the Vercel deployment is free-tier — but engineering time is not free.

For now, Lodestar 3.0.0 is the version. We will fix bugs. We will not be taking feature requests or planning new dimensions in the near term.

---

## On the Community Response

The community has been genuinely kind about Lodestar. Indexers use the leaderboard. Delegators use the profiles. Subgraph developers use the deployment views. People have pointed out bugs, suggested improvements, and occasionally told us it's the tool they reach for first when they want to understand what's happening on the network.

That means something. Building things that people actually use in a protocol ecosystem is harder than it looks, and we didn't take it for granted.

---

## Dispatch: Deployed, Working, Waiting

The Dispatch service — JSON-RPC over the Graph's Horizon payment layer — is live. The contracts work. The indexer registry is running. The cost comparisons are published. The [dogfooding post](/blog/dispatch-dogfooding) documented the rough edges we found and fixed.

The problem is adoption, and adoption has a chicken-and-egg structure that we can't resolve unilaterally: without providers there are no consumers, and without consumers there are no providers. We were one of the providers, and we've stepped back from that role. [Graphtronauts joined as a second provider](/blog/dispatch-second-provider-graphtronauts), which is a good sign, but the network is still very thin.

Dispatch is a bet on Horizon's future as a payment layer. Whether that bet pays off is up to the community — specifically, whether indexers choose to provision stake to the Dispatch service and whether developers choose to route RPC traffic through it. We've built the tooling. The rest isn't ours to decide.

---

## Seahorn: Available, Unused

[Seahorn](https://github.com/lodestar-team/seahorn) is a Solana data service built for the Horizon architecture — a working proof of concept that a non-EVM chain can participate in the Graph's data services model. It was built carefully, it was written about, and there doesn't appear to be meaningful interest in it.

That might change if Solana gains traction within the Graph ecosystem. Until then, the repository is public, the code is documented, and it's there for anyone who wants to build on it.

---

## What the Lodestar Team Does Next

We're not going anywhere. The Graph is a protocol we believe in and have spent real time understanding from the inside — as indexers, as dashboard builders, as Dispatch operators. That perspective doesn't disappear because a particular sprint has ended.

If community-driven initiatives emerge — governance processes, working groups, network health discussions, tooling projects — we'll be there. The things we care about on the Graph are the things that require community coordination to work, and those are exactly the kinds of efforts where showing up matters more than having a product roadmap.

Lodestar will keep running. We'll keep watching. And if the network moves in directions where we can contribute meaningfully, we will.

---

*Lodestar is an independent Graph Protocol analytics dashboard. Dashboard: [lodestar-dashboard.com](https://www.lodestar-dashboard.com) — Source: [github.com/lodestar-team/lodestar](https://github.com/lodestar-team/lodestar).*
