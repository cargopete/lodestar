---
title: "Substreams, meet Horizon: announcing SDSCE"
date: "2026-06-03"
author: "cargopete"
tags: ["substreams", "data-services", "horizon", "tap", "graphtally", "arbitrum", "indexing", "streamingfast"]
category: "Data Services"
excerpt: "We built a community edition of the Substreams Data Service, a Horizon payment layer that lets providers sell Substreams data for TAP receipts, and deployed it to Arbitrum One. Here is what it is, how the money flows, and how providers can self-onboard."
---

The Graph's Horizon framework doesn't care what a data service serves. Provision stake, register, collect fees: that's the whole contract. We've [pointed it at Solana](/blog/seahorn-solana-data-service) already. This time we pointed it at **Substreams**.

There's an official Substreams Data Service in the works: the MVP scope is essentially complete, and the team behind it has tested it on their own cluster. But the contract work to make it *permissionless* and the layers of testing and infrastructure to make it *usable by anyone* are still ahead. So rather than wait, we did what this blog tends to do: we forked it, finished the sharp edges ourselves, and shipped something you can actually join.

It's called **SDSCE (the Substreams Data Service Community Edition**) and as of today the contract is **live on Arbitrum One**.

A loud, upfront caveat, because we'd rather you hear it from us: **SDSCE is a community edition. It is not affiliated with, endorsed by, or supported by the Graph Foundation or Edge & Node.** The "Community Edition" name is deliberate: it leaves room for an official Substreams Data Service to ship later, distinct from this one. It is **experimental and has not had an external audit** (only our own internal review). Treat it accordingly. Don't put funds behind it that you can't afford to lose.

With that said, here's what we built.

## What a Substreams Data Service actually is

