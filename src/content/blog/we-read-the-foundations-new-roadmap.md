---
title: "We Read the Foundation's New Roadmap. Anyway, Here's Our GitHub"
date: "2026-08-28"
author: "nightswatchhq"
tags: ["the-graph", "roadmap", "catalyst", "community", "data-services"]
category: "Ecosystem"
excerpt: "A completely humble review of Project Catalyst, in which we discover that the community accidentally pre-built most of it."
---

Last week the Foundation published its new mandate, and this week's Indexer Office Hours walked us through **Project Catalyst**: a two-phase plan to reset, rebuild, and grow The Graph, executed by a soon-to-be-hired all-star engineering team.

We listened to the whole call. We took notes. And somewhere around the third roadmap item we started getting a strange feeling of déjà vu, so we did what any responsible community member would do: we opened our own GitHub org and started playing bingo.

Reader, we nearly got a blackout.

To be clear up front - this post is written with love, zero stars, and the smug energy of someone who builds things while governance happens. The Foundation's new direction is genuinely the right call, and we're rooting for them. It's just that, well. Let us show you the card.

## "Make Subgraph Studio fully network-powered"

Bold. Ambitious. Also: the [Dock](/dock) has been quietly doing Studio's job for a while now - on-chain subgraph lifecycle (metadata, transfer, deprecation, each behind a typed "are you SURE sure" confirmation), deploy keys, a GraphiQL playground with the real gateway URL, per-subgraph health alerts to your Discord, and a non-custodial metered query gateway where you mint your own keys.

*Fine print, because we're honest to a fault:* the DIPS plumbing - actually paying indexers to sync the studio's subgraphs - is real protocol work that we sincerely hope the Foundation ships. We built the restaurant; someone still needs to install the payment terminal. Please install the payment terminal.

## "Onboard new gateway operators"

You will be delighted to learn that the onboarding kit already exists. It's called [gib](https://github.com/nightswatchhq/gib) - **Gateway-in-a-Box** - a self-hostable, TAP-native, Horizon-ready Graph gateway in a Docker Compose file. It runs on a 2GB VPS. It has a one-command smoke test that proves your whole payment path end-to-end before you ask a single indexer for anything.

Is it battle-hardened? Our README states, with the confidence of a man walking into the sea: *no payment has ever flowed, not on any network, not once.* But every receipt verifies, every RAV recovers to the right signer, and the only thing between a fresh gib deployment and production is the indexer whitelist wall - which, conveniently, is a social coordination problem, and social coordination is famously the Foundation's whole thing. We'll bring the box; you bring the handshakes.

## "Memory for AI"

Okay, this one's genuinely not ours - storing agent memory on the network is a neat idea and we're curious. But when those agents want to *reach* the network, may we interest you in [compass](https://github.com/nightswatchhq/compass)? It's a Subgraph-MCP gateway as a Horizon data service: every subgraph becomes a pay-per-call MCP tool, settled in GRT via TAP v2 or USDC via x402. Any agent that speaks MCP - Claude, Cursor, whatever your nephew is building - queries subgraphs for under a cent, no API key, no central operator.

Your memory service will need an agent-facing front door. We appear to have built a door. GRC-007 forum post incoming.

## "Finish the Substreams data service"

"We were very close to shipping it before the core dev grants ended," said the Foundation. Funny story: so were we, except we kept going. [SDSCE](https://github.com/nightswatchhq/SDSCE) - the Substreams Data Service *Community Edition* - has a live contract on Arbitrum One, an automated settlement daemon, deployment runbooks, and a rehearsed end-to-end provision → register → collect path with a 1% burn.

The "Community Edition" name is doing load-bearing work here: it's experimental, externally unaudited, owner-controlled by an EOA, and explicitly leaves room for the official version. Which is our extremely subtle way of saying - Pedro, StreamingFast, the fork is right there, the runbooks are written, and we would much rather hand you our Arbitrum One scars than watch you collect a matching set.

## "The RPC service - yes, we're finally coming up with a plan"

The community's plan is called [Dispatch](https://github.com/nightswatchhq/dispatch) (GRC-005), and it's far enough along that Lodestar's indexer scoring already gives you credit for provisioning to it. We are not saying the plan should just be "Dispatch." We're just saying that if you typed "Graph RPC data service" into a search bar, the plan would find *you*.

## "A multi-product Studio experience"

Lodestar currently ships an indexer directory, delegator portfolio, curation tools, POI consensus, TAP payment tracking, indexing health, a subgraph developer studio, one-click delegation, an anonymous chat with tripcodes (don't ask), and an AI/MCP directory. At some point "multi-product" stopped being a roadmap item and became a storage problem.

## The actual point

Jokes aside - and they were only about 60% jokes - the striking thing about the new roadmap isn't that it's wrong. It's that it's *validated*. Independent builders looked at the same gaps, on their own dime, with no grants and no mandate, and built the same list. That's about the strongest signal a roadmap can get.

The Foundation says it's hiring a fast-shipping team and hunting for low-effort, high-leverage wins. We'd gently point out that a decent chunk of the effort is already spent, MIT-licensed, and sitting in public repos with embarrassingly few stars. Come kick the tires. Open issues. Fork things. Or just talk to us - we're in the Discord, same as everyone.

We'll keep shipping either way. It's kind of our thing.

* -  Night's Watch. Not affiliated with, endorsed by, or supported by the Graph Foundation or Edge & Node - though at this point, honestly, we're starting to feel like the trailer.*
