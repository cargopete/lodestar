# Running one of these services

Several data services in the catalogue are finished, deployed on Arbitrum One, and unclaimed. This
is what actually stands between you and serving one, written from having done it rather than from
the contracts.

**Nothing is asked in return.** The Night's Watch builds these and does not operate them. If you run
one, it is yours.

---

## What it costs, which is probably not what you think

Read from each service's own `ProvisionManager` on Arbitrum One, 2026-08-30. These are live and on
[the data services page](https://www.lodestar-dashboard.com/data-services), so they cannot go stale
the way this table would.

| Service | Minimum provision | Thawing period |
|---|---|---|
| **Subgraph Service** | **100,000 GRT** | 28 days |
| Dispatch | **555 GRT** | 14 to 28 days |
| Seahorn | **555 GRT** | 14 to 28 days |
| Mainline | none set | 21 to 28 days |
| Nuthatch Data Service | none set | 14 to 28 days |
| SDSCE | none set | up to 28 days |

**The bar you are thinking of is the Subgraph Service's bar.** 100,000 GRT is what it takes to be an
indexer, everybody knows it, and it is not what these ask. Dispatch and Seahorn want 555 GRT, and
three of them set no floor at all. That is a difference of about a hundred and eighty times, and it
was on chain the whole time nobody was running these.

Two honest caveats. A service with no floor is not necessarily generous: on SDSCE both the token
floor and the thawing floor are zero, which reads more like parameters nobody set than a deliberate
offer. And a provision is not a cost, it is stake at risk under the service's slashing terms, which
you should read before choosing a number.

## The shape, whichever service you pick

Five steps, and the fourth is where people lose a day:

1. **Stake.** `HorizonStaking.stakeTo(you, tokens)` after approving the token.
2. **Provision to the data service.** `provision(you, dataService, tokens, maxVerifierCut, thawingPeriod)`.
3. **Register with the service.** `register(you, abi.encode(...))` — the payload differs per service
   and is in each catalogue entry.
4. **Start the service** for whatever it is scoped to: a chain, a program, a package.
5. **Run the stack** and put your endpoint on-chain.

## The four things that will waste your afternoon

Every one of these cost us real time in the last two days. None of them is in the contract
documentation and all of them fail in a way that points somewhere else.

### 1. The thawing period is capped at 2,419,200 seconds

Exactly 28 days, read from `getMaxThawingPeriod()` on Arbitrum One rather than remembered. This
page said "about 2,418,000" until 30 August, which was both wrong and wrong in the unhelpful
direction: it implied the ceiling sits just under a round 28 days when 28 days is the ceiling.

Pass 30 days, the obvious round number, and the provision is refused by a custom error carrying
**two raw numbers and no name**, in seconds, which reads as an opaque failure until you convert
them and realise one is your input and the other is the limit. Paste it into
[`/revert`](https://www.lodestar-dashboard.com/revert) and it will say so in English.

**Use the service's own floor, which for Dispatch and Seahorn is 14 days.** This page previously
said "use 14 days, it is comfortably inside", which is right for those two by accident and wrong as
reasoning: 14 days is their **minimum**, not a comfortable middle, and 13 would be refused by the
service before the protocol ever saw it. Mainline's floor is 21 days. Read the range rather than
copying a number, and be aware that the ceiling and the floor come from different places: the floor
is the data service's, the ceiling is the protocol's.

### 2. Two Horizon addresses in circulation are implementations, not proxies

And this is the nasty one, because **calling an implementation does not revert**. If it was never
initialised its storage is empty and views return **zero**, forever, silently, which is at least
obviously wrong once you notice it.

If it *was* initialised, it answers with stale values that look entirely reasonable, and that is
worse. Measured on 2026-08-30: the stray `RPCDataService` implementation at `0xA983…`, which
Dispatch's own example configs and subgraph pointed at until that day, agrees with the live proxy on
the thawing range, the verifier cut and the owner, and reports a minimum provision of **10,000 GRT
where the live proxy says 555**. Four answers right, one eighteenfold wrong, and nothing anywhere
saying so.

Resolve them from the Controller instead of copying any table, including ours:

```sh
cast call <controller> "getContractProxy(bytes32)(address)" $(cast keccak "PaymentsEscrow") --rpc-url <rpc>
```

Two gotchas inside the gotcha: the registry key for staking is **`Staking`**, not `HorizonStaking`
(the latter resolves to the zero address, which is at least loud); and a size check is a decent smell
test, since a Horizon proxy is roughly 2–5 KB and an implementation is tens.

Arbitrum Sepolia Controller: `0x9DB3ee191681f092607035d9BDA6e59FbEaCa695`.

### 3. If the service settles through `RecurringCollector`, a payer must authorise their own key

`_isAuthorized(payer, signer)` requires `authorizations[signer].authorizer == payer` and does **not**
special-case signer being the payer. So a payer signing their own agreement, with their own key,
gets a signature that recovers perfectly and is rejected anyway — with an error blaming the
signature.

`tattler authorize-proof` emits the proof and the matching `cast send`. Note the two conventions in
one contract: the agreement is EIP-712, this proof is a plain `eth_sign`.

Services settling through `GraphTallyCollector` (most of them) have no such step.

### 4. Your provision is what makes the service payable at all

The collector checks `getProviderTokensAvailable(you, dataService) > 0` before paying anybody — the
guard against a rogue data service draining somebody's escrow. Miss it and everything else is
well-formed and the collection is refused for a reason that reads like something else entirely.

## When something reverts and the message points elsewhere

Every trap above fails in a way that names the wrong thing. Paste the revert data into
[**lodestar-dashboard.com/revert**](https://www.lodestar-dashboard.com/revert): it knows the 63
custom errors the staking, payments and data-service contracts declare, converts seconds into days
and wei into GRT, and for the ones that actually catch people out it says what to change. It runs
in your browser and makes no request, so it is fine to paste a failing transaction from a terminal
into it.

The exception is trap 2, which throws nothing at all. Nothing can decode a silent zero.

## Rehearse it on a fork before you spend anything

You do not need funds to find out whether any of this works. On a fork you can mint GRT with
`deal`, stake, provision and fund escrow with ordinary calls to the real contracts, and drive a
collection end to end.

`horizon-skills` ships a base class for exactly this
([`HorizonForkTest.sol`](https://github.com/nightswatchhq/horizon-skills)), carrying all four traps
above so you meet them in a test rather than in a transaction:

```solidity
contract PaidTest is HorizonForkTest {
    function setUp() public {
        forkOrSkip();
        provisionTo(me, address(ds), 100_000 ether);   // correct thawing period
        fundEscrow(payer, COLLECTOR, me, 50_000 ether);
    }
    function test_iGetPaid() public {
        uint256 before = grtBalance(me);
        // ... register, start, collect ...
        assertGt(grtBalance(me), before);
    }
}
```

**Write one test that ends with a balance going up.** It is the only assertion that means anything,
and it is the one we did not have when a contract of ours turned out to have two separate defects
that made it unpayable — behind a fully green test suite, because the mock accepted any input.

## What we will do

Say so in [the Discord](https://discord.gg/484vgDETEZ) and we will help you stand one up: the
runbooks, the addresses, the fork rehearsal, and a look at your config before you spend gas. We
maintain these services; we are just not the ones running them.

## What we will not do

Run it for you, fund your escrow, or promise the service will earn anything. Several of these have
never been paid outside a fork, and the catalogue says which — that is the honest state, and it is
also the opportunity.
