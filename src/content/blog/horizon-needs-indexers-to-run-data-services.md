---
title: "The Indexer Is the Farmer: Horizon Needs You to Run New Data Services"
date: "2026-06-03"
author: "cargopete"
tags: ["horizon", "data-services", "indexers", "ecosystem", "amp", "dispatch"]
category: "Analysis"
excerpt: "Horizon turns The Graph from a subgraph network into an open marketplace for any data service. But a marketplace with one supplier isn't a marketplace — it's a demo. We've deployed several new data services and we're dogfooding them alone. That has to change, and only indexers can change it."
---

We just shipped a [data services catalogue](/data-services) — every Horizon data service we know about, grouped by whether it's in production, deployed, or still in development. Go and have a look. It's a genuinely useful map of where the network is heading.

It's also, if you read it honestly, a slightly lonely document.

Because for most of the services beyond the classic Subgraph one, the provider list reads the same way: **us**. Lodestar deployed it, Lodestar runs it, Lodestar is the one consumer hammering it to check it still works. That's not a catalogue of a thriving open market. That's a catalogue of one team's experiments, displayed nicely.

I want to explain why that's the single biggest risk to Horizon actually succeeding — and why the people who can fix it are indexers, not us.

---

## What Horizon was supposed to unlock

For its entire life, The Graph has been a subgraph network. You index a contract, you serve GraphQL, you get paid query fees. Brilliant, proven, and — crucially — *singular*. One product. One thing an indexer could sell.

Horizon's whole thesis is that this was always too narrow. The protocol's real primitives — staking, provisioning, [GraphTally payments](/blog/how-to-build-a-horizon-data-service), slashing, dispute resolution — aren't subgraph-specific. They're a generic substrate for paying decentralised infrastructure to do *anything verifiable*. Subgraphs were just the first application built on top.

So Horizon opens the gates. Anyone can define a **data service**: a smart contract that describes what's being sold, how it's paid for, and how providers can be held accountable. JSON-RPC. SQL analytics over chain data. Solana accounts. Firehose streams. Whatever. The protocol stops caring what the *product* is and only cares that someone staked GRT, served a request, and got paid for it.

That's the promise. An open marketplace of decentralised data services, all settling on the same economic rails.

The promise has a catch, and the catch is the entire point of this post.

---

## A two-sided market with one side missing

Every marketplace is two-sided. You need supply and you need demand, and you need *both at once*, because neither side shows up for an empty room.

For Horizon data services:

- **Supply** is indexers — operators who provision on a data service contract and serve real traffic.
- **Demand** is consumers — apps, teams, and protocols that point their infrastructure at the service and pay for it.

Here's the trap. A consumer will not build on a data service served by a single provider, because a single-provider network isn't decentralised — it's a relay with extra steps and worse uptime than just paying Alchemy. We [said exactly this about Dispatch at launch](/blog/dispatch-json-rpc-horizon), and it was the most honest sentence in the announcement.

But a *second* provider won't show up either, because from where they're standing the service has no consumers, no revenue, and no proof anyone wants it. Why run infrastructure for a product with zero customers?

So demand waits for credible supply. Supply waits for demonstrated demand. Everyone waits. The room stays empty. This is the oldest failure mode in platform economics, and Horizon is sitting right in the middle of it.

---

## What we've actually done about it

We didn't want to write a think-piece about a problem we'd done nothing about, so here's the ledger.

We've deployed and dogfooded several new data services ourselves, precisely so that "is this even runnable?" stops being a question:

- **[AMP](/blog/intro-to-amp)**: SQL analytics over chain data, [running on Arbitrum](/blog/camp-free-amp-api-arbitrum), self-hostable, with [a public node you can run locally](/blog/run-local-amp-node).
- **[Dispatch](/blog/dispatch-json-rpc-horizon)**: decentralised JSON-RPC on Horizon, with a QoS-weighted gateway and GraphTally micropayments. It even [picked up a second provider](/blog/dispatch-second-provider-graphtronauts) — PaulieB from the Graphtronauts — which is the only reason its routing logic has anything to actually route.
- **[Seahorn](/blog/seahorn-solana-data-service)** (Solana) and others mapped on the catalogue.

Every one of these went through the same path: read the contracts, stand up the infrastructure, provision the GRT, serve real traffic, pay real receipts. We've walked the road end to end so that nobody else can claim it's theoretical.

