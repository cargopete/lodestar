# Project Catalyst: Community Roadmap

> Last updated: 2026-08-28
> Owner: Pete / The Night's Watch
> Scope: the eight Project Catalyst roadmap items, tracked as one programme rather than eight essays.
>
> **Status legend:** ✅ Done · 🟡 In progress · ⬜ Not started · 🔒 Foundation-gated · ❓ Unverified
>
> **Evidence rule.** Anything marked *verified* was read from the repo source or queried from
> Arbitrum One on the date shown, not inferred from a README summary or a forum post. Anything
> marked ❓ is a claim we are carrying forward without having checked it. Do not promote a ❓ to a
> fact without touching the thing itself.

---

## How to use this file

This is the single tracking surface for Catalyst work. It replaces the scattered per-project
roadmaps for the purpose of *"where are we against the Foundation's eight items"*. Per-project
detail still lives in each repo.

- Workstreams are numbered **CAT-1 … CAT-8**. The upstream research report numbered them
  RFC-001 … RFC-008; that collides with `plans/RFC-005-subgraph-disassembly.md` and
  `plans/RFC-006-servability-network-integrity.md`, which are unrelated Lodestar RFCs. The mapping
  is given in the scoreboard.
- Every task is a checkbox. Tick it only when the thing is *observably* true (a tx hash, a passing
  command, a second person running it), not when the code is written.
