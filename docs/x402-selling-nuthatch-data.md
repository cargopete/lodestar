# Selling nuthatch data over x402

**Status: half built, deliberately not wired.** Challenge generation and payment verification are
implemented and tested (`src/lib/x402-seller.ts`, 17 tests). Settlement is not, and until it is,
turning this on would take payment authorisations and drop them.

Suggested by Graphtronauts, 2026-08-29, on the nuthatch 3.0 post.

## Why it is a good idea

TAP is the right rail for a Graph-native consumer: GRT, escrow, an on-chain relationship with an
indexer, a gateway. Every one of those is load-bearing when you are buying a lot of queries and
settling periodically.

For an agent that wants **one answer**, all of it is overhead. x402 asks for a USDC balance and an
HTTP header. An agent that has never heard of The Graph can pay for a query in one round trip:

```
GET /api/sql/named  →  402 Payment Required
                       payment-required: <base64 challenge naming price, asset, payTo>
GET /api/sql/named  →  200
  Payment-Signature: <base64 signed EIP-3009 authorisation>
```

That is a genuinely lower barrier than TAP, for a genuinely different buyer. The two are
complementary rather than competing: TAP for the Graph-native consumer, x402 for the agent that
wants an answer and does not care whose infrastructure produced it.

It also lands on work that already exists. `/sql` is the surface, the named-query tier is the
priceable unit (a declared, pinned question has a cost you can quote in advance, where an arbitrary
SELECT does not), and a `tattler` receipt is what the buyer gets to keep.

## The strategic question, which is not an engineering one

**Revenue over x402 does not flow through Horizon.** No TAP receipts, no RAVs, no
`GraphTallyCollector`, nothing an indexer earns from and nothing the protocol sees. For a project
positioned inside The Graph's ecosystem that is worth deciding on purpose rather than discovering
later.

The defensible version is two doors, stated plainly: the Nuthatch Data Service on TAP for consumers
who are in the protocol, x402 for agents who are not, with the second treated as an on-ramp rather
than a replacement. The indefensible version is drifting into x402 because it is easier and quietly
routing around the rails the rest of the work exists to strengthen.

That is a call for Chief and worth putting to the community that raised it.

## What is built

`src/lib/x402-seller.ts`:

- **Challenge generation** in the exact wire shape observed from the live Graph gateway on
  2026-08-18 and already parsed by `src/lib/x402.ts`. Selling in a format we have proven we can buy
  in beats selling in one we have only read about.
- **Payment verification**: EIP-3009 `TransferWithAuthorization`, checked field by field against
  **our** configuration rather than the payment's own claims — a beautifully signed payment to
  somebody else is not a payment to us. Recipient, amount, validity window, network and signer are
  all checked.
- **Off unless configured.** No `X402_SELL_PAY_TO`, no paywall; the surface stays free, which is
  today's behaviour. Testnet is the default, because charging real money should take a deliberate
  act. A price with nowhere to send it is refused rather than guessed at.

The EIP-712 digest is hand-written, which is the part most likely to be subtly wrong: a bad
construction recovers to *some* address rather than failing loudly, so it reads as a forged payment
instead of as our bug. The test that guards it signs with viem's independent typed-data
implementation and requires our verifier to accept it — the same trap and the same remedy as the RCA
hashing in weaver.

## What is not built, and what it needs

**Settlement.** A verified authorisation is a promise, not a transfer. Something must submit the
`transferWithAuthorization` on Base. Two options:

1. **A facilitator** (the x402 reference facilitator, or Coinbase's). We need only a receiving
   address; the facilitator verifies and settles. Least custody, least gas, an external dependency
   in the paid path.
2. **Our own submitter.** A funded key on Base, gas per settlement, and an outage of ours becomes a
   payment failure.

Either way it needs **a receiving address**, which is a custody decision.

## Where this should actually live

Not here. Lodestar is where the surface and the tests already are, so it is the fastest place to
prove the design — but the durable home is the **nuthatch data service gateway**, beside the TAP
paywall that already answers `402 TAP-Receipt header required`. There it becomes a second accepted
payment method for *any* nuthatch operator rather than a feature of one dashboard, which is the
model The Night's Watch works to: build the thing, let other people run it.

## Open decisions

1. Two doors, or is routing revenue around Horizon a line we do not cross?
2. Facilitator or self-settlement.
3. Which receiving address, and on which network first.
4. Price. The Graph's own gateway lists 0.01 USDC per query; a nuthatch SQL query is a different
   thing and probably worth less per call and more per subscription.