[Substreams](https://substreams.streamingfast.io/) is StreamingFast's parallelized streaming engine: you write a package of Rust modules, point it at a chain's Firehose, and get a high-throughput stream of exactly the transformed data you asked for. It's the fastest way to extract and shape on-chain data that exists today.

What it hasn't had is a *trustless, market-based way to pay for it on The Graph's network*. That's what a Horizon data service provides. The shape is always the same three moves:

1. A **provider** locks stake (a *provision*) toward the data-service contract and `register`s.
2. A **consumer** pre-funds an escrow and streams data, paying as they go with signed receipts.
3. The provider periodically `collect`s those receipts on-chain, and the escrow settles.

The receipts are **RAVs**: Receipt Aggregate Vouchers, the core primitive of TAP (the Timeline Aggregation Protocol, now GraphTally on Horizon). Instead of a transaction per query, the consumer signs a single running voucher that says "I owe you *this much* in total." The provider collects the latest one and the delta settles. Cheap, off-chain until it needs to be on-chain, and bounded by what the consumer escrowed.

SDSCE is the payment layer that makes this work for Substreams specifically: a consumer-side sidecar, a provider-side gateway, and an on-chain data-service contract that plugs into Horizon's existing, audited payment stack (GraphTallyCollector, PaymentsEscrow, GraphPayments).

## How the money flows

The full loop, end to end:

```
┌────────────┐   substreams run     ┌──────────────────┐                ┌───────────────────┐
│ Substreams │ ───────────────────► │ Consumer Sidecar │                │  firecore /       │
│   client   │                      │  (signs RAVs)    │                │  Substreams tier1 │
└────────────┘                      └────────┬─────────┘                └─────────┬─────────┘
                                             │  RAV in request headers            │
                                             └────────────────────────────────────┤
                                                                                  ▼
                                                                        ┌──────────────────┐
                                                                        │ Provider Gateway │
                                                                        │ meters + validates│
                                                                        └────────┬─────────┘
                                                                                 │ collect()
                                                                                 ▼
                                                            SubstreamsDataService → GraphTally → Escrow
```

The pieces:

- **Consumer sidecar.** Runs next to the Substreams client. It does the provider handshake, opens a long-lived payment session, and signs RAVs (EIP-712) as usage accrues. The user just points their normal `substreams run`/`gui` at the sidecar's local endpoint; everything else is hidden.
- **Provider gateway.** The authoritative side. Usage is metered *by the provider* from the Firehose plugin path (not self-reported by the consumer), and the gateway drives the payment session: it requests RAVs as metered cost crosses a threshold, validates the signed RAV against the on-chain authorization, and persists accepted state to Postgres so a restart never loses a collectible.
- **The contract.** `SubstreamsDataService`, a minimal Horizon data service. It gates collection behind a real provision + registration, verifies the RAV through GraphTallyCollector, and routes settlement through the escrow.

### The 1% burn

SDSCE charges a **fixed 1% data-service cut on every collection, and burns it.** Not 1% to a treasury, not 1% to us: it's pulled out of the collected GRT and sent to `burn()`, reducing supply. The deployer keeps **zero**. It's a small, deflationary toll for using the service, baked into the contract rather than left to a configurable cut a caller could game. (We verified on a fork of live Arbitrum One that the contract retains 0 GRT after each collection and total supply drops.)

## What's deployed

The contract is **live on Arbitrum One** (chain `42161`). It's **UUPS-upgradeable** behind an ERC1967 proxy (so we can patch or extend it) with two-step (`Ownable2Step`) ownership over upgrades.

| | Address |
|---|---|
| **SubstreamsDataService (the proxy; this is the data service)** | [`0x1c3e9cca124ad19b9ed3c202d2e6cd106944640c`](https://arbiscan.io/address/0x1c3e9cca124ad19b9ed3c202d2e6cd106944640c) |
| GraphTallyCollector (Horizon) | `0x8f69F5C07477Ac46FBc491B1E6D91E2bb0111A9e` |
| PaymentsEscrow (Horizon) | `0xf6Fcc27aAf1fcD8B254498c9794451d82afC673E` |
| HorizonStaking (Horizon) | `0x00669A4CF01450B64E8A2A20E9b1FCB71E61eF03` |

We proved the whole path against a fork of real Arbitrum One before deploying (provisioning, registration, escrow funding, signed-RAV collection, and the burn) plus a full streaming → metered-RAV → collect run through a real `firecore` runtime. The repo's rehearsal scripts and integration tests reproduce all of it.

### Honest status

This is a soft launch, and we're not going to dress it up:

- **No external audit.** Internal review only. The contract is small and the fund-moving paths are bounded by escrow, but "we reviewed our own code" is not "a firm signed off."
- **Owner is currently an EOA**, not a multisig. It controls upgrades. That'll move to a Safe.
- **Whitelist trust model, no slashing.** `slash()` is a deliberate no-op: providers are vetted off-chain, not held to an on-chain dispute mechanism. Permissionless sourcing and a trust/verification model are future work.
- **No hosted provider or oracle yet.** This is the big one: the contract is live, but a contract isn't a service. **It needs providers.** Until at least one provider runs the stack and onboards, there's nothing for a consumer to stream.

That last point is the entire reason for this post.

## How providers can join

If you already run Firehose/Substreams infrastructure, you are most of the way there. A provider runs three things and does one on-chain onboarding:

1. **A Substreams data plane**: `firecore` serving the data you want to sell. This is your actual product.
2. **The provider gateway**: `sds provider gateway`, backed by Postgres, pointed at chain `42161`, the SubstreamsDataService proxy, the Horizon collector/escrow, and your data-plane endpoint. TLS by default, with an authenticated operator API.
3. **The collection daemon**: `sds provider operator collect-daemon`, a separate process holding your settlement key, which polls for collectible RAVs and submits `collect()` automatically (with retry/backoff). The 1% burns on each collection.

The on-chain onboarding is the standard Horizon move, with real GRT:

```
stake → provision (toward the SubstreamsDataService proxy) → register()
```

`register()` reverts with `ProvisionManagerProvisionNotFound` until your provision exists; that's expected, not a bug. Once registered, you're collectible.

Every command, flag, and `cast` invocation is in the [deployment & onboarding runbook](https://github.com/nightswatchhq/SDSCE/blob/main/docs/arb-one-deployment-runbook.md). The [README quickstart](https://github.com/nightswatchhq/SDSCE#quickstart-self-onboarding-on-arbitrum-one) is the tight version.

## How consumers stream

Once a provider is live, consuming is four steps:

1. **Fund escrow** for the provider (`sds consumer funding deposit …`): GRT into PaymentsEscrow.
2. **Authorize a signer** (`sds consumer signer authorize …`), or sign with the payer key directly.
3. **Run the sidecar** pointed at the provider's control-plane endpoint.
4. **Stream:** `substreams run <pkg> <module> -e localhost:9002 --plaintext`. RAVs flow as you consume; the provider collects; 1% burns.

## Where this goes

The honest framing: SDSCE is a *whitelisted soft launch*, not the permissionless endgame. The contract is deployed, the payment loop is proven on mainnet, and the docs are written so anyone can self-onboard. What's missing is operators, and a list of things we're upfront about needing next: an external audit, a multisig owner, a hosted discovery oracle, and eventually permissionless provider sourcing and a real verification model.

But the rail is live, and it burns. If you run Substreams infrastructure and want to sell access for TAP receipts on Arbitrum One, you can join today.

- **Repo:** [github.com/nightswatchhq/SDSCE](https://github.com/nightswatchhq/SDSCE)
- **README & quickstart:** [github.com/nightswatchhq/SDSCE#readme](https://github.com/nightswatchhq/SDSCE#readme)
- **Deployment runbook:** [docs/arb-one-deployment-runbook.md](https://github.com/nightswatchhq/SDSCE/blob/main/docs/arb-one-deployment-runbook.md)

Come break it. Tell us what you find.