- `src/data/catalyst-roadmap.ts` is the *public editorial* scoring shown on the homepage. This file
  is the *internal* tracker. They currently disagree (see [Score reconciliation](#score-reconciliation));
  keeping them in sync is itself a task.

**There are no effort estimates or budgets in this document, deliberately.** The point of the
exercise is that The Night's Watch moves all eight of these items on zero funding, in the open,
under permissive licences. Costing the work in person-weeks invites the question of who is paying
for it, and the answer is nobody. It gets done because it gets done.

Two things genuinely cannot be willed into existence that way, and they are called out where they
appear:

1. **External smart-contract audits.** A reputable firm signing off on a contract holding other
   people's GRT costs real money. No amount of community effort substitutes for it.
2. **A second, independent gateway operator.** Another organisation has to choose to run one. We
   can make that as easy as a compose file, and we have, but we cannot do it on their behalf.

Everything else on this page is ours to finish. (SOC 2 in CAT-8 belongs in the same bucket as the
audits: it needs money and a legal entity, which is why it sits at an 80% ceiling.)

---

## Scoreboard

| WS | Item | Source ref | Now | Community ceiling | Primary asset |
|---|---|---|---|---|---|
| CAT-1 | Studio continuity via DIPS | RFC-001 | 40% | 90% 🔒 | The Dock, gib |
| CAT-2 | New gateway operators | RFC-002 | 60% | 95% | gib |
| CAT-3 | Memory for AI | RFC-003 | 22% | 90% 🔒 | compass, seahorn |
| CAT-4 | Substreams data service | RFC-004 | 58% | 95% | SDSCE |
| CAT-5 | RPC service | RFC-005 | 62% | 95% | Dispatch |
| CAT-6 | Multi-product Studio | RFC-006 | 45% | 90% | Lodestar |
| CAT-7 | Chain integrations DS | RFC-007 | 6% | 85% 🔒 | (greenfield) |
| CAT-8 | Institutional audit layer | RFC-008 | 5% | 80% 🔒 | (greenfield) |

🔒 marks an item whose last stretch is protocol or Foundation policy and cannot be engineered
around from outside.

---

## Verified ground truth (2026-08-28)

Read from source or from Arbitrum One today. **Three claims in the source research report are
wrong and are corrected here.** Fix them before any of this is quoted externally.

### Corrections

1. **`nightswatchhq` is entirely public.** The report's caveat that the org "exposes few or no
   public repos" is false: all 83 repos are PUBLIC, including `gib`, `dispatch`, `compass`,
   `seahorn`, `SDSCE`, `gateway`, `liminal`, `polaris`, `graphite` and every nest. Nothing in this
   programme needs to be taken on trust. Verified: `gh repo list nightswatchhq --limit 100`.

2. **Seahorn is deployed, not pre-deployment.** The report says `SolanaDataService.sol` is
   "written, not yet deployed, so no on-chain address exists yet". It is live on Arbitrum One:

   | | |
   |---|---|
   | Proxy | `0xdDE3F913cb6D1332Bc018Eb63647020a87dD7B37` |
   | Implementation | `0x745af998718A64c1007a3D96b21cEE021CfB7599` |

   Verified by reading the ERC-1967 implementation slot on the proxy; it matches the README.
   Provider registration is done, 37 Foundry tests pass. What is genuinely outstanding is the live
   Yellowstone → Postgres → PostgREST pipeline and the first paid mainnet query.

3. **The Dispatch address in the report is a dead implementation.** The report cites
   `0xA983b18B8291F0c317Ba4Fe0dc0f7cc9373AF078` as the live `RPCDataService`. That address holds
   ~11 kB of code, which is an implementation contract, and it is **not** the implementation the
   proxy currently points at. The live addresses are:

   | | |
   |---|---|
   | Proxy (the thing to integrate against) | `0x7101d5c1a5c89c3647f5118da118e56c023ba0b9` |
   | Current implementation | `0x3527a12af6256634df6aa9cc2896ed9588e12de3` |
   | Subgraph | `rpc-network` **v0.3.0** (report said v0.2.0) |

   Verified: `eth_getCode` plus `eth_getStorageAt` on the ERC-1967 slot, Arbitrum One,
   2026-08-28. **Anywhere `0xA983…` appears in a doc, post or config, it is wrong.**

### Confirmed as stated

- **gib v0.2** is exactly as honest as the report says. Its own README: *"No payment has ever
  flowed. Not on any network, not once."* `gib smoke` proves topology sync, live-signer identity,
  receipt → RAV aggregation with correct EIP-712 domain and `valueAggregate == Σ`, payer and
  dataService assertions, and two negative tests. It stops deliberately at a verified *signed*
  RAV. On-chain redemption untouched. Footprint ~570 MB full stack, gateway ~207 MB RSS with the
  full Arbitrum topology resident. Verified: `gib/README.md`, `gib/docs/`, `gib/smoke/`.
- **SDSCE** `SubstreamsDataService` live at `0x1c3e9cca124ad19b9ed3c202d2e6cd106944640c` (ERC-1967
  proxy, impl `0x6f0bb704f4badbc033d7a3924b928449d7567a72`), 1% burn, 0% retained. Internal audit
  dated 2026-06-03 found **no Critical or High**: 3 Low (L-01 immutables not preserved across
  upgrades, L-02 single-step ownership, L-03 front-runnable `initialize`) and 3 Informational.
  External-audit brief already written at `docs/net-02-audit-brief.md`. Verified: repo + chain.
- **compass** is Arbitrum Sepolia only. Weeks 1 to 6 complete (contract, `tools/list`/`tools/call`,
  TAP validation, x402 USDC-on-Base, schema-derived per-entity tools). No mainnet address exists.
  Verified: `compass/README.md`.

### The Dispatch audit is stale, and that changes CAT-5's plan

The report says step one for CAT-5 is "resolve the audit's 3 High findings". That audit
(`.context/outputs/1/audit-report.md`, dated **2026-04-15**) was run against
`/Users/pepe/Projects/drpc-service/contracts/src/RPCDataService.sol`: a *different, larger*
contract that had a rewards pool, trusted state roots and EIP-1186 fraud-proof slashing.

The contract in the repo today is **365 lines** and has none of that. Reading it function by
function:

| Finding | Then | Now |
|---|---|---|
| H-1 stake-lock bypass in `collect()` | `_lockStake` after fee collection | **Structure still present** (`collect()` L272, `_lockStake` L312). Needs re-analysis against the current shape, not assumed carried over. |
| H-2 owner drains `withdrawRewardsPool` | rewards pool existed | **Gone.** No rewards pool. `withdrawFees` withdraws the data-service cut, which is legitimate revenue. |
| H-3 EOA injects trusted state roots | fraud-proof slashing existed | **Gone.** `slash()` is `external pure` and reverts `"slashing not supported"`. |
| M-1 fraud proof ignores `chainId` | " | **Gone** with H-3. |
| M-2 pause guardian lifts own pause | `setPauseGuardian` | **Still present**, verify current semantics. |
| L-1 unbounded `_providerChains` | O(n) `deregister` | **Still present** (`activeRegistrationCount` L347). |
| L-2 `issuancePerCU` truncation | issuance existed | **Gone.** No issuance in this contract. |

So CAT-5's first task is not remediation of three Highs. It is: **re-scope, confirm which findings
survive the deletion, then buy an external audit of the 365-line contract.** Two of the three Highs
were fixed by deletion, which is the cheapest remediation there is, and it means the paid audit
round has less ground to cover.

Note also that Dispatch's own `ROADMAP.md` lists slashing, block-header oracles, EIP-1186 proof
verification and GRT issuance under **"Deliberately out of scope"**, with the note that they were
"explored and removed" and "are not planned". The research report treats EIP-1186 proofs as "the
deepest moat". Those two positions are incompatible and someone needs to pick one. See
[Open questions](#open-questions).

### Still ❓ (verify before relying on it)

- [ ] ❓ **Dispatch provider count.** The report says two providers (ours + PaulieB/Graphtronauts).
      `docs/src/deployed-addresses.md` lists **one** active provider (`0xb43B…`, `rpc.cargopete.com`,
      chain 42161, Standard + Archive). Query the `rpc-network` v0.3.0 subgraph for the real count
      and update the doc. This matters: it is the flagship counter-example to the one-provider
      problem and it is currently undocumented.
- [ ] ❓ **REO snapshot.** "49 of 97 indexers eligible at activation" comes from the report. Confirm
      against `qos-reo-nest` / the REO oracle and date the figure.
- [x] ~~❓ **GIP-0087 / GIP-0088 status.**~~ Resolved 2026-08-28. The contracts are deployed and
      wired on Arbitrum One; only the allocation parameter is still zero. "In progress" was too
      pessimistic: the correct statement is *live and switched off*. See CAT-1.
- [ ] ❓ **nuthatch claims** (DOUDOCHAIN_V2, 13 Arbitrum contracts, SQL-over-HTTP) are carried from
      the report and not re-verified here.

---

## Cross-cutting gates

These are not workstreams. They are conditions that bind several workstreams at once, and they are
the things most likely to sink the programme.

### G-1: The one-provider problem 🔴 **top programme risk**

Every data service in this stack has a provider list that reads "us". A data service with one
provider is a contract address, not a market.

- [ ] Set an explicit **quarterly gate**: any service that has not gained a second *independent*
      provider by quarter end stops feature work and spends the next quarter on recruitment.
- [ ] Publish a live provider count per service on Lodestar so the number is embarrassing in public
      rather than privately known.
- [ ] Target list of candidate providers per service, maintained, with who has been asked and when.

Current independent-provider count:

| Service | Independent providers | Target |
|---|---|---|
| Dispatch | ❓ 1 or 2 (see above) | ≥10 |
| SDSCE | 0 | ≥1 then ≥3 |
| Seahorn | 0 | ≥1 |
| compass | 0 | ≥1 |
| gib (operators) | 0 | ≥2 |

### G-2: External audits 🔴 **one of the two things money is required for**

Everything else here is free. This is not. A contract that holds other people's GRT needs a firm's
name on it, and firms charge.

- [ ] Decide the funding route: grant, GIP-0089 Innovation Allocation, sponsorship, or a
      contributor pooling arrangement. This is a decision, not an engineering task, and it is
      currently unmade.
- [ ] Prioritise: CAT-5 and CAT-4 are live on mainnet and come first. CAT-3, CAT-7 and CAT-8's
      contracts are unwritten and can wait.
- [ ] Rule: no feature work on any contract already live with open High findings until remediated
      and re-audited. Applies to CAT-5 first, pending the re-scope above.
- [ ] SDSCE's external-audit brief (`docs/net-02-audit-brief.md`) already exists. Get quotes so the
      number is real rather than assumed.
- [ ] Do every cheap thing first, so the paid round is spent on findings we could not have found
      ourselves: fix the known Lows, shrink the surface, write the invariants, run the fuzzing.

### G-3: Legal entity 🔴 **binding constraint on two workstreams**

Not engineerable. Blocks CAT-6's prepaid-GRT billing (already gated on legal review per
`GAP_ANALYSIS.md`) and is a hard prerequisite for CAT-8 (something must hold SOC 2 and sign SLAs).

- [ ] Decide: form an entity, or partner into one.
- [ ] Resolve ToS and payment-taking for prepaid GRT (unblocks CAT-6 step 2).
- [ ] Identify the SOC 2 / SLA holder (unblocks CAT-8 step 4).

### G-4: Multisig everywhere

- [ ] SDSCE `SubstreamsDataService` owner: EOA → Safe.
- [ ] Dispatch `RPCDataService` owner: EOA → Safe. Note the contract is UUPS; owner controls upgrades.
- [ ] Seahorn `SolanaDataService` owner `0x20E59D8F…`: EOA → Safe.
- [ ] Operator keys onto HSM with a documented rotation procedure.

### G-5: No verification primitive

compass, Dispatch, SDSCE and Seahorn share one unsolved problem: no cryptographic response or data
verification, so `slash()` is a no-op and none are issuance-eligible without a POI equivalent. This
is protocol research, not a bug, and it caps every workstream's "100%".

- [ ] Write this up once, properly, as a single position paper rather than a caveat repeated in
      five READMEs. It is the honest answer to "why is your data service not issuance-eligible".

---

## Dependency graph

```
G-3 legal entity ──────────────┬──▶ CAT-6 subscription billing
                               └──▶ CAT-8 SOC 2 / SLA holder

CAT-2 gib payment loop ───┬──▶ CAT-1 DIPS gateway
   (THE KEYSTONE)         ├──▶ CAT-7 metering gateway
                          └──▶ CAT-6 multi-tenant billing

CAT-2 QoS publisher ──────┬──▶ REO / DIPS routing (CAT-1)
                          ├──▶ CAT-4 provider selection oracle
                          └──▶ CAT-5 provider scoring

compass MCPDataService.sol ──┬──▶ CAT-3 MemoryDataService.sol
   (~60-line delta pattern)  ├──▶ CAT-7 ChainIntegrationDataService.sol
                             └──▶ CAT-8 attestation service contract

seahorn Substrate→Handler→Sink ──┬──▶ CAT-3 encrypted memory store
                                 └──▶ CAT-8 deterministic ground-truth pipeline

GIP-0088 issuance split (Foundation) ──┬──▶ CAT-1 100%
                                       └──▶ CAT-7 indexer flow
```

**Critical path:** gib payment loop → QoS publisher → (CAT-5 audit re-scope ∥ CAT-4 external audit)
→ provider bootstrap on both → DIPS gateway → chain-integration metering.

CAT-8's SOC 2 window runs in parallel **from day one**, because it is the only item where the
calendar, not the effort, is the constraint.

---

## Sequencing

| Quarter | Workstreams | Kill-switch |
|---|---|---|
| Q1 | CAT-5 audit re-scope + external audit + drop-in compat + dashboard; CAT-2 close the payment loop + QoS publisher. **Start the SOC 2 observation window (CAT-8 step 4).** Resolve G-3. | If no second gateway operator or RPC provider appears, stop features and recruit (G-1). |
| Q2 | CAT-4 external audit + multisig + provider kit (Tycho as the demand story); CAT-6 managed pipelines + subscription billing. | If G-3 is unresolved, CAT-6 step 2 does not start. |
| Q3 | CAT-1 Dipper-gateway + Dock publish flow; CAT-3 MemoryDataService + encrypted store. | If GIP-0087/0088 have not landed, CAT-1 ships to its 90% ceiling and stops. |
| Q4 | CAT-7 metering rails + Foundation pitch; CAT-8 ground-truth + attestation service. | SOC 2 must already be mid-observation or CAT-8 slips a quarter regardless of code. |

---

# The workstreams

---

## CAT-1: Studio continuity via DIPS

**40% → 45% → 90% (100% 🔒).** The *participating* half depends on CAT-2's payment loop. The
*observing* half does not, and shipped on 2026-08-28: `dips-nest` and a live homepage panel.

Make Subgraph Studio fully network-powered so the Edge & Node upgrade indexer's role is replaced by
real indexers earning through Direct Indexer Payments. We can build the gateway and the developer
surface. The issuance-funded escrow and the decision to wind the upgrade indexer down are not ours.

**The DIPS rails are live on Arbitrum One and switched off.** Verified 2026-08-28 by reading the
chain, not the roadmap. `IssuanceAllocator` (`0xb64f29b2…`), `RecurringAgreementManager`
(`0x51f860b0…`), `RecurringCollector` (`0xff0dc731…`), `DefaultAllocation` (`0x28cd50e9…`) and
`ReclaimedRewards` (`0xe26cdc4e…`) all hold bytecode. The allocator is wired, with `getTargets()`
returning `[DefaultAllocation, RewardsManager]`, and it is distributing. But
`getTargetAllocation(DefaultAllocation)` is **zero** and the RewardsManager still takes the full
120.73 GRT per block, which `RewardsManager.issuancePerBlock()` independently confirms.

So GIP-0088's 5% split is a governance parameter change, not a deployment. Full state in
[`../plans/on-chain-indexing-agreements.md`](../plans/on-chain-indexing-agreements.md).

**And it was armed three days ago.** `dips-nest` indexed all three contracts from deployment and
found the configuration history: on 2026-07-23 the allocator's issuance rate went from 0 to 120.73
GRT/block and the agreement manager was wired to it; then on **2026-08-25**, in a single burst, the
collector's pause guardian was set, the agreement manager was pointed at Rewards Eligibility Oracle
A, DefaultAllocation was registered as the default target, and the Rewards Manager was allocated the
entire 120.73 per block. That is every step of arming DIPS except the last one.

The consequence for this workstream: **everything observable is buildable today.** Whoever is
already indexing these contracts sees the split move the moment it moves. That is the moat the
parked tracker predicted, and it is still unclaimed.

**What is already true.** The Dock is Studio-parity today: on-chain lifecycle via
`GNS.updateSubgraphMetadata` / `transfer` / `deprecate`, deploy keys, a GraphiQL playground on the
real gateway URL, health alerts, a non-custodial metered query gateway with self-minted `lod_live_`
keys and free-tier caps (5k per user, 90k global). gib proves a self-hostable TAP v2 / Horizon
gateway topology.

**What is missing.** A DIPS-aware gateway that creates and funds indexing agreements and requests
POIs from the Dipper. A Dock "publish to network" flow that provisions an agreement. Pre-sync
parity replacing the upgrade indexer. Fallback routing.

### Tasks

- [x] **Confirm the protocol state rather than assuming it.** Done 2026-08-28: the contracts are on
      mainnet and the allocation is zero. See above.
- [ ] **DIPS observability (`dips-nest` + Lodestar panel).** 🔑 *In progress. Unblocked, ours end to
      end, no payment loop required.*
  - [x] `dips-nest`: index `IssuanceAllocator`, `RecurringAgreementManager` and
        `RecurringCollector` on Arbitrum One. 56 tables plus `dips_timeline` and
        `dips_current_allocation` views; 35 events over 12.3M blocks, backfills in ~2 minutes.
  - [x] Deploy `dips-nest` to Helsinki behind `/dips/sql` and wire `NUTHATCH_DIPS`.
        `nuthatch-dips.service` on `127.0.0.1:8104`, Caddy `handle_path /dips/*`, backfills in 5s
        with `--window 50000 --seal-direct --concurrency 4`. Repo:
        [nightswatchhq/dips-nest](https://github.com/nightswatchhq/dips-nest).
  - [x] Allocation-split panel: current targets and rates, and the moment DefaultAllocation moves
        off zero. Live on the homepage. `DefaultAllocation`'s zero is labelled *"no allocation
        event; zero by absence"* rather than rendered as a measured figure, because it has never
        emitted `TargetAllocationUpdated` and a confident zero would be a lie.
  - [ ] Agreement lifecycle view: offer → acceptance → POI presentation → collection → cancellation.
  - [ ] Per-indexer agreement portfolio: active agreements, revenue, compliance.
  - [ ] Alert on the split changing. It is the starting gun for the rest of this workstream.
  - [ ] Watch for `InnovationAllocation` appearing in the mainnet address book (GIP-0089, due
        2026-08-31); it is on Sepolia only today.
- [ ] **Dipper client in the gateway.** Extend gib to speak the GIP-0081 agreement flow.
  - [ ] Discover indexers by QoS (consumes CAT-2's publisher).
  - [ ] Negotiate price-per-unit-work.
  - [ ] Issue payment vouchers on POI receipt.
  - [ ] Reuse gib's TAP path for query fees.
- [ ] **Dock DIPS publish flow.**
  - [ ] Agreement creation alongside the GNS lifecycle UI.
  - [ ] Surface agreement status (offer → accept → collect) from GIP-0087 events.
- [ ] **Pre-sync service.** Studio-side sync farm (nuthatch or graph-node) keeping a
      deployment hot and handing off to a DIPS indexer on publish. Shares implementation with
      CAT-6 step 1.
- [ ] **Fallback router.** Route order: DIPS indexers → curation-attracted indexers →
      upgrade indexer.
- [ ] **Adoption.** Migrate a cohort of live Studio subgraphs to DIPS-funded indexing as proof.
- [ ] 🔒 Issuance Allocator "Split" phase (GIP-0088).
- [ ] 🔒 Council decision on upgrade-indexer taper policy.

**Definition of done.**
*90%:* a community gateway funds indexing agreements end to end for ≥10 Studio subgraphs served by
≥3 independent indexers, with pre-sync parity, upgrade indexer only as fallback.
*100%:* Issuance Allocator in Split, Council-ratified taper, DIPS the default path in thegraph.com Studio.

**Risks.** Will the Foundation expose the Dipper as an open component or keep it gateway-internal?
The GIP-0081 off-chain MVP trust model (indexers trust the gateway to pay) deters independent
gateways until GIP-0087 is on-chain. DIPS-funded indexers must still clear REO's service bar or
lose issuance rewards.

---

## CAT-2: New gateway operators 🔑 **the keystone**

**60% → 95%.** Unblocks CAT-1, CAT-6 and CAT-7. **Do this first.**

gib is the near-complete artifact. The gap is turning a smoke-tested topology into a gateway that
has actually settled a paid query on-chain.

**What is already true, verified.** gib v0.2, MIT, built on the `nightswatchhq/gateway` fork plus
graph-tally aggregator and escrow-manager, Redpanda, optional Prometheus/Grafana. ~570 MB full
stack on a 2 GB box. `gib smoke` runs green from a clean stranger deploy against the published GHCR
image. Ships payment-safe by default (`PAYMENT_REQUIRED=false`, `ESCROW_DRY_RUN=true`).

**What has never happened, in gib's own words.** No payment has ever flowed, on any network, not
once. On-chain RAV redemption untouched. No paid query has ever returned data (a `402` against live
indexers is by design, and is itself the evidence that receipts are valid). The Stage-2
escrow-manager path is unverified. No QoS data has ever been published: `docs/08-qos-publishing.md`
is a wire-format spec read off live payloads, not a runbook, and no publisher ships.

### Tasks

- [ ] **Close the payment loop.** 🔑 *The single highest-value task in this document.*
  - [ ] Fund escrow on Arbitrum One (authorize signer, deposit GRT per indexer).
  - [ ] Get one indexer to whitelist the sender in `[tap.sender_aggregator_endpoints]`.
  - [ ] Drive a real paid query to a `200` **with data**.
  - [ ] Aggregate receipts into a RAV.
  - [ ] **Redeem that RAV on-chain via GraphTallyCollector. Record the tx hash here.**
  - [ ] Verify the Stage-2 `--profile escrow` path with real funds and a raw network-subgraph source.
- [ ] **QoS publisher.**
  - [ ] Ship the doc-08 publisher writing the QoS oracle subgraph wire format.
  - [ ] Wire into Lodestar's scoring.
  - [ ] Align with GRC-009 "The Lodestar Oracle" so gib and REO consume the same signal.
- [ ] **Onboarding automation.**
  - [ ] `gib onboard`: automate the sender-whitelist handshake and per-indexer escrow funding.
  - [ ] A hosted sender directory so indexers whitelist once rather than per-gateway.
  - [ ] Remove the read-only Studio key requirement for topology bootstrap, or document a sovereign
        source as the default.
- [ ] **Multi-tenant hardening.** Per-consumer API keys over TAP receipts, rate limits,
      spend caps. Shares implementation with CAT-6 step 2.
- [ ] **Adoption.** Recruit ≥2 external gateway operators. Publish a settlement-proven reference
      deployment.

**Definition of done.**
*90%:* gib settles a paid query on Arbitrum One end to end, publishes QoS, and one external
operator runs it.
*100%:* ≥2 external operators, automated onboarding, published QoS feeding REO/DIPS routing.

**Risks.** Sender-whitelist friction is the adoption killer and needs either a default trusted-sender
set or a one-click flow. Gateway federation (shared QoS, honouring each other's RAVs) is required
for genuine decentralisation but sits past 90%.

---

## CAT-3: Memory for AI

**22% → 90% (100% 🔒).** Depends on the compass contract template and the seahorn sink pattern.

An end-to-end-encrypted, user-owned, portable agent memory service on the network. The Foundation
has claimed this as its "inaugural agentic product", so the community play is to be the reference
open implementation and interoperate, not to race.

**What is already true, verified.** compass is a Horizon MCP data service exposing subgraphs as
typed pay-per-call tools: `MCPDataService.sol` (roughly a 60-line delta from `RPCDataService.sol`)
on **Arbitrum Sepolia only**, dual rails TAP v2 GRT plus x402 USDC-on-Base, `tools/list` and
`tools/call` end to end, per-entity tools auto-derived from `__schema` introspection. Weeks 1 to 6
of 8 complete; `compass-cli` and launch are outstanding. compass is *read*, not memory write/store.
Seahorn's Substrate → Handler → Sink shape (append-only `entity_changes`, PostgREST) is the
reusable write/store primitive.

### Tasks

- [ ] **`MemoryDataService.sol`.** Fork `MCPDataService.sol`; registry keyed on
      memory-namespace rather than subgraph deployment; identical `collect()` path.
- [ ] **Encrypted store + sink.**
  - [ ] Reuse seahorn's PostgresSink.
  - [ ] Client-side envelope encryption with a user-held key.
  - [ ] pgvector semantic index.
  - [ ] Per-user namespacing, retention and GC.
- [ ] **MCP memory tools.** `memory.write` / `read` / `search` / `forget` over compass's MCP
      Streamable HTTP; TAP and x402 rails inherited.
- [ ] **Client SDK + harness integration.** A drop-in memory provider for one agent framework.
- [ ] **Prerequisite:** finish compass weeks 7 to 8 and get `MCPDataService.sol` onto Arbitrum One.
      The template is not proven on mainnet yet.
- [ ] 🔒 Issuance eligibility and "inaugural product" endorsement.

**Definition of done.**
*90%:* encrypted memory data service live on Arbitrum One with MCP tools, one agent harness storing
and retrieving through it, paid via TAP and x402.
*100%:* Foundation-aligned GRC accepted, issuance-eligible, multi-provider.

**Risks.** The encryption model (per-user vs per-agent keys, rotation, cross-model portability) is
the hard design question and is not yet answered. On-chain verifiability of memory writes is
unsolved, same class as G-5.

---

## CAT-4: Substreams data service

**58% → 95%.** Independent of the Foundation to a high ceiling, given an audit.

**What is already true, verified.** `SubstreamsDataService` live on Arbitrum One at
`0x1c3e9cca124ad19b9ed3c202d2e6cd106944640c` (ERC-1967 proxy, impl `0x6f0bb704f4…`,
`Ownable2Step`, fixed 1% burn on collected fees, deployer keeps zero). Consumer sidecar, provider
gateway (Postgres-backed), `sds provider operator collect-daemon` for automated settlement.
Deployment and onboarding runbooks written. Provision → register → collect rehearsed end to end on
an Arbitrum One fork through a real `firecore` runtime. Internal audit 2026-06-03: no Critical or
High, 3 Low, 3 Informational. External-audit brief already drafted.

**What is missing.** No hosted provider gateway or oracle. No provider has self-onboarded. Not
usable end to end without a live `firecore` data plane behind a provider gateway. Externally
unaudited. EOA-owned. `slash()` is a deliberate no-op.

### Tasks

- [ ] **External audit + multisig.** The one paid line item here (G-2).
  - [ ] Get quotes against the existing `docs/net-02-audit-brief.md`.
  - [ ] Fix L-01 (immutables not preserved across upgrades), L-02 (single-step ownership),
        L-03 (front-runnable `initialize`) before the external round so the vendor is not billing
        for known issues.
  - [ ] Transfer ownership to a Safe (G-4).
- [ ] **Provider bootstrap kit.** Turnkey `firecore` + provider-gateway compose bundle so an
      existing Substreams operator onboards in a day.
- [ ] **Provider selection / discovery oracle.** Network subgraph indexing provider
      registration plus a QoS selection signal. Reuse the Lodestar Oracle rather than building a
      second one.
- [ ] **Consumer UX.** Make `substreams run -e localhost:9002 --plaintext` the entire story.
      Auto escrow top-up.
- [ ] **Adoption.** Recruit ≥1 provider running Firehose/Substreams infra. Tycho (GraphOps /
      PropellerHeads DEX-liquidity Substreams consumer) is the flagship demand to point at it.
- [ ] **Coordination.** Talk to juanmardefago and StreamingFast early: either merge, or position
      SDSCE explicitly as the shipping community edition until the official one is permissionless.

**Definition of done.**
*90%:* audited, multisig-owned SDSCE with ≥1 live provider serving a real Substreams package to a
paying consumer, discovery oracle live.
*100%:* ≥3 providers, Tycho consuming in production, POI/verification path specified.

**Risks.** Duplication with the official DS is the main strategic risk. The official roadmap slots
"Substreams Data Service Mainnet & Provider Selection Oracle" in Q3 2026, so the window to be the
reference implementation is now, not later.

---

## CAT-5: RPC service

**62% → 95%.** The most mature item, and ahead of the official plan (which only slots
"Experimental JSON-RPC Data Service research" in Q3 2026).

**What is already true, verified.** `RPCDataService` live on Arbitrum One, proxy
`0x7101d5c1a5c89c3647f5118da118e56c023ba0b9`, implementation `0x3527a12af6256634df6aa9cc2896ed9588e12de3`.
Subgraph `rpc-network` v0.3.0. npm `@lodestar-dispatch/consumer-sdk` and
`@lodestar-dispatch/indexer-agent`. Full TAP loop (receipts → RAVs every 60s → `collect()` hourly →
GRT). Dynamic discovery, QoS scoring (latency EMA 35%, availability 35%, block freshness 30%),
quorum dispatch, 10 EVM chains, capability tiers, geographic routing, WebSocket subscriptions,
batch support, per-IP rate limiting, Prometheus metrics, EIP-712 cross-language tests. 10,000 GRT
min provision, 5:1 stake-to-fees, 2% data-service cut of which 1% burns.

**Contract shape today (365 lines):** `slash()` is `external pure` and reverts. No rewards pool. No
issuance. No trusted state roots. UUPS, `OwnableUpgradeable`, pause guardian, `withdrawFees`.

### Tasks

- [ ] **Audit re-scope.** 🔴 *Do before spending a penny on an audit.* Free, and it shrinks what
      the paid round has to cover.
  - [ ] Re-run the finding list against the current 365-line contract; the 2026-04-15 audit targeted
        a larger, since-deleted contract (see [ground truth](#the-dispatch-audit-is-stale-and-that-changes-cat-5s-plan)).
  - [ ] Confirm H-1 (`collect()` L272 → `_lockStake` L312) is or is not still exploitable in the
        current control flow. This is the one High that plausibly survives.
  - [ ] Confirm M-2 pause-guardian semantics.
  - [ ] Fix L-1 unbounded `_providerChains` O(n) growth.
  - [ ] Write the finding-by-finding disposition into the repo so the next reader does not repeat
        this analysis.
- [ ] **External audit** (G-2). Cheaper than the source report assumed, because the surface shrank
      from the audited contract to 365 lines.
- [ ] **Document dead-code paths in the deployed bytecode.** The proxy has been upgraded; make the
      implementation history explicit and kill the `0xA983…` reference everywhere it appears.
- [ ] **Sticky sessions + drop-in compat.**
  - [ ] Provider affinity for `eth_newFilter` / `getFilterChanges` / `getFilterLogs`: 3-way quorum
        breaks filter IDs today.
  - [ ] Transparent receipt issuance so anonymous ethers / viem / web3.py clients work with no SDK.
  - [ ] Publish a Feature / Client Support Matrix.
- [ ] **Dashboard + status.** Per-key analytics (CU, RPS, p50/p95/p99, error rates), public
      per-chain status page with auto-incident posting. Reuse Lodestar.
- [ ] **Provider program (ongoing).** Reference deployment, coverage targets, reimbursable
      infra. Recruit 5 to 10 founding indexers across ≥3 regions covering the top-5 chains. Until
      coverage thresholds are met, fall back to public endpoints.
- [ ] **Adaptive verification.** Replace blanket 3× dispatch with sample-based replay plus
      on-demand quorum, cutting cost from 3× to ~1.1×.
- [ ] **Fix the provider-count documentation** (❓ above). One or two providers is a fact we should
      not have to guess at.
- [ ] **Resolve the slashing position** (see [Open questions](#open-questions)).
- [ ] 🔒 Progress GRC-005 → GIP → Council, with a dispute path aligned to the Arbitration Charter
      (GIP-0009).

**Definition of done.**
*90%:* re-audited contract, ≥10 providers across ≥3 regions on top-5 chains, drop-in ethers/viem,
dashboard and status live, sticky sessions correct.
*100%:* GRC → GIP ratified, adaptive verification, SLA tiers published.

**Risks.** Response correctness has no canonical on-chain truth, the same wall Pocket and Lava hit.
Provider bootstrap is make-or-break. Comparison point: dRPC runs 100+ chains, 50 to 60+ providers
and paid SLAs to 99.99%.

---

## CAT-6: Multi-product Studio experience

**45% → 90%.** Blocked on G-3 for one of four steps.

**What is already true.** Lodestar (Next.js 16, lodestar-dashboard.com) already unifies the Dock,
an indexer directory with 11-dimension composite scoring including REO compliance and
multi-data-service coverage, delegator and curator portfolios, one-click delegation, POI consensus,
GraphTally/TAP payment tracking, an AI/MCP directory, push notifications, and a data-services
catalogue grouping every Horizon service by production / deployed / in-dev. v4.0.0 hardening
complete (86% logic-tier coverage, security audit done). Partially self-served by nuthatch with
per-panel fallback to the gateway.

### Tasks

- [ ] **Managed pipeline service.** nuthatch / graph-node / firecore sync farm with a
      "deploy → we sync → network takes over" flow. **Shares implementation with CAT-1 step 3;
      build once.**
- [ ] **Subscription billing.** 🔴 gated on G-3.
  - [ ] Prepaid-GRT metering, extending the existing metered gateway.
  - [ ] Optional fiat on-ramp.
  - [ ] Per-plan quotas and usage dashboards.
  - [ ] Resolve the prepaid-GRT legal gate flagged in `GAP_ANALYSIS.md`. **Do this in Q1, not Q2.**
- [ ] **Unified publish surface.** One catalogue-driven UI to publish a subgraph, a
      Substreams package (SDSCE), an RPC tier (Dispatch) and an MCP tool (compass).
- [ ] **SQL / direct-DB delivery.** Expose nuthatch SQL-over-HTTP as a first-class product tier.
- [ ] **Adoption.** Onboard paying developers to managed pipelines.
- [ ] Keep `src/data/catalyst-roadmap.ts` in sync with this file (see below).

**Definition of done.**
*90%:* Lodestar offers managed sync pipelines and subscription billing across ≥3 product types with
paying users.
*100%:* full four-product unified publish plus SQL delivery, legal cleared, upstream path to
thegraph.com agreed.

**Risks.** The binding constraint is legal, not code. thegraph.com is Foundation-owned; the
community version lives on lodestar-dashboard.com and can be upstreamed.

---

## CAT-7: Chain integrations as a data service

**6% → 85% (community ceiling) 🔒.** Near-greenfield. Depends on CAT-2's gateway.

The Foundation states that chain-integration revenue "is largely captured outside the protocol" and
that it "will take direct ownership of the Chain Integration Process". So 100% is inherently
Foundation-gated. Existing CIP is GIP-0057 (3-stage governance integration) plus GIP-0047 (CAIP-2
chain aliases).

This is more a business-model problem than an engineering one. We can build the metering rails; we
cannot set the cut or compel chains. **Positioning: build the open metering reference so the
Foundation adopts it rather than rebuilds it**, funded against the GIP-0089 Innovation Allocation.

### Tasks

- [ ] **Metering spec + contract.** `ChainIntegrationDataService.sol` from the compass
      template: accept per-chain integration payments, split protocol / indexer / DIPS, reuse
      GraphTallyCollector.
- [ ] **Attribution gateway.** gib extension tagging usage by CAIP-2 chain id; export to the
      revenue dashboard.
- [ ] **Revenue dashboard.** Lodestar panel: per-chain integration revenue, protocol capture
      rate, indexer flow.
- [ ] **Reference integrator flow.** A runbook for a chain to route its RPC / subgraph /
      Substreams demand through the protocol.
- [ ] **Adoption.** Sign one chain foundation to route integration revenue through the protocol.
- [ ] 🔒 Value-capture policy, CIP ownership, issuance/DIPS routing rules.

**Definition of done.**
*85% (community max):* a working chain-integration metering data service with attribution and
dashboard, demonstrated on one chain routing real revenue through the protocol.
*100%:* Foundation adopts the CIP value-capture policy on these rails and DIPS routes a share to
indexers.

---

## CAT-8: Institutional audit layer

**5% → 80% (community ceiling) 🔒.** Engineering is ours; the SOC 2 track is calendar-bound and
needs money and an entity, which is what caps this one at 80%.
**Start the SOC 2 clock in Q1 even though the code lands in Q4.**

Position The Graph as the neutral verification layer that lets auditors, regulators and
counterparties validate confidential on-chain finance disclosures against ground-truth data. The
Foundation acknowledged the gap itself: no SLAs, no SOC 2. Genuinely from scratch.

Reusable substrate: seahorn's deterministic structured-data pattern, Dispatch's per-response signed
attestations over `(chain, method, params, result)`, Lodestar as the auditor console.

Context on what institutions actually adopt: ZK-SNARK/STARK proofs, FHE, TEEs, and
view-key/selective-disclosure models (ZKsync Prividium, Chainlink ACE, the Ethereum-for-institutions
privacy stack). Institutions on privacy-enabled chains require infrastructure partners holding
SOC 2 Type II or ISO 27001.

### Tasks

- [ ] **SLA + SOC 2 track (runs in parallel from day one).** 🔴 **Start Q1.**
  - [ ] Resolve G-3: identify the entity that will hold the certification and sign SLAs.
  - [ ] Adopt a compliance automation platform (Vanta / Drata / Comp AI class).
  - [ ] Stand up controls for Security + Confidentiality.
  - [ ] Run the Type II observation window (3 to 6 months).
  - [ ] Publish SLOs first, then contractual SLAs (99.9 / 99.95 / 99.99% tiers with measurement and
        credit remedies).
  - [ ] HSM key management (shares with G-4).
- [ ] **Deterministic ground-truth pipeline.** Seahorn-pattern service producing
      reproducible, lineage-tagged entities from canonical chain state. Append-only, hash-anchored.
- [ ] **Verification / attestation service.** Verify ZK proofs or view-key disclosures
      against the ground-truth store; emit signed audit tags; support permissioned decryption and
      selective disclosure.
- [ ] **Auditor console.** Lodestar module: query disclosures, verify against ground truth,
      export audit reports, role-based access.
- [ ] **Adoption.** One auditor, regulator or institutional counterparty as design partner.
- [ ] 🔒 A dispute/attestation standard; issuance eligibility.

**Definition of done.**
*80% (community max):* a working ground-truth and attestation service verifying one
confidential-transfer scheme, with an auditor console and published SLOs.
*100%:* SOC 2 Type II achieved, contractual SLAs, one institutional design partner in production,
Foundation-aligned standard.

**Risks.** Needs a legal entity (G-3). The verification primitive is only as good as the privacy
scheme it validates, and NIST has issued no formal ratings for specific ZK/FHE/MPC schemes, which
caps institutional confidence regardless of what we build.

---

## Score reconciliation

`src/data/catalyst-roadmap.ts` powers the public homepage card and currently disagrees with this
file. That is fine as long as it is deliberate: the TS file is an *editorial* score of "how much of
the Foundation's item has the community covered", this file is an *internal* delivery tracker.

| Item | `catalyst-roadmap.ts` | This file | Why they differ |
|---|---|---|---|
| Gateway operators | 65 | 60 | No payment has ever flowed; the report docked it for that. |
| RPC service | 60 | 62 | Live contract, real TAP loop; further along than 60. |
| Substreams | 55 | 58 | Contract live on mainnet with a fork-proven loop. |
| Multi-product Studio | 45 | 45 | Agree. |
| Studio via DIPS | 40 | 40 | Agree. |
| Memory for AI | 25 | 22 | compass is read-only, so the memory core is greenfield. |
| Chain integrations | 5 | 6 | Settlement patterns are proven territory. |
| Institutional audit | 0 | 5 | Seahorn determinism plus Dispatch attestations are a real seed. |

- [ ] Decide whether to reconcile the two, or document the split explicitly in
      `catalyst-roadmap.ts`'s header comment. Do not let them drift silently.
- [ ] Whichever way it goes, **Seahorn's live deployment should raise the institutional-audit and
      memory scores slightly**, since the write/store substrate is now on mainnet rather than
      hypothetical.

---

## Open questions

1. **Slashing: moat or dead end?** Dispatch's `ROADMAP.md` lists EIP-1186 proof verification, block
   header oracles and fraud-proof slashing under "Deliberately out of scope". The research
   report calls EIP-1186 proofs "the deepest moat". Both cannot be the position. Decide, then make
   the repos and the public messaging agree. This also determines whether G-5 is a research
   programme or an accepted permanent limitation.
2. **Will the Foundation expose the Dipper as an open component?** CAT-1's whole approach turns on
   this. Worth asking directly rather than designing around both cases.
3. **SDSCE vs the official Substreams DS: merge or coexist?** Q3 2026 is the official slot. The
   conversation with juanmardefago and StreamingFast should happen before we spend the one scarce
   resource we have on auditing a contract that might be superseded.
4. **Entity: form or partner?** G-3 gates two workstreams and has no engineering workaround.
5. **What is the actual Dispatch provider count?** Documented as one, claimed as two. Trivial to
   resolve and it is the load-bearing counter-example to the one-provider problem.

---

## Caveats

- Status is as of **2026-08-28**. Foundation roadmap language is forward-looking. **GIP-0089**
  (20% of issuance, 24.146 GRT per block, to the Innovation Allocation, live **2026-08-31**) and
  **GIP-0086** (Rewards Manager + Subgraph Service upgrade, passed unanimously) are ratified.
  **GIP-0087 / GIP-0088**: the contracts are deployed and configured on Arbitrum One as of
  2026-08-28, with the agreement allocation set to zero. Treat the *contracts* as fact and the
  *split* as pending governance.
- Horizon went live **2025-12-11**. Its payment stack is reused unchanged by every service here,
  which is why a roughly 60-line contract delta stands up a new data service.
- **REO** (GIP-0079) reclaims the 15.2% of 2025 indexing rewards that went to inactive indexers.
  The bar is one valid query (HTTP 200, under 5000 ms, within 50,000 blocks of chainhead) on five
  separate days in a rolling 28-day window, eligibility expiring after 14 days. ❓ At activation,
  49 of 97 indexers met it. Nearly half the network is ineligible, and that pool is exactly what
  DIPS and new data services must re-activate.
- **"Community" here is substantially one team.** GRC-005 through GRC-009, Dispatch, Mainline,
  compass, Seahorn, SDSCE, Lodestar, gib and nuthatch all trace to one operator. That is precisely
  why G-1 recurs in every workstream and is listed first.
- This document carries no effort or cost estimates by design. See
  [How to use this file](#how-to-use-this-file). The two things that cannot be done for free are
  the external audits (G-2) and recruiting an independent gateway operator (G-1); SOC 2 in CAT-8
  is a third of the same kind.

---

## Changelog

- **2026-08-28**: CAT-1 observability shipped. `dips-nest` live on Helsinki, DIPS panel live on
  the homepage.
- **2026-08-28**: CAT-1 started. Found the whole DIPS contract stack live on Arbitrum One with the
  agreement allocation set to zero, which unparks `plans/on-chain-indexing-agreements.md` (its
  trigger had fired five months earlier, unnoticed) and unblocks the observable half of CAT-1.
- **2026-08-28**: created. Ground-truth pass against `gib`, `dispatch`, `SDSCE`, `compass`,
  `seahorn` and Arbitrum One. Corrected three claims from the source research report: the
  `nightswatchhq` org is fully public, Seahorn is deployed on mainnet, and the Dispatch address in
  circulation is a superseded implementation rather than the live proxy. Established that the
  2026-04-15 Dispatch audit targets a since-deleted contract and that two of its three High findings
  no longer apply.