And here's the part it's tempting to leave out: we can't keep doing this. The expenses have grown faster than anything coming back the other way. We have no budget for it, we're not a real commercial indexer, and one small team simply cannot run every data service on the catalogue alone — least of all with no consumers paying for any of it. But even if we *could* — even if we had infinite servers and a bottomless wallet — we still shouldn't, because one team running everything is the precise opposite of what Horizon is for.

And it hasn't been enough. Because one team running every service is still, economically, one provider per service. We've proven the services *work*. We have not — cannot — prove they're a *network*. That word requires other people.

---

## Why it has to be indexers first

There's a temptation to fix this from the demand side: go find clients, drum up consumers, market our way to traction. We could. It would be the wrong order, and it would actively backfire.

Imagine we succeed at marketing. We convince a team to build on a new data service. They integrate, they ship, they route production traffic through it — to a single provider, on experimental infrastructure, with no failover. The first time that one node restarts for maintenance, their application goes dark. We will have spent our credibility to deliver them an outage.

You cannot sell decentralisation that doesn't exist yet. The demand side is only safe to court *after* the supply side is real, because resilience, failover, and honest-response verification all require a plurality of providers. With one provider there's nothing to race, nothing to fall back to, nothing to cross-check. With three, suddenly there's a network worth pointing a customer at.

So the sequence is not negotiable:

1. **Indexers run new data services** and prove plurality.
2. *Then* the services become genuinely usable — resilient, fault-tolerant, verifiable.
3. *Then* we do the marketing, and bring consumers onto something that won't embarrass anyone.

Step one gates everything. And step one is not something we can do for you. We can build the contracts, write the docs, ship the Docker compose, run the reference provider, and validate the onboarding ourselves — we've done all of that. The one thing we cannot do is *be a second independent operator*. By definition.

---

## The indexer is the farmer

Here's the framing I keep coming back to. In this whole economy, the indexer is the farmer.

Nothing grows until the farmer plants it. The consumers, the clients, the query fees, the marketing, the "Horizon is thriving" narrative — all of that is downstream produce. None of it exists until indexers put infrastructure in the ground first, on faith, before the revenue is obvious. That's not a flattering accident of the design; it's the load-bearing role. The protocol can mint all the primitives it likes, but a data service with no provider is just a contract address.

And the good news, if you already index: the soil is mostly tilled.

- You already have GRT staked. Provisioning on a new data service is a fraction of what most active indexers hold.
- You already run node infrastructure. New data services are sidecars next to what you operate, not replacements for it.
- You already understand GraphTally — it's [the same payment primitive](/blog/how-to-build-a-horizon-data-service) the Subgraph network uses for query fees. This isn't new economic territory.

The marginal cost of running a *second* service alongside your subgraph operation is far lower than the cost of standing up indexing was in the first place. You've done the hard part already.

---

## What we're asking, concretely

This is a call to action, so let me make it actionable rather than aspirational.

**Pick one service off the [catalogue](/data-services) and run it.** Not all of them. One. Dispatch has the most mature onboarding right now and a second provider already proving the path; AMP is the most useful if you care about analytics. Either is a reasonable first plant.

**Help us test it.** Provision, serve traffic, then tell us where it hurt. Where the docs lied, where the agent broke, where the payment flow confused you. A second operator finding the rough edges is worth more than ten of our own dogfooding runs, because you'll hit the things we've gone blind to.

**Tell other indexers.** When PaulieB provisioned on Dispatch, the signal that mattered wasn't the extra capacity — it was that someone outside our team looked at it and decided it was worth their time. Plurality is partly technical and mostly social. Your visible participation recruits the next operator.

We will keep building. We'll keep the contracts deployed, the code open, the docs current, and the reference infrastructure running. We'll do the marketing the moment there's something honestly worth marketing. But we cannot conjure the supply side out of one team's servers, and we're not going to pretend a one-provider service is a network when it isn't.

Horizon either becomes the open data-services marketplace it was designed to be, or it stays a nicely-rendered catalogue of one team's experiments. The difference between those two outcomes is indexers deciding the experiment is worth planting.

The farmer goes first. That's always been the deal.

---

*Ready to plant something? Start at the [data services catalogue](/data-services), pick one, and run it. Stuck on onboarding, or want to compare notes with someone who's already done it? Come and find us — the rough edges are exactly what we want to hear about.*
