---
title: "We Ran a Real Payment Through the Live Substreams Data Service"
date: "2026-06-04"
author: "cargopete"
tags: ["substreams", "data-services", "horizon", "tap", "graphtally", "arbitrum", "testing", "anvil", "foundry"]
category: "Infrastructure"
excerpt: "When we announced SDSCE we said the payment loop was proven on a fork. A fork isn't mainnet. So we staked real GRT against the live contract, registered a provider, and collected a real signed RAV on Arbitrum One — and the 1% burn reconciled to the wei. Here's exactly how we did it, and what it proves about the live service."
---

When we [announced SDSCE](/blog/substreams-data-service-community-edition) last week, we wrote that the payment loop was "proven on mainnet." That was *almost* true, and the gap matters. What we had actually done was prove the whole path against a **fork** of Arbitrum One — provision, register, collect, burn — using forked state and conjured GRT. It's a genuinely good test. But a fork is a copy. It runs the real bytecode, but with state we control and money that isn't real. The base fee never bites, the GRT costs nothing, and nothing you do is visible to anyone.

There is one test a fork can never be: the real one.

So this week we closed the gap. We took five freshly generated wallets, funded two of them with real GRT and real Arbitrum ETH, and ran the complete provider-and-consumer lifecycle through the **live** `SubstreamsDataService` contract — the same `0x1c3e…640c` proxy anyone can see on Arbiscan. Stake, provision, register, escrow, sign a RAV, `collect()`. Real value moved. Real GRT burned. And the numbers came out exactly where the contract says they should.

This post is the full account: the three-tier method we used to de-risk it, the tricks that let the fork tests cost nothing, the one gotcha that bit us on the real run, and — the point of the whole exercise — what a real on-chain settlement actually *proves* about the live service that a fork cannot.

## Why bother, if the fork already passed?

Because "the contract works" and "the *live* contract works, under real conditions, for a stranger with a wallet" are different claims, and only the second one matters to someone deciding whether to put money behind it.

A fork rehearsal answers: *is the bytecode correct?* A mainnet run answers a longer list:

- Does the **live** Horizon stack — the real `GraphTallyCollector`, the real `PaymentsEscrow`, the real `HorizonStaking` — accept a provision and a signed RAV from an account it has never seen?
- Is there a hidden **minimum stake** that the live deployment enforces but a fork's permissive defaults would mask?
- Does an **EIP-712 RAV signed for chain `42161`** actually recover to an authorized signer against the live collector's domain separator?
- Does the **1% burn** hold under real gas, real protocol tax, and real escrow accounting — not just in a sandbox?
- Can a provider self-onboard **permissionlessly**, with no allowlist, no special privileges, nothing but GRT and gas?

You cannot answer those by copying the chain. You answer them by spending.

## The method: three tiers, cheapest first

We didn't walk a fresh wallet straight onto mainnet and hope. We built confidence in three stages, each one closer to the real thing, each one catching what the previous tier couldn't.

**Tier 1 — fork of Arbitrum Sepolia.** Validate the *deploy* of the hardened contract and the mechanics of the full lifecycle against real (testnet) Horizon contracts, for free.

**Tier 2 — fork of Arbitrum One.** Run the exact same lifecycle against the **live mainnet bytecode** at the real address, still for free, to confirm the production contract behaves identically and to read its real on-chain parameters.

**Tier 3 — real Arbitrum One.** Do it for real, with real GRT, once the first two tiers had removed every avoidable surprise.

The beauty of tiers 1 and 2 is that [anvil](https://book.getfoundry.sh/anvil/)'s forking mode gives you a private, writable copy of any chain in about eight seconds:

```bash
anvil --fork-url https://arb1.arbitrum.io/rpc --port 8547 --chain-id 42161
```

Now you have the entire live state of Arbitrum One on `localhost`, including the live `SubstreamsDataService` and the whole Horizon payment stack, and you can do anything to it without spending a cent.

### Trick one: minting GRT you don't have

The lifecycle needs a provider with GRT to stake and a payer with GRT to escrow. On a fork, you don't buy it — you write it. GRT's `mint()` is minter-gated, but on a fork we don't need permission; we can poke the balance straight into storage. The only puzzle is *which* storage slot the `balanceOf` mapping lives in. We brute-force it:

```bash
# For each candidate slot s, compute keccak256(addr . s), write a known value,
# and check whether balanceOf(addr) now returns it.
for s in $(seq 0 60); do
  slot=$(cast index address $PROVIDER $s)
  cast rpc anvil_setStorageAt $GRT $slot $AMOUNT --rpc-url $RPC >/dev/null
  bal=$(cast call $GRT 'balanceOf(address)(uint256)' $PROVIDER --rpc-url $RPC)
  [ "$bal" = "$EXPECTED" ] && echo "balances slot = $s" && break
done
```

For The Graph's `L2GraphToken` the answer turns out to be **slot 52** (it sits behind a proxy with a deep inheritance chain, which is why it isn't slot 0 like a textbook ERC-20). Same token implementation on Sepolia and mainnet, same slot. With that, both test accounts get a million GRT each, for free, on the fork.

