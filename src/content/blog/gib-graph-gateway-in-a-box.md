---
title: "gib: a Graph gateway in a box"
date: "2026-07-10"
author: "cargopete"
tags: ["gib", "gateway", "the-graph", "horizon", "tap", "decentralization", "self-hosting", "lodestar"]
category: "News"
excerpt: "Announcing gib v0.2, a self-hostable Graph Protocol gateway distribution, and an honest map of exactly how far 'self-hostable' currently goes. The software is one docker compose up; the network position is escrow funding plus a human conversation with each indexer."
---

*Announcing gib v0.2, a self-hostable Graph Protocol gateway distribution, and an honest map of exactly how far "self-hostable" currently goes.*

---

The Graph decentralized its indexers years ago. Its gateways, the layer that takes your query, picks indexers, pays them per request, and hands you back data, remained in practice, one company's production deployment. Not because the code is closed (it's MIT, and it's good), but because standing up your own gateway meant reading that code end to end, reverse-engineering an undocumented config schema, wiring up three auxiliary services and a Kafka bus, pulling contract addresses out of a monorepo, and then discovering the parts nobody wrote down.

I know, because I did all of that. **gib** (gateway-in-a-box) is the result: the whole Horizon gateway stack (gateway, TAP aggregator, escrow manager, Redpanda) in a Docker Compose distribution configured from a single documented `.env`.

**Repo:** [github.com/nightswatchhq/gib](https://github.com/nightswatchhq/gib) · **Release:** v0.2.0

```sh
git clone https://github.com/nightswatchhq/gib && cd gib
cp .env.example .env               # fill three TODOs
./scripts/fetch-addresses.sh       # verified Horizon contract addresses, never hand-copied
./scripts/gen-keys.sh              # sender + signer keys
./scripts/render.sh
docker compose --env-file runtime/.env up -d
```

Every config field has a comment saying what it is and what to put in it, including the ones that otherwise require source-code archaeology. (`query_fees_target`, for the record, is the target indexer fee per query in USD; the on-chain floor is far lower than you'd guess, and the `.env.example` explains a sane starting value and why.)

## The part I'm proudest of: `gib smoke`

The miserable thing about deploying a gateway is that you can't tell whether it's *working*. Against real indexers, a fresh gateway gets HTTP 402 on every paid query, and a 402 looks identical whether your deployment is perfect or your receipts are garbage.

So gib ships a self-test. One command:

```sh
docker compose --profile smoke run --rm smoke
```

It verifies, against your own running deployment, everything a gateway can prove without anyone else's cooperation: topology syncs; the gateway selects indexers and dispatches queries; the *running* gateway signs receipts with the configured signer (read back from its own metering records, not a simulation); those receipts aggregate into a signed RAV whose signature recovers to your signer, whose EIP-712 domain matches chain and verifier, and whose aggregate value equals the sum of its receipts. Then it checks the failure modes: a tampered receipt and a wrong-key receipt must both be *rejected*. A verifier that only passes valid input proves nothing.

Green means your gateway is protocol-correct. Which matters, because of what comes next.

## The wall, named plainly

Here is the thing no compose file can package: **a fresh gateway cannot buy service from any indexer, no matter how correctly it's configured.**

Indexers only accept payment receipts from senders they have explicitly whitelisted in their config: the `sender_aggregator_endpoints` map is both a trust list and an address book, and it's sensible design: an unknown sender's receipts can't be redeemed, so serving them is charity. When we ran our own deployment against live Arbitrum One indexers, every one of them answered:

> `402: No sender found for signer 0x299A…`

Read that carefully, because it's the most encouraging error message I've received all year. The indexer *recovered our signer address from the receipt's signature* and went looking for its escrow. Signature, encoding, EIP-712 domain: all correct, verified by the most adversarial party available. The only thing missing was money and an introduction.

That's the honest shape of gateway decentralization today: the software is one `docker compose up`; the network position is escrow funding plus a human conversation with each indexer. gib's docs include a full section on that onboarding: what you can prove alone (everything `gib smoke` covers, so bring the green table to the conversation), and exactly what you're asking an indexer for (two config lines and their trust).

## What gib has and hasn't proven

The README's Status section says this with no hedging, so the blog post will too. **Proven:** deployment from the published, pinned image; a cold stranger deploy from the README alone; topology sync; receipt signing verified by live indexers; receipt→RAV aggregation, cryptographically verified, negative tests included. **Never done:** no payment has ever flowed: not on any network, not once; on-chain RAV redemption is untouched; no paid query has ever returned data. Those require funded escrow and indexer whitelisting: by design, the operator's step, not the box's.

One number that surprised us: the gateway holds the entire Arbitrum One network topology (~16k subgraphs, ~26k deployments) in about **207 MB** of resident memory. The whole stack runs in ~570 MB. A €4 VPS runs a Graph gateway. We expected gigabytes; we measured, and the measurements are in the README.

## Why Lodestar is doing this

Lodestar exists to make The Graph's network legible: QoS, indexer analytics, the state of the protocol as it actually is. Gateways are the layer where legibility currently ends: one operator, one selection algorithm, one set of routing decisions. gib is our contribution to changing that, and yes, gib ships with the gateway's indexer-selection weights exposed as configuration, so an operator can decide for themselves how latency trades against price against stake.

If you're a gateway operator (or about to become one) try it. The friction list is the contribution I want most: every step where the docs fail you is a bug, and I'll fix it fast. And if you're an indexer wondering whether independent gateways are worth whitelisting: that conversation is exactly the one this release is meant to start.

*Petko ([cargopete](https://github.com/cargopete)) · [Lodestar](https://www.lodestar-dashboard.com) · gib is MIT, built on the excellent open-source work of Edge & Node, Semiotic Labs, and The Graph's core devs.*
