---
title: "Lodestone: Turn a One-Paragraph Idea Into a Working Horizon Data Service"
date: "2026-06-24"
author: "cargopete"
tags: ["lodestone", "data-services", "horizon", "tap", "rust", "solidity", "tooling", "dogfooding"]
category: "Guides"
excerpt: "We'd hand-built the same Horizon data service ten times. So we distilled the pattern into a Claude Code plugin that generates a complete, building, payment-gated service from a short spec — and proved it by shipping a deliberately absurd one."
---

A while ago we wrote [a long guide on building a Horizon data service by hand](/blog/how-to-build-a-horizon-data-service) — the Solidity contract that inherits `DataService`, the Rust gateway that validates TAP receipts and collects fees, the deploy script, the Docker, the config. It's a genuinely useful walkthrough. It's also about two thousand lines of boilerplate you will copy-paste, subtly break, and rediscover the fix for, every single time.

We know, because we did it ten times. Dispatch (JSON-RPC). A files service. A WebSocket relay. A Solana indexer. An MCP gateway. A camp monetiser. Each one was 90% the same payment plumbing wrapped around 10% of an actual idea. At some point copying your own homework stops being a workflow and starts being a smell.

So we did the obvious thing: extracted the 90% into a reusable library ([`horizon-core`](https://github.com/nightswatchhq/horizon-core)), and then built a generator for the rest. It's called **[lodestone](https://github.com/nightswatchhq/lodestone)** — a Claude Code plugin that turns a short spec into a complete, *building*, payment-gated Horizon data service. This post is how to use it, and the story of the gleefully silly service we built to prove it works.

## What a Horizon data service actually is

Two layers, every time:

1. **An on-chain contract** that inherits `DataService` (plus the upgradeable/pausable mix-ins), reuses the shared `GraphTallyCollector` unchanged, and exposes the provider lifecycle: `register → startService → collect → stopService`.
2. **An off-chain gateway** that checks a signed TAP receipt on every request, serves or proxies the data, periodically rolls receipts into a signed RAV, and redeems it on-chain via `collect()`.

The contract differs only in its tier enum and economics. The gateway, thanks to `horizon-core`, is now literally an eleven-line `main.rs`. Everything genuinely novel about your service lives in one place: the **data plane** — the thing that actually produces or serves the data. Lodestone generates everything *except* that, because that part is the point and it's yours.

## Two archetypes

Lodestone asks which shape you're building:

- **`proxy`**: you front an existing upstream over HTTP (an RPC node, a REST API, a file server, a graph-node). The gateway is `horizon_core::run()` verbatim; you write no Rust at all.
- **`pipeline`**: *your service is the indexer*: a `Substrate` streams chain events, pure `Handler`s transform them into a `ChangeSet`, and a `Sink` writes them to Postgres. A `horizon-core` gateway sits in front of the query layer to take payment.

## The whole journey, six steps

```
1. Generate    invoke the skill, answer ~6 questions → a complete repo
2. Build       ./setup-contracts.sh; forge test; cargo build   (lodestone runs these for you)
3. Deploy      forge script ... --broadcast      → note the proxy address
4. Configure   fill gateway.toml + .env          (addresses, keys, upstream)
5. Run         docker compose up                 → Postgres + gateway
6. Provide     stake a GRT provision, register on-chain
```

In Claude Code you just say *"make a new Horizon data service for X"* (or run `/create-data-service`). Lodestone interviews you — name, archetype, tiers, economics, optional per-endpoint pricing — writes the answers, runs its generator, vendors the contract libraries, and **verifies the result compiles and its tests pass before handing it back.** A scaffold that doesn't build is worse than none, so it won't give you one.

## Proving it: Hermit DS, the inverse analytics service

A generator you only ever run on tidy, sensible specs is a generator you don't trust. So we handed lodestone something deliberately strange.

**Hermit DS** is the inverse of every analytics service on the network. Everyone indexes activity. Hermit indexes *absence* — wallets that have gone quiet. Sophisticated dormancy detection: whales who haven't moved in eighteen months, DAOs where quorum has been unreachable for N proposals, LPs who've missed K rebalance cycles. It serves **wake alerts** when a dormant wallet finally stirs. The consumers write themselves: MEV bots hunting stale approvals, security teams watching for compromised custody waking up, on-chain historians, grave-robbers.

It works as a product because absence-of-activity is legitimately valuable signal that nobody indexes — it's an inverted query shape, awkward for activity-first pipelines. It's funky because the entire pitch is "we watch people who aren't doing anything and tell you the moment they start."

It is also, structurally, just a Horizon data service. So we gave lodestone one paragraph of that spec, picked the `pipeline` archetype (an indexer of absence is still an indexer), three tiers — `DORMANCY`, `WAKE_ALERTS`, `COHORTS` — and turned on per-endpoint pricing. Then we got out of the way.

What came back, with **zero hand-written application code**:

- `HermitDataService.sol` + interface, a deploy script, and a Foundry test suite — **7/7 tests passing**, exercising the full provider lifecycle against a mock Horizon stack.
- A `Substrate → Handler → Sink` indexer that **runs** (`cargo run -p hermit-indexer`).
- A `horizon-core` payment gateway with compute-unit pricing.
- Docker, config, the contract-dependency setup script, and a README with the deploy runbook.

We didn't take its word for it. We stood the gateway up locally against Postgres and poked it:

- `/health` → `200`. `/ready` (which only passes if the database is reachable) → `200`.
- A request with no `TAP-Receipt` header → `402 Payment Required`. The payment gate is live.
- A request with a malformed receipt → `402 invalid receipt`. Validation is live.

That's the entire generated stack — contract, indexer, and a serving, payment-gating gateway — from a paragraph, building and running locally. The dormancy logic itself? That's the data plane: you replace the generated mock `Substrate`/`Handler`/`Sink` with your real detection, and fill in the three tiers. Lodestone did the boring, error-prone 90%. [The repo is here](https://github.com/nightswatchhq/hermit-ds), and its README says, plainly, that lodestone built all of it.

## The loop that makes it better

Here's the part we're quietly proud of. To trust the generator, we pointed it back at our own fleet: we ported three of those original hand-built services (camp, seahorn, wsaas) onto `horizon-core` so they'd match what lodestone emits. That deleted roughly **four thousand lines** of drifted copy-paste — and, more importantly, every place a real service *resisted* the port told us exactly what `horizon-core` was missing.

WebSocket relay didn't fit the HTTP proxy. Several services wanted per-endpoint pricing the core couldn't express. So `horizon-core` grew four new capabilities — a pricing policy, a composable router, a pre-forward gate, and a multi-backend resolver — each of which is now both a library feature *and* a lodestone option. Generate a service, find a gap, fix the core, regenerate. The tool sharpens itself on the work.

We left Dispatch alone, by the way. It's a genuinely bespoke JSON-RPC engine — multi-chain routing, consumer credit, escrow pre-checks, response attestation — and forcing it through a generic generator would have been a lossy lie. Knowing what *not* to generate is part of the job.

## Operating what you generate

A service you can't run is a demo. Lodestone ships a companion MCP server, `horizon-ds-mcp`, that lets an agent *operate* a deployed service in plain language: read a contract's economics, check a provider's registration and active tiers, look up a consumer's escrow balance, verify on-chain settlement, probe a gateway's health — and, strictly opt-in behind an operator key, run the provider lifecycle on-chain. Read-only by default, because handing a language model fund-moving transactions unprompted is how you end up in the cautionary-tale section of someone else's blog.

## Try it

```
/plugin marketplace add nightswatchhq/lodestone
/plugin install lodestone
```

Then describe the service you want. If you've got data worth selling and an afternoon, you can be a paid provider on The Graph by the end of it — and spend your time on the idea instead of the plumbing.

Start on Arbitrum Sepolia. Build something funkier than Hermit. We'd genuinely like to see it.