### Trick two: signing RAVs with the service's own code

The hard part of `collect()` is the **RAV** — the Receipt Aggregate Voucher the consumer signs. It's an EIP-712 typed-data signature over the GraphTallyCollector's domain (`name: "GraphTallyCollector"`, `version: "1"`, the chain id, the collector address). Get any field wrong and the on-chain signer recovery lands on the wrong address and the collect reverts.

Rather than hand-roll the typed-data encoding in a shell script and pray, we wrote a tiny Go harness that imports SDSCE's *own* `horizon` package — the same `Sign()`, the same domain construction, the same RAV struct the production sidecar uses. If the harness signs a RAV the live collector rejects, that's a bug in the actual service, not in the test. The harness does three things: authorize a signer, sign the RAV, submit `collect()`:

```go
domain := horizon.NewDomain(chainID, collectorAddr)        // chain 42161, live collector
signedRAV, _ := horizon.Sign(domain, rav, signerKey)       // the service's own signer
recovered, _ := signedRAV.RecoverSigner(domain)            // sanity: recovers to signer ✓
collectData, _ := dataService.PackQueryFeeCollect(signedRAV, 10000)
// provider submits collect(QueryFee, abi.encode(signedRAV, …)) to the live SDS
```

### What the fork tiers proved (and caught)

Both fork tiers ran green, end to end: deploy and hardening invariants on Sepolia (ERC1967 implementation slot correct, initializers disabled on the implementation, owner-gating enforced), then the full **provision → register → collect** lifecycle against the live mainnet bytecode on the Arb One fork.

They also surfaced the single most important parameter for any prospective provider, which we read directly off the live contract:

```
provision tokens range (min, max):  0 .. 2^256-1
verifier cut range:                 0 .. 1000000      (0–100%)
thawing period range:               0 .. max
BURN_TAX_PPM:                        10000            (1%)
```

**The minimum stake is zero.** The live `SubstreamsDataService` imposes no floor on how much GRT a provider must provision. On the fork we proved this the only way that counts: we provisioned **1 GRT** — a deliberately trivial amount — and `register()` succeeded. We also confirmed that with a `thawingPeriod` of 0, that stake is immediately recoverable. That's the difference between "you need to be a serious indexer to test this" and "you can try the live service for the price of a coffee." It's the latter.

And the negative paths reverted exactly as designed: `register()` and `collect()` against an account with no provision both revert with `ProvisionManagerProvisionNotFound`. The guards are real.

## Tier 3: the real thing

Two fork tiers green, every avoidable surprise removed. Time to spend real money.

We generated five disposable wallets and funded the two that needed it — straight from our own wallet, on Arbitrum One:

| Account | Role | Funded with |
|---|---|---|
| [`0x82A4…045e`](https://arbiscan.io/address/0x82A4a06dF453Ac30e5ceb9F1308F845BB128045e) | Provider | 1.2 GRT + 0.003 ETH |
| [`0x8eEc…326E`](https://arbiscan.io/address/0x8eEc11Cf2CE7E2872c37f8DcCfC071923183326E) | Payer | 1.2 GRT + 0.003 ETH |

The lifecycle script runs the standard Horizon onboarding against the live addresses, with a pre-flight balance check so it physically cannot half-execute on an unfunded account:

```
approve → stake(1 GRT) → provision(SDS, thawing=0) → register()
        → escrow deposit(1 GRT) → authorizeSigner → sign RAV → collect(0.5 GRT)
```

Stake, provision, register, and the escrow deposit went straight through. The provider is now, demonstrably and permanently, **registered on the live service** — `isRegistered` returns `true` on mainnet for an account that, an hour earlier, didn't exist.

### The one gotcha

The collect leg failed on the first attempt — not in the contract, in our own transaction plumbing:

```
max fee per gas less than block base fee:
  maxFeePerGas: 20026000  baseFee: 20036000
```

Our Go transaction helper fetched the gas price and then signed with exactly that, with no headroom. Fine on a local devenv where the base fee is effectively zero; on real Arbitrum One the base fee ticked up by ten thousand wei in the gap between fetch and inclusion, and the node rejected the transaction by a hair. A one-line fix — double the fetched gas price as a buffer — and the collect went through. Worth noting precisely because it's the kind of thing a fork *never* shows you: forked base fees don't move.

### The receipts

Here is the real mainnet settlement, reconciled against `totalSupply` and the provider's balance before and after:

| Quantity | Value |
|---|---|
| Provider stake (to register) | 1 GRT — provisioned to the live SDS, recoverable |
| Collected (the RAV value) | 0.5 GRT |
| **Burned** (protocol 1% + SDS 1%) | **0.00995 GRT** |
| Provider received | 0.49005 GRT |

The arithmetic the contract promises:

```
0.5 GRT collected
  − 0.005    protocol payment cut (1%, burned by GraphPayments)
  = 0.495    remainder
  − 0.00495  SDS data-service cut (1% of remainder, burned by the SDS)
  = 0.49005  to the provider's payments destination

burned:   0.005 + 0.00495 = 0.00995 GRT   ✓ matched the totalSupply drop
received: 0.49005 GRT                       ✓ matched the provider balance delta
0.49005 + 0.00995 = 0.5                      ✓ exact
```

No rounding drift. The data service retained **zero** — it burns its entire cut, exactly as the `BurnTaxApplied` event reports. The deflationary toll is real, it's on the ledger, and you can see the burn on Arbiscan.

## What this proves about the live service

This is the part that matters to anyone weighing up whether SDSCE is real or just a deployed contract with a nice README.

1. **The live payment loop works, end to end, for an outsider.** Not on a fork, not in a unit test — on the production contract, with an account that had no prior relationship to us or to The Graph. Provision, register, escrow, signed RAV, collect, settle, burn. Every step landed on mainnet.

2. **Onboarding is genuinely permissionless.** There is no allowlist on the contract. A wallet that didn't exist this morning staked, registered, and got paid, using nothing but GRT and gas. That's the whole promise of a Horizon data service, and it's now demonstrated rather than asserted.

3. **The barrier to entry is a coffee, not a fortune.** Minimum stake is zero. We registered with 1 GRT and it was recoverable. You do not need to be a large indexer to run a Substreams provider on this rail — you need Firehose infrastructure and pocket change.

4. **The economics are exactly what the contract says.** The 1% data-service burn and the protocol cut reconcile to the wei under real conditions. Nothing is skimmed to a treasury. Nothing is retained by the deployer. The cut is burned, supply drops, and the math is verifiable by anyone replaying the transactions.

5. **The RAV path is interoperable with live Horizon.** An EIP-712 RAV signed by the service's own code, for chain `42161`, is accepted by the live `GraphTallyCollector` and settles through the live `PaymentsEscrow`. SDSCE plugs into the existing, audited Horizon payment stack — it isn't a parallel universe.

## The honest caveats, again

We said it in the [announcement](/blog/substreams-data-service-community-edition) and we'll say it here, because a real settlement doesn't change any of it:

- **`register()` is permanent.** The contract has no deregister — `stopService` is a deliberate no-op and nothing ever flips `isRegistered` back to false. Our test provider is registered on the live service forever (barring an upgrade). That's by design, and harmless, but it's a real, irreversible footprint, and you should know that before you onboard a throwaway.
- **Still no external audit.** Internal review only. A real settlement proves the happy path moves money correctly; it does not substitute for an adversarial audit. The owner is still an EOA, slated to move to a Safe.
- **A contract that works isn't a service that exists.** The rail is proven. It still needs *providers* running real Substreams infrastructure for consumers to have anything to stream. That remains the open invitation.

## Reproduce it yourself

Everything here is in the repo. The fork rehearsals, the lifecycle script, and the RAV-signing harness are all checked in, and the deploy/onboarding runbook has every `cast` invocation.

- **Repo:** [github.com/lodestar-team/SDSCE](https://github.com/lodestar-team/SDSCE)
- **Deployment & onboarding runbook:** [docs/arb-one-deployment-runbook.md](https://github.com/lodestar-team/SDSCE/blob/main/docs/arb-one-deployment-runbook.md)
- **Live SubstreamsDataService:** [`0x1c3e9cca124ad19b9ed3c202d2e6cd106944640c`](https://arbiscan.io/address/0x1c3e9cca124ad19b9ed3c202d2e6cd106944640c)
- **The proof, on-chain:** the [provider](https://arbiscan.io/address/0x82A4a06dF453Ac30e5ceb9F1308F845BB128045e) and [payer](https://arbiscan.io/address/0x8eEc11Cf2CE7E2872c37f8DcCfC071923183326E) test wallets — every transaction in this post is in their history.

We said the rail was live, and that it burns. Now there's a settlement on mainnet to prove it. If you run Substreams infrastructure, the live service is waiting — and you can verify every claim in this post against the chain before you trust a word of it.

Come break it. Tell us what you find.
