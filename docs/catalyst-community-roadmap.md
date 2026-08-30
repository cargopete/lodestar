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

## Operating model: we develop, we do not operate

**Decided 2026-08-28.** The Night's Watch builds these services. It does not run them.

Running a data service means a box, a domain, a bill and an on-call rota, indefinitely, per
service. That is a different business from writing the software, and it is the one we are not in.
The 20 July outage is the evidence: three services quietly stopped serving and nobody was watching,
because nobody's job was watching.

**The single exception is a nuthatch data service**, because we already run nests on the VPS and
the marginal cost is close to zero. Everything else ships as a **reference implementation that any
willing provider or indexer can run**.

### What this changes

Several definitions of done assume we operate. They do not stop being the right definitions, but
the last stretch of each now belongs to a third party rather than to us:

| Workstream | Needs an operator we are not going to be | Our reachable ceiling |
|---|---|---|
| CAT-2 | "settles a paid query", "one external operator runs it" | build + document, not demonstrate |
| CAT-4 | "≥1 live provider serving a real Substreams package" | audited contract + provider kit |
| CAT-5 | "≥10 providers across ≥3 regions" | re-audited contract + client compat + tooling |
| CAT-7 | "one chain routing real revenue through the protocol" | contract + metering + dashboard + runbook |
| CAT-8 | SOC 2, SLAs, an institutional design partner | ground-truth + attestation service |

This is not a retreat, and it should not be written up as one. A reference implementation somebody
else runs is the *stated goal* of four of these eight items, which exist to be adopted rather than
operated by us. What changes is the honesty of the scoring: **we should stop counting adoption we
have decided not to pursue as work outstanding on our side.**

### Parked, deliberately

- **Restoring Dispatch, Seahorn and Camp as running services.** Their contracts stay live on
  Arbitrum One and the code stays maintained. The endpoints stay down until a provider wants them.
  The catalogue says so plainly.
- **Funding escrow for the gib payment loop.** No further GRT is going in. The loop stays built and
  unproven until an operator with funds runs it. `gib onboard` exists precisely so that operator's
  first hour is not wasted.

Both are open to **any willing provider or indexer**, which is the actual ask, and a better one
than it looks: it is the same ask as G-1, and it now has no competing story in which we quietly do
it ourselves.

---

## Scoreboard

| WS | Item | Source ref | 08-28 open | **Current (08-30)** | Community ceiling | **Our ceiling** | Primary asset |
|---|---|---|---|---|---|---|---|
| CAT-1 | Studio continuity via DIPS | RFC-001 | 40% | **65%** 🔺 | 90% 🔒 | ~65% | dips-nest, weaver |
| CAT-2 | New gateway operators | RFC-002 | 60% | **64%** | 95% | ~75% | gib |
| CAT-3 | Memory for AI | RFC-003 | 22% | **74%** 🔺 | 90% 🔒 | ~75% | nutcracker, compass |
| CAT-4 | Substreams data service | RFC-004 | 58% | 58% | 95% | **~65%** 🔻 | SDSCE |
| CAT-5 | RPC service | RFC-005 | 62% | **50%** 🔻 | 95% | **~60%** 🔻 | Dispatch |
| CAT-6 | Multi-product Studio | RFC-006 | 45% | **60%** 🔺 | 90% | **~70%** 🔻 | Lodestar |
| CAT-7 | Chain integrations DS | RFC-007 | 6% | **48%** 🔺 | 85% 🔒 | **48%** 🔻 | chain-integration-ds |
| CAT-8 | Institutional audit layer | RFC-008 | 5% | **30%** 🔺 | 80% 🔒 | ~45% | tattler |

The second column is **live, not a snapshot**. It said "08-28 close" for two days after CAT-3 and
CAT-8 moved on the 29th and 30th, which is a small lie of exactly the kind this document exists to
catch elsewhere. Anyone changing a number changes the date in the header with it.

**"Our ceiling"** applies the operating-model decision above: the highest score reachable without
running a service or signing a commercial deal. These are judgement calls to one significant
figure, not measurements — their job is to stop us recording adoption we have decided not to pursue
as work outstanding on our side. CAT-6 is unchanged at 90% because Lodestar is the one thing we do
run.

**CAT-7: 6% → 35%.** The engineering that was at zero this morning is largely done —
[chain-integration-ds](https://github.com/nightswatchhq/chain-integration-ds) has the contract,
16 tests, the design note, the integrator runbook and a deploy script. It does not move further
because **nothing is deployed and nothing has ever collected**, and because this item's own risk
note says it "is more a business-model/governance problem than an engineering one": the
value-capture policy, which is most of what CAT-7 *is*, remains Council's and untouched. Finishing
the code does not move this as far as finishing code usually does.

🔒 marks an item whose last stretch is protocol or Foundation policy and cannot be engineered
around from outside.

### Four ceilings re-cut downward (2026-08-30)

The "our ceiling" column already assumed we would not **operate**. It still quietly assumed three
other things that the 30 August decisions removed: that we would **buy an audit**, **hold an entity**
that can take payment, and **deploy** a service we have said we will not run.

| | was | now | what it was assuming |
|---|---|---|---|
| CAT-4 | ~75% | **~65%** | "audited contract + provider kit" — the audit costs money we are not spending |
| CAT-5 | ~70% | **~60%** | "re-audited contract" — same |
| CAT-6 | 90% | **~70%** | subscription billing with paying users, which needs an entity |
| CAT-7 | ~50% | **48%** | that we would deploy it; we will not, so 48% *is* the ceiling |

Headroom shrinks and that is the point. A ceiling describing what we might reach if we became a
different organisation is not a ceiling, it is a wish, and the column exists precisely to stop
recording somebody else's work as our own outstanding tasks. CAT-1, CAT-3 and CAT-7 now sit **at**
their ceilings, and three of the four re-cuts are within ten points of theirs.

What that leaves as genuinely ours to move: CAT-2 (64 → ~75), CAT-6 (60 → ~70), CAT-8 (30 → ~45).

### CAT-3 marked DOWN, 74% → 68% (2026-08-29)

The second number today to move backwards after somebody went and checked, and like the Dispatch
correction it is the more useful kind of movement.

nutcracker's published recall figures — 100% at 0.2 perturbation, 94% at 0.5, ~3% false candidates —
are correct, and they characterise the LSH scheme fairly. They were measured against **uniformly
random vectors**, and transformer embeddings are not that: they crowd into a narrow cone. Re-running
the identical index against that geometry (`--example geometry`) gives **26% false candidates at
realistic anisotropy, not 3%**, and at severe anisotropy the index degenerates entirely — every item
matches every query, which reads as 100% recall and is the scheme telling you nothing. The
false-candidate rate *is* the leakage: each one is an item the provider is asked for and learns was
a candidate.

Mean-centring the embeddings fixes it and restores the uniform-sphere baseline exactly, at the cost
of a mean that must stay fixed for a namespace's lifetime. Not yet implemented.

And separately: 0.05 perturbation is a near-duplicate. On loosely clustered data — related but not
nearly identical, which is what semantic search actually means — recall at the default parameters is
about **28%**, not 94–100%.

Nothing is broken and no claim was dishonest. But half the product is semantic recall, that half has
never been measured against a real embedding model, and the agent binary still ships a bag-of-bytes
placeholder embedder. 74% described a system whose retrieval quality was assumed; 68% describes one
where it is an open question with numbers attached. Written up in nutcracker's README under *What
the recall numbers actually measured*.

### CAT-7: the contract could not be paid at all. 35% → 40% (2026-08-30)

`ChainIntegrationDataService` calls `RECURRING_COLLECTOR.collect(...)` and **never called
`accept()`**. Per this morning's weaver work, `accept()` is callable only by the data service an
agreement names, so an RCA written for this contract could be accepted by nobody: not the payer who
signed it, not the integrator who benefits, not any third party. `collect()` could therefore never
succeed, and the sixteen passing tests were silent because they ran against a mock whose `collect()`
returned a number and modelled no rule at all.

Established against the **deployed** collector on Arbitrum Sepolia rather than argued: the payer is
refused, every third party is refused, and the named data service succeeds. The capability existed
the whole time and the contract could not reach it.

`acceptAgreement()` closes it, permissionless on purpose - the payer's signature *is* the
authorisation and the collector checks it, so demanding a particular caller would add a second party
who must act before a payer's own intention takes effect and would buy nothing. The mock now
enforces the one rule that matters, so the omission cannot recur quietly. 19 unit tests, 4 fork
tests.

**Then the rehearsal was done, and it found a second fatal defect. 40% → 48%.**
`test/ForkPaid.t.sol` deploys against the real Controller and collector, stakes, provisions,
registers, accepts, funds escrow and collects. The first run reverted with
`RecurringCollectorInvalidCollectData`: `collect()` encoded **four fields against a six-field
`CollectParams`**, missing `collectionId` and `maxSlippage`. Every real collection would have failed.

The unit tests were green because `MockRecurringCollector.collect()` stored the calldata **without
decoding it**, so literally any encoding passed. The mock now decodes exactly what the real collector
decodes.

**Two fatal defects in one contract, both invisible to sixteen passing tests**: no accept path, and a
malformed collect payload. The contract is now paid end to end against deployed contracts, with the
integrator's balance asserted to rise. 48% rather than the 50% ceiling because nothing is deployed
and nothing has collected outside a fork.

That is also the evidence behind the new **Step 5b** in `horizon-skills`: a fork rehearsal is now a
required step, because `forge test` against a mock establishes the arithmetic and nothing whatever
about the counterparty.

**And the incidental finding worth carrying:** `collect()` was listed all day as blocked on funded
escrow. That blocker is only real for a broadcast. On a fork, escrow can be funded with cheatcodes,
which is how this was reached at all - and the same trick is available to CAT-1's outstanding
`collect()`.
### Decisions taken, 2026-08-30

Chief answered the open list. Recording them here because a decision nobody wrote down gets
re-litigated, and because several of them change what "our ceiling" means rather than what is built.

**We build, we do not operate — and now we say so as an offer.** Dispatch, Seahorn, Camp, SDSCE,
WSaaS and Mainline are finished, deployed, and unclaimed. The catalogue said "endpoint down", which
was the wrong words: nothing is down, nothing was ever brought up. They now read **"Ready · awaiting
an operator"** with a standing call to indexers on `/data-services`. A stat card claiming "four
Lodestar services live" was describing an arrangement already retired by decision, and is corrected.

**gib's payment loop is not ours to close.** It is the highest-value item on the board and it stays
open: we are gib's maintainers, not its users. An external operator drives it, or nobody does.

**chain-integration-ds will not be deployed by us.** It passes a full fork rehearsal ending in the
integrator being paid; that is as far as we take it. Local and testnet verification is the ceiling
for a service we will not run.

**Legal and entity items are advisory only.** SOC 2, the prepaid-GRT gate, SLAs, external audits: we
publish what a body that *has* an entity should do, and we do not acquire one. Those items are
recommendations in this document, not tasks, and the ceilings reflect it.

**x402 is adopted.** The line is crossed deliberately and we use it wherever it fits. RFC-0046 in
nuthatch recorded the governance question; it is answered. The seller code is built and tested and
now has a decision behind it rather than a caveat.

**No slashing.** Dispatch's `ROADMAP.md` was right and the research report was wrong: EIP-1186 and
slashing stay out of scope, and the public messaging should stop implying otherwise.

**No action on:** the Vindicate domain, nuthatch's progress log, the WSaaS test filename, PR #967.

### The payment-path sweep, which found nothing (2026-08-30)

After two fatal defects in `chain-integration-ds`, the obvious question was how many siblings share
them. Checked: **Seahorn, Camp, FHSCE, WSaaS**, plus SDSCE and Dispatch.

All clear, and the reason is worth recording rather than the result alone. Both defects were
specific to **`RecurringCollector`**, whose `CollectParams` is a six-field struct and whose
`accept()` may be called only by the data service an agreement names. Every other service settles
through **`GraphTallyCollector`**, which decodes a three-tuple `(SignedRAV, dataServiceCut,
receiverDestination)` and has no accept step - and all four encode exactly that. SDSCE has its own
anvil fork rehearsal reconciled to the token; Dispatch is proven by 18.44 GRT settled on mainnet.

So the base rate is better than a one-in-two sample suggested, and the risk concentrates where the
counterparty is most complex. One cosmetic leftover: WSaaS's only test file is named
`CampDataService.t.sol` from a copy, though the contract inside is `WebSocketDataServiceTest` and
tests the right thing.

**A negative result recorded on purpose.** "We checked and found nothing" is evidence; leaving it
unwritten means the next person re-runs the sweep or, worse, assumes it was done.

### CAT-3: measured, then given a real embedder. 68% → 72% (2026-08-30)

Yesterday's mark-down said the retrieval half had never been measured against a real embedding
model. Now it has: 48 sentences over 12 topics through `nomic-embed-text` (768-dim) on the ThinkPad,
same-topic pairs deliberately not near-duplicates, corpus committed so the numbers reproduce without
a GPU.

The synthetic argument was a fair predictor. **Unrelated sentences sit at cosine 0.43**, and at the
default parameters the blind index retrieves **46% of related pairs while surfacing 22% of unrelated
ones** as candidates. Published figures were 100% recall and 3% false.

The finding the synthetic work missed is that the two columns move together, and there is no setting
that buys both: 100% recall costs 96% false candidates, which is asking the provider for nearly the
whole corpus and calling it a search. Mean-centring cuts disclosure to 3% and costs recall down to
17%, worse than predicted, because on real embeddings part of the topical signal genuinely lives
along the shared direction.

**Held at 68% for the measurement alone.** Resolving an uncertainty is not an improvement, and
moving the number for having audited it would be rewarding the audit rather than the artefact.

**Then 68% → 72%, for replacing the placeholder.** The agent binary shipped a bag-of-bytes embedder
- a histogram of byte values, not a semantic model - and now runs `nomic-embed-text` through a local
Ollama by default. That is the difference between search and coincidence, and it is the largest
single gap the project had.

Three refusals came with it, each a refusal rather than a warning, and each closing a way to destroy
the product silently:

- **A non-loopback embedder is refused.** An embedder sees the plaintext *before* it is sealed, so a
  remote one hands every memory to a third party in the clear and leaves the encryption decorating
  the trip afterwards. One config line. The override is named
  `--i-accept-sending-plaintext-to-a-remote-embedder`, for what it costs rather than what it enables.
- **Changing the model is refused.** Two models are two disjoint token spaces over the same
  memories: swap one and everything stored before becomes unfindable, everything after looks fine,
  and nothing errors. The model is recorded beside the key and checked at every start.
- **A failing embedder is refused, never fallen back from**, because a fallback returns vectors from
  a different space and corrupts the index quietly. It probes at startup rather than failing inside
  somebody's conversation.

All four paths driven against a real Ollama. One of them looked like a bug in the guard and was a
bug in my test: `pkill` missed the tunnel because the real process args carried a `-f` I had not
matched, so the embedder was still up and the probe was right to pass.

### A correction I owed, and a design decision it changed (2026-08-30)

For two days this tracker and nutcracker's README described the blind index's false-candidate rate
as "the leakage". **That is wrong, and the original code said so before I overrode it.** A false
candidate is *bandwidth*: the client fetches an item, decrypts it, ranks it and discards it, and the
provider learns nothing it did not already know from the bucket token. The per-item disclosure is
`bits/item` = bands x bits, and the two move in **opposite** directions. If anything a higher false
rate helps query privacy, because it is cover: the provider cannot tell which candidate you wanted.

Reading the sweep correctly reverses the recommendation. Fourteen parameter settings, centred and
not, on the real corpus; a point is dominated when another beats it on recall *and* cost at once.
**11 of 16 frontier points are centred**, so centring moves the frontier rather than sliding along
it. But the point to adopt is not the one with the lowest candidate rate:

| | recall | candidates | **bits/item** |
|---|---|---|---|
| as-is 8x8 *(today's default)* | 46% | 22% | **64** |
| **centred 8x4** | **67%** | 36% | **32** |
| centred 24x8 | 42% | 9% | 192 |

`centred 8x4` gives half again more recall at **half** the per-item disclosure. The third row is the
trap: chasing the 9% candidate rate triples disclosure to buy *less* recall than the default, which
is paying on the expensive axis to optimise the cheap one. That is precisely what my earlier framing
would have recommended.

**Then implemented, because the migration turned out not to exist.** I had assumed twice that the
mean is a property of a corpus and must be frozen per namespace. Assumed, not tested, and wrong: two
disjoint 48-sentence corpora on unrelated topics produce means pointing the same way, `cos = 0.939`.
Centring corpus B by corpus **A's** mean takes its anisotropy from 0.420 to 0.048, and through the
index at 8x4 turns 88%/70% into **81%/45%** on a corpus the mean never saw.

So it ships as a **per-model constant** and an index is stable from its first item. Revising that
constant *would* be a migration, so it is versioned into the embedder identity (`+centred-v1`) and
the manifest check written earlier refuses a mismatch, with no second mechanism to keep in step. The
manifest now also records `bands x band_bits`: a token is that many hyperplane signs, so changing
the shape breaks an index exactly as changing the model does, and guarding one without the other
would have left the same trapdoor open under a different label.

**And that guard immediately earned itself, on my own mistake.** Centring shipped while the default
was still 8x8, and *centred 8x8 gives 17% recall* against the uncentred 46%. For about an hour the
released configuration was worse than the one it replaced, because two halves of one decision were
treated as two decisions. The default is now centred 8x4 (67% recall, 32 bits/item), pinned by a
test that says a change needs a newer measurement than the one in the repo. Anyone who indexed
during that hour gets a refusal naming both shapes rather than a silently broken index, which is the
only reason this was an inconvenience rather than an incident.

**CAT-3 stays at 74%**, which is where it was put an hour ago on the strength of centring shipping.
That number described the intended state; for an hour the actual state was worse. It is now the
state described.

### Watching the thing everything else stands on (2026-08-29)

Eighteen crons existed and **not one watched the Helsinki box**, which answers the delegation feed,
developer activity, the DIPS panel, the Lodestar Oracle, the SQL surface and the named-query tier.
On-chain checks cannot see it, and `/health` returning "ok" would not either: the failure worth
catching is a nest that answers instantly with three-week-old data, where every page renders and
every number is quietly wrong. `check-nest-health` now asks each nest's own `/ready` every fifteen
minutes, edge-triggered like the provider check so a nest that is dark for a week does not push
every quarter hour until everyone mutes it.

**It found something on its first real probe, before it shipped.** `legacy-flows` reports
`stalled: true` with `last_block: 0` and no poll ever recorded. That turned out to be correct and
deliberate — it is `graph-staking-legacy-readonly.service`, a frozen full-history shadow running
`nuthatch serve` rather than `dev` — but two things followed. Archival nests are now excluded from
alerting, or the monitor would have cried wolf from day one and taken the next real outage down with
it. And `/sql` now says so: an archive sitting beside three live datasets with nothing to
distinguish it invites a reader to take three-week-old data for current, which nobody had noticed
because nobody had looked.

**Mean, as of 2026-08-30: 56.1%**, against 37.2% when this tracker was opened on 28 August. The
section below is the 28 August retrospective and its figures are that day's, kept as written.

### Why the needles barely moved, and why one went backwards (28 August)

The mean closed at **40.5%**, from 37.2% at the start of the day. Almost all of that is CAT-7, and
the rest of the day was flat or negative. That is the correct result and worth reading rather than
explaining away.

- **CAT-1 +5.** `dips-nest` is live on Helsinki, the DIPS panel is on the homepage, and an alert
  fires when the allocation moves. Real work, but none of it is in the 90% definition of done,
  which is about *funding* agreements, not watching them. Observability buys position, not
  progress.
- **CAT-2 +4.** The QoS publisher's aggregation half is built and tested; `gib onboard` ships. But
  the three things the DoD names — settle a paid query, publish QoS, one external operator — are
  all still at zero. The remaining halves of both tasks need a funded key.
- **CAT-5 −12.** 🔻 The only honest direction. Three genuine improvements landed (audit re-scoped
  with H-1 disproved by PoC, sticky sessions fixed, liveness probe shipped) and they are outweighed
  by discovering the service **has not served a request in 39 days**. 62% described a codebase;
  50% describes a codebase whose operation is at zero. A reasonable person could argue lower.
- **CAT-7 +29.** The one real jump, and it came from a workstream that was at 6% because nobody
  had started it. A day's work on genuinely greenfield engineering moves the number far more than a
  day's work on something already 60% done — which is an argument about where to spend tomorrow,
  not a claim that today was 29 points of value.
- **CAT-3, 4, 6, 8 unchanged.** Nothing was done on them, so nothing moved.

**What actually changed today was the quality of the numbers, not the numbers.** This morning the
scoreboard was a research report's estimates. Tonight several rest on evidence, and three of those
turned out worse than assumed: the Dispatch audit was stale, three services have live contracts and
dead endpoints, and Arbitrum One Standard has two providers so its three-way quorum cannot form.
One turned out better: the DIPS rails are armed and one governance transaction from live.

The uncomfortable reading is that **percentage against a definition of done is the wrong instrument
for a stack whose failure mode is silent decay.** Nothing in these eight numbers would have moved
when Dispatch went dark on 20 July. That is what G-1's liveness gate is now for.

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

- [x] ~~❓ **Dispatch provider count.**~~ Resolved 2026-08-28 from chain, not from the subgraph:
      **two independent providers, both registered and both serving.** `0xb43b2ccc…`
      (`rpc.cargopete.com`) with 5 active chain registrations, `0x575267ee…` with 2. Repo docs
      corrected. **But note:** both serve Arbitrum One Standard and nobody else does, so the
      busiest lane has two providers and a three-way quorum cannot form there. Any claim about
      quorum-verified responses on Arbitrum One is currently false.
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

**2026-08-28 second amendment: three of our services are down, not one.** The sweep that followed
the Dispatch outage found **Seahorn** and **Camp** in the same state: contract live on Arbitrum
One, advertised endpoint not answering, no process/container/unit/directory on either host. All
three carried green "Live · Production" badges. The control is `nuthatchds`, on the same box, which
answers a healthy `402 TAP-Receipt header required` — so the host and its proxy are fine and this
is per-service rot, not an infrastructure failure. **SDSCE** and **WSaaS** also claim
"Live · Production" but advertise no endpoint at all, so nobody can check them; SDSCE's own README
says it is "not usable end-to-end until at least one provider self-onboards", which contradicts
the catalogue. Write-up:
[`dispatch/docs/outage-2026-08-28.md`](https://github.com/nightswatchhq/dispatch/blob/main/docs/outage-2026-08-28.md).

**2026-08-28 amendment: the risk is worse than one provider.** Dispatch had two registered
providers and zero serving ones for 39 days without anyone noticing, because everything we monitor
is on-chain state and on-chain state stayed green throughout. `isRegistered()` returning true says
nothing about whether an endpoint answers. **Add liveness to this gate:** a provider that does not
respond to a real request is not a provider, however healthy the registry looks.

Every data service in this stack has a provider list that reads "us". A data service with one
provider is a contract address, not a market.

- [ ] Set an explicit **quarterly gate**: any service that has not gained a second *independent*
      provider by quarter end stops feature work and spends the next quarter on recruitment.
- [x] Publish a live provider count per service on Lodestar so the number is embarrassing in public
      rather than privately known. **Done 2026-08-28** for Dispatch: `/api/provider-liveness` reads
      the registry from chain, calls every endpoint it advertises, and the data-services page shows
      "registry vs reality" beside the hand-written catalogue text. Currently reads **0/2
      answering**. A cron every 15 minutes alerts on transitions only, seeding silently on first
      run so a 39-day-old outage is not announced as news. Extend to the other services next.
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

**40% → 45% → 90% (100% 🔒).** The *observing* half shipped on 2026-08-28: `dips-nest` and a live
homepage panel.

**Correction, 2026-08-29: the participating half was never blocked on CAT-2's payment loop.** That
claim came from the source report and I carried it without checking. gib's payment loop is
GraphTallyCollector **query fees**; DIPS indexing agreements settle through **RecurringCollector**,
a different contract with a different path. `accept()` is, in its own words, *"callable by the data
service the RCA was issued to"*, authorised either by an EIP-712 signature from the payer or by an
offer the payer stored on-chain. No gateway is involved at any point.

What participating actually needs is a payer with funded escrow — which is the same
"we do not operate" answer, not a software blocker — and **the tooling to construct, sign, accept
and collect against an agreement, which is pure software and can be built and exercised end to end
on Arbitrum Sepolia**, where `RecurringCollector` (`0x0b18befc…`) and `RecurringAgreementManager`
(`0x590dbbbd…`) are both deployed and gas is free.

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
  - [x] Alert on the split changing. It is the starting gun for the rest of this workstream.
        `/api/cron/check-dips` every 10 minutes, reading the nest directly so the API route's
        5-minute cache cannot mask the event. Two triggers: `dips_live` (allocation above zero,
        fires once ever) and `dips_config` (a new configuration step past the watermark). **The
        first run seeds silently** — the timeline already holds six steps from 23 July and 25
        August, and announcing those as news would be a false alarm about history.
  - [ ] Watch for `InnovationAllocation` appearing in the mainnet address book (GIP-0089, due
        2026-08-31); it is on Sepolia only today.
- [x] **Agreement tooling: [nightswatchhq/weaver](https://github.com/nightswatchhq/weaver).**
      13 Rust tests and 10 Foundry fork tests. Builds, hashes, signs and checks Recurring
      Collection Agreements — the actual
      GIP-0087 path, replacing the "Dipper client in the gateway" task below, which was written
      against GIP-0081's off-chain MVP and involves a gateway that DIPS does not use.
  - [x] **The EIP-712 hashing is checked against the deployed contract**, not against a reading of
        the spec: the test asserts our digest equals what `hashRCA()` returns on
        `RecurringCollector`. Mutation-tested twice — inlining `bytes metadata` instead of hashing
        it, and swapping two adjacent same-width fields, each make it fail. A wrong EIP-712 hash
        produces a perfectly valid, entirely useless signature and an on-chain revert carrying
        nothing.
  - [x] `sign` refuses when the key is not the payer the agreement names; `verify` exits non-zero
        on a mismatch. Both turn an opaque revert into an obvious mistake before gas is spent.
  - [x] **`accept()` exercised against the deployed contract on Arbitrum Sepolia.** Eight fork
        tests against `RecurringCollector` at `0x0b18befc…`: the happy path, and six ways it is
        meant to fail. A fork rather than a broadcast, because the faucet is behind a captcha, and
        because a fork is deterministic and runs in CI. Nothing is mocked; the contract under test
        is the deployed one with its real code and storage.
  - [x] **Found and fixed: a payer must authorize their own key before signing anything.**
        `Authorizable._isAuthorized` requires `authorizations[signer].authorizer == payer` and does
        **not** special-case signer == payer. So a payer's own perfectly-formed signature over
        their own agreement is rejected with `RecurringCollectorInvalidSigner()`, an error that
        blames the signature and points at nothing. `weaver authorize-proof` now produces the
        `authorizeSigner` proof and the `cast send` to go with it. Note the mixed conventions: the
        agreement is EIP-712, the proof is a plain `eth_sign`. Getting the wrong one gives bytes
        the contract rejects without saying why. The CLI's output is pasted verbatim into a fork
        test that sends it to the real contract, so the Rust encoding is checked against deployed
        bytecode rather than against a reading of the source.
  - [x] The negative tests assert **specific** revert selectors. A bare `vm.expectRevert()` passes
        for any reason at all, including the one the test exists to rule out, which is how the
        authorization requirement survived a green run.
  - [x] **`collect()` end to end, and the blocker was not what it said.** "Needs funded escrow" is
        true of a *broadcast* and false of a fork: `deal` mints GRT and the provision and deposit are
        then ordinary calls to the real contracts. `ForkCollect.t.sol` runs the whole path against
        deployed Sepolia - authorise, sign, accept, stake, provision, fund escrow, warp, collect -
        and asserts the service provider's balance goes up. Nothing mocked.
    - [x] The **provision** is what makes a data service payable: `_collect` requires
          `getProviderTokensAvailable(serviceProvider, dataService) > 0`, the guard against a
          signer-as-data-service draining escrow. Tested for specifically.
    - [x] The thawing period is capped at ~2,418,000 seconds, so 30 days is refused by a custom
          error carrying two raw numbers and no name.
    - [x] **Two Sepolia addresses in our own skill were implementations, not proxies** - and calling
          an implementation returns zero from uninitialised storage rather than reverting, so a
          service built on one reads zeros forever. Corrected in `horizon-skills`; this test
          resolves from the Controller and asserts code size instead of trusting a table.

**CAT-1 is now at its ceiling.** What is left is a governance parameter (the DIPS allocation is
still zero) and running managed pipelines, which is the operating we have decided against.
- [ ] ~~**Dipper client in the gateway.** Extend gib to speak the GIP-0081 agreement flow.~~
      Superseded: see above.
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
- [ ] **QoS publisher.** *In progress: the aggregation half is built and tested.*
  - [x] Ship the doc-08 publisher's aggregation: `gib/qos-publisher/`, a Rust crate taking the
        gateway's Kafka stream to the oracle's two 5-minute JSON arrays. 18 tests over bucketing,
        statistics, CIDv0 encoding and error attribution; `--dry-run` only.
  - [x] **Correction to doc 08:** do not map the protobuf's `gateway_id` onto the oracle's. The
        gateway fills it from `graph_env_id`, which gib templates as `gib-${CHAIN_ID}`, so every
        gib operator would publish under `gib-42161`. The publisher takes `--gateway-id` separately.
  - [ ] IPFS pin + DataEdge post. Needs a funded poster key holding a little xDAI, and an unpinned
        payload is a permanent hole in every consumer's history rather than a retryable failure,
        so this is deliberately not half-built.
  - [ ] Wire into Lodestar's scoring.
  - [ ] Align with GRC-009 "The Lodestar Oracle" so gib and REO consume the same signal.
- [ ] **Onboarding automation.** *In progress.*
  - [x] `gib onboard`: a pre-flight that produces the indexer's paste block **only if it would
        work**, and refuses otherwise. Catches the failures that are invisible to the operator and
        expensive for the indexer: a loopback, private-range or Compose-service aggregator URL that
        resolves for you and nobody else; an aggregator advertising a different EIP-712 domain than
        the gateway that signs (a reverse proxy on the wrong port passes every other check and
        fails every receipt); and collector/subgraph-service drift from `config/addresses.env`.
        Plain `http` warns rather than blocks. 9 tests, `--profile onboard` in compose.
  - [ ] Per-indexer escrow funding automation (needs funds).
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

- [x] **`MemoryDataService.sol`.** Done 2026-08-28:
      [nightswatchhq/nutcracker](https://github.com/nightswatchhq/nutcracker). 15 tests.
      **The plan said "registry keyed on memory-namespace rather than subgraph deployment". Do not
      do that.** A public registry of namespaces leaks who keeps memory, with which provider, how
      much, and since when — permanently, against an address. The registry is of **providers,
      never of users**; namespaces never touch the chain. There is a test named for it.
  - [x] Providers can declare "I have stopped serving" without deregistering. The signal a registry
        usually lacks, and the one whose absence made three of our own services look healthy for
        39 days.
  - [x] Per-operation usage counters, monotonic. Self-reported and unprovable, recorded anyway so a
        provider's forget-to-write ratio is a public number — the only observable a user has that
        deletion happens at all.
- [x] **The design, which is where this workstream actually is.**
      [`docs/design.md`](https://github.com/nightswatchhq/nutcracker/blob/main/docs/design.md).
      **The brief contains a contradiction nobody has named:** end-to-end encryption and semantic
      recall do not compose. `memory.search` means comparing a query against stored memories; E2E
      means the provider cannot read them. Every product claiming both gives one up, and the usual
      casualty is the encryption — storing plaintext embeddings beside the ciphertext, when
      embeddings are not one-way and a provider holding `(blob, vector)` holds an approximate copy.
      Three real options are worked through; the default is a **blind index over coarse buckets
      keyed per namespace**, leakage bounded and tunable. Plaintext-vector mode must be *named* at
      write time and voids the E2E claim for that namespace.
  - [x] Key hierarchy settled: user root → namespace key → per-item content key. Three layers
        because revocation must not mean re-encrypting everything, or nobody ever revokes.
- [x] **Client crypto: envelope encryption + the keyed blind index.** `crates/nutcracker-crypto`,
      17 tests, standard RustCrypto primitives only (XChaCha20-Poly1305, HKDF-SHA256, HMAC-SHA256)
      — nothing invents a construction, and it is marked unreviewed.
  - [x] Three-layer envelope. Rotation rewraps content keys and **leaves ciphertext untouched**,
        with a test asserting exactly that; a two-layer scheme means re-encrypting everything on
        revocation, which means nobody revokes.
  - [x] Item id bound as AEAD associated data on both layers, so a provider cannot answer "give me
        item X" with a relabelled item Y.
  - [x] Keyed SimHash + banding. The privacy property has a test: **the same vector in two
        namespaces produces zero shared tokens**, so a provider cannot correlate users.
  - [x] **Measured, not asserted.** `--example leakage` prints recall against distance: 100% at
        0.2 perturbation, 94% at 0.5, 73% at 0.8, 48% at 1.2, with ~3% false candidates at the
        default. Near-duplicate recall is easy and is not semantic search; the honest number is the
        bottom of that table.
- [x] **Server-side store.** `crates/nutcracker-store`, 15 tests. Opaque ciphertext grouped by an
      opaque namespace handle, searched by bucket token, ranked by shared bands with a
      deterministic tie-break. Postgres DDL + the search query in `schema.rs`.
  - [x] **The type signatures are the enforcement:** there is no way to hand this store a plaintext
        even by accident, because no function accepts one.
  - [x] A schema test asserts no column can hold a user, a namespace name, a plaintext or an
        embedding — and it caught its own first draft, which flagged the legitimate
        `'plaintext_vectors'` enum value and had to be rewritten to check columns rather than
        substrings.
  - [x] Namespace handle derived from the root key and the name, **stable across key rotations** —
        a rotating handle would orphan every stored item on revocation.
  - [x] Capacity, expiry/GC, and `is_e2e()`: one plaintext-vector item voids the end-to-end claim
        for the whole namespace, and removing it restores it. A claim that cannot become false is
        not a claim.
- [x] **MCP memory tools.** `crates/nutcracker-agent`, 9 tests. **The plan said "over compass's
      Streamable HTTP surface", i.e. hosted at the provider. That cannot be end-to-end encrypted.**
      If the agent speaks MCP straight to the provider, either it sends plaintext and the provider
      has it, or the *agent* holds the root key — and "the agent" means Claude, or Cursor, or
      whatever the user runs next month. So the MCP server is **local**: the agent gets
      `memory.write("we chose postgres")` over localhost, the provider gets sealed bytes and bucket
      tokens over HTTP.
  - [x] `the_provider_never_receives_the_plaintext` checks every byte that crossed the boundary for
        any 6-byte fragment of the secret, and was **mutation-tested**: sabotaging the shim to send
        plaintext makes it fail, restoring it makes it pass. A first draft of that test did not
        assert what its name claimed and was rewritten.
  - [x] Search without a local embedder **refuses** rather than quietly shipping the query
        somewhere to be embedded.
  - [x] Candidates that will not decrypt (wrong key generation) are skipped rather than surfaced as
        rubbish.
- [ ] **Client SDK + harness integration.** A drop-in memory provider for one agent framework.
- [x] **A runnable provider.** `crates/nutcracker-provider`, axum over the sealed store, 12 tests.
      `cargo run -p nutcracker-provider` starts one; `--example http_roundtrip` seals a memory
      locally, writes it over HTTP, searches by blinded bucket tokens and decrypts what comes back.
      **Proven end to end over real HTTP, not mocked.**
  - [x] The wire format has a test asserting it has nowhere to put a `text`, `key`, `embedding` or
        `vector` field.
  - [x] Anything that is not exactly `"blind"` is treated as the unsafe named mode, so a typo in
        `mode` fails closed rather than silently voiding a namespace's e2e claim.
  - [x] `DELETE` on a non-existent item returns 200 with `removed: false` rather than 404 — a 404
        would leak whether an item exists to anyone who guesses an id.
  - [x] Search limit clamped at 500: one request must not be able to ask a provider to serialise a
        whole namespace.
  - [x] Said plainly rather than implied: storage in this build is in-memory, and payment belongs in
        front of these handlers rather than half-built inside them.
- [x] **An MCP server an agent can be pointed at.** `nutcracker-mcp`, stdio, driven end to end in a
      real session: initialize → tools/list → two writes → a search that came back ranked. 61 Rust
      tests.
  - [x] **Found a gap between the design note and the code by running it.** The design says the
        client does the fine ranking; the code returned the provider's coarse bucket ordering
        untouched, so a real session surfaced an unrelated memory as a match. Now decrypts,
        re-embeds and ranks by cosine locally — 1.00 vs 0.89 in that session — with a test that did
        not exist until the session exposed the need for it.
  - [x] The key is read from a **file**, never a flag or env var: argv is world-readable on Linux
        via `/proc` and environment blocks leak into crash reports and child processes.
  - [x] The bundled embedder is a documented placeholder, and the docs say loudly that it must stay
        local — a remote embedding call ships the plaintext to a third party and undoes everything.
- [x] **First real user: it is installed and running on Chief's machine.** Provider under launchd
      on `127.0.0.1:8099` only, snapshotting to `~/.nutcracker/store.json`; registered with
      `claude mcp add nutcracker --scope user`. `docs/install.md` says what lives where and which
      file is catastrophic to lose.
  - [x] **Snapshot persistence**, because a provider that forgets everything on restart is a demo.
        Tests: an item survives a restart, a forgotten memory does not resurrect, the file on disk
        holds no fragment of the plaintext, and a corrupt snapshot is an error rather than a silent
        fresh start — starting empty looks identical to a provider that lost everything and did not
        mention it.
- [x] **Validated across two machines, which found a leak loopback never would have.** Provider
      built and running on the ThinkPad (Debian 13) under a systemd user unit, bound to the tailnet
      address only; the Mac's shim wrote to it over the network. All 65 tests, fmt and clippy pass
      identically on Linux and macOS.
  - [x] **The leak:** everything the remote provider held was opaque — ciphertext, bucket tokens,
        an unlinkable namespace handle — and beside it, in plain text, `item_id: "crossmachine"`.
        Default ids are content hashes so it only bites when a caller names one, and callers name
        things descriptively: `sofia-lease-renewal` would have told the provider everything the
        encryption was hiding, and would have passed every test that checked the *ciphertext*.
  - [x] **The fix:** the id a provider sees is a keyed hash, and the caller's own name is sealed
        **inside** the payload. Search recovers it on decrypt, so an agent still gets back the name
        it chose rather than a hash it cannot read or forget by. Two tests, one of which asserts no
        5-byte fragment of a descriptive id crosses the wire. The two items now sit side by side in
        the ThinkPad's store — `crossmachine` and `f173877361de6645e…` — which is the before and
        after in one file.
  - [x] The lesson, duller than the fix: **it is not enough to check that the secret is encrypted.**
        Everything travelling beside it is also a disclosure.
- [ ] **A drop-in provider for one agent framework**, and a Postgres-backed provider build. Both
      are packaging rather than design.
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

🔴 **NOT SERVING as of 2026-08-28.** Two providers are registered and active on-chain and **not one
advertised endpoint answers**: `rpc.cargopete.com` fails its TLS handshake, and the second
provider's two Railway endpoints return "Application not found". The gateway host has no dispatch
process, container, unit or directory on it at all; its reverse-proxy entry was dropped from the
Caddyfile on **2026-07-20**, so this has been down for 39 days. Full write-up:
[`dispatch/docs/outage-2026-08-28.md`](https://github.com/nightswatchhq/dispatch/blob/main/docs/outage-2026-08-28.md).

Score held at 62% pending a decision, not lowered: the contract, the registrations and the code are
all intact and the settlement path was proven historically. But **62% describes a service that is
not currently serving**, and no feature work in this section is worth anything until it is.

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

- [x] **Audit re-scope.** ✅ Done 2026-08-28. Full disposition at
      [`dispatch/docs/audit-disposition.md`](https://github.com/nightswatchhq/dispatch/blob/main/docs/audit-disposition.md).
      **No finding from the April assessment describes a live vulnerability in the current
      contract.**
  - [x] Re-ran all seven findings against the current 365-line contract.
  - [x] **H-1 disproved by PoC**, not by argument. `contracts/test/H1CollectOrdering.t.sol` runs the
        experiment the audit's own triager asked for, to its stated success criterion: a mock
        collector really moves GRT and returns a fee, stake is set one wei short so `_lockStake`
        reverts, and the destination balance is **0**. A control test proves the mock does pay when
        locking succeeds, so the negative is not the test passing for the wrong reason. Reduces to
        a CEI style wart; retained as a regression test.
  - [x] H-2, H-3, M-1, L-2 remediated by deletion — no rewards pool, no trusted state roots, no
        issuance in the current contract.
  - [x] M-2 pause guardian: inherited from Graph's own separately-audited
        `DataServicePausableUpgradeable`, bounded by the owner's ability to revoke a guardian.
        Accepted, not fixed.
  - [x] L-1 was **already fixed**: `startService` reactivates a stopped entry rather than pushing,
        so the array is bounded by distinct (chain, tier) pairs rather than start/stop churn.
  - [x] Disposition written into the repo so nobody repeats this analysis.
- [ ] **External audit** (G-2). Now scoped as a **fresh review, not remediation**: there is
      nothing outstanding to re-check, so the money buys new coverage of 365 lines. Cheaper than
      the source report assumed on both counts.
- [ ] **Document dead-code paths in the deployed bytecode.** The proxy has been upgraded; make the
      implementation history explicit and kill the `0xA983…` reference everywhere it appears.
- [ ] **Sticky sessions + drop-in compat.**
  - [x] Provider affinity for `eth_newFilter` / `getFilterChanges` / `getFilterLogs` /
        `uninstallFilter`. **Correction:** it was not the 3-way quorum. Filter methods are not in
        `requires_quorum`, so they take the *concurrent* path, which picks whichever provider
        currently ranks best on QoS. Since scores move continuously, a filter created on one node
        is read from another, which answers "filter not found" while behaving perfectly. Fixed in
        `dispatch-gateway/src/affinity.rs`: a TTL'd, capped `(chain, filter_id) -> provider` map,
        pinned with no failover (a second opinion on a filter id is meaningless, and failing over
        turns a clear error into an intermittent one). 16 tests.
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
- [x] **SQL / direct-DB delivery.** Live at [`/sql`](https://www.lodestar-dashboard.com/sql).
      Schema catalogue, a query playground and a guarded read-only proxy over the nuthatch nests we
      run. This is the one product tier the operating-model decision permits us to operate, and it
      was the cheapest thing on this list because the nests were already there.
  - [x] **The gap it closes was discovery, not capability.** The Helsinki host fronts seven indexed
        datasets behind one credential, serving exactly one consumer: this dashboard. The paid door
        existed too, the Nuthatch Data Service answering `402 TAP-Receipt header required`. But
        nobody outside could see a table name or run a single query without asking us first, and a
        paywall in front of an undocumented surface is not a product.
  - [x] Four datasets exposed by an **explicit allowlist**, not a passthrough: proxying every nest
        that happens to share a hostname is how a private dataset becomes public by accident.
  - [x] **The security is the nest's, and deliberately so.** nuthatch opens DuckDB with
        `enable_external_access=false`, an `allowed_directories` restriction and
        `lock_configuration=true` so a query cannot widen its own access mid-flight, plus a function
        allowlist as well as a denylist, comment stripping before matching, and rejection of unknown
        table references. That was checked in the source before a line of this was written, because
        a public SQL endpoint over DuckDB without it is a file-read primitive.
        `isReadOnlySql` on our side is a cheap first pass, 10 tests, and is documented as not being
        the boundary.
  - [x] Results carry nuthatch's provenance stamp: the block the answer was true as of, what was
        sealed, and the registry that decoded it. An answer nobody can date is an answer nobody can
        cite.
  - [x] A dataset that stops answering stays in the catalogue marked unavailable rather than
        vanishing, which is the lesson from three data services reading as healthy for 39 days.
  - [x] Rationed at **five queries a minute with a six-second timeout**, pinned by a test. The
        thing being rationed is not bandwidth but the CPU the Lodestar Oracle, dips-nest and the
        data-service gateway share on that host. The per-IP counter is per edge instance and so is
        a soft ceiling; the timeout is the hard one.
  - [x] **Named-query tier, live on `/sql` and at `/api/sql/named`.** The caller sends a name and
        typed arguments and never sends SQL. nuthatch's own RFC-0034 is blunt about why free-form
        alone is not enough: the node's guards are "self-protection, not a security boundary" — they
        bound one query's cost and say nothing about which questions the surface answers at all.
  - [x] Five declared queries across `staking` and `dips`, **every one pinned to a block**, so every
        answer is reproducible and can carry a [receipt](https://github.com/nightswatchhq/tattler).
        A name is the unit two parties can agree on; an ad-hoc SELECT from six months ago is not.
  - [x] **Only `int` and `address` parameters**, because both have a total validating parse into a
        form with no escaping hazard. `text` is deliberately absent, and the reasoning is nuthatch's
        adopted wholesale: escaping has to be right in every dialect and every context, and "we
        escaped it carefully" is how this class of bug ships. 32 tests, including a property test
        that no caller-supplied character reaches the SQL under any of the declared queries.
  - [x] Rationed at 15/min against free-form's 5, and that ordering is a product statement rather
        than a shrug: a declared, pinned question has a cost chosen in advance, an arbitrary SELECT
        has one a stranger explores for free.
  - [ ] Move the surface into the nests' own mount config (RFC-0034 phase 1) so the bound holds even
        for callers who bypass this dashboard. It lives here today because those nests are
        single-nest processes serving live panels, and a product feature is a poor reason to
        reconfigure four of them.
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

- [x] **Metering spec + contract.** Done 2026-08-28:
      [nightswatchhq/chain-integration-ds](https://github.com/nightswatchhq/chain-integration-ds).
      **The design changed on contact with the protocol.** Not the compass template and not
      GraphTallyCollector: supporting a chain is a commitment held over time, not a request, so it
      settles through **`RecurringCollector`** (`0xff0dc731…`, live on Arbitrum One, built for
      DIPS). Its Recurring Collection Agreement already carries `maxInitialTokens` (the integration
      fee), `maxOngoingTokensPerSecond` (the support retainer) and a term. We did not design that
      shape, we noticed it. 16 tests.
  - [x] CAIP-2 (GIP-0047) denormalised out of agreement metadata and emitted on every collection,
        so per-chain revenue is a query over events rather than a reconciliation against a registry
        somebody has to remember to update.
  - [x] The cut is a **governance parameter with a placeholder default**, not a constant. Hard-coding
        it would be making Council policy in Solidity.
  - [x] Two upstream limitations surfaced rather than papered over: `PaymentTypes` has no
        integration-fee variant (so `IndexingFee` is borrowed, and revenue bucketed by payment type
        will misfile), and there is still no verification primitive, so `slash()` reverts.
  - [x] Fed two build gotchas back to `horizon-skills`: the documented dependency pin predates
        `RecurringCollector`, and the newer ref drops `onlyAuthorizedForProvision` and
        `IDataService.deregister`.
- [x] ~~**Attribution gateway.** gib extension tagging usage by CAIP-2 chain id.~~ **Obsoleted by
      the design, 2026-08-28.** This task assumed per-query metering through gib. Settling through
      `RecurringCollector` means there is no per-query gateway involvement at all — a chain
      integration is subscribed to, not queried — and attribution happens on-chain at collection,
      where `IntegrationFeesCollected` already carries the CAIP-2 id. Building a gateway to tag
      traffic that does not exist would have been busywork. Removed rather than done.
- [ ] **Revenue dashboard.** Lodestar panel: per-chain integration revenue, protocol capture rate,
      indexer flow. Blocked only by there being no deployment to index; the design makes this
      cheap, because `IntegrationFeesCollected` carries the CAIP-2 id so the panel is a query over
      one event rather than a join against a registry.
- [x] **Reference integrator flow.** Done:
      [`docs/integrator-runbook.md`](https://github.com/nightswatchhq/chain-integration-ds/blob/main/docs/integrator-runbook.md).
      End to end for both parties, with the failure table. Plus `Deploy.s.sol` (atomic initialise;
      an uninitialised proxy is front-runnable) carrying the canonical `RecurringCollector`
      addresses for both networks.
- [ ] **Deploy to Arbitrum Sepolia.** Needs a funded deployer key and testnet gas. Until then the
      contract is a reference implementation with no live instance, and the revenue dashboard below
      has nothing to render.
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
- [x] **Deterministic ground-truth pipeline: it was not greenfield.** nuthatch already produces
      content-addressed sealed segments with a provenance stamp naming the block an answer was true
      as of, how far the nest had sealed, and the registry hash that decoded it. That is the
      lineage-tagged, hash-anchored substrate this item describes, and it has been running on
      Helsinki for six weeks. What was missing was a way to hand an answer to someone who does not
      trust you.
  - [x] **[nightswatchhq/tattler](https://github.com/nightswatchhq/tattler)**, 20 tests. Signed,
        replayable receipts: `attest` signs an answer, `verify` checks offline that nothing was
        edited, `replay` re-runs the question against another nest and compares.
  - [x] **Proven across two independently built nests.** `staking` and `legacy-flows` on the
        Helsinki box are separately backfilled and both index `TokensDelegated`. A receipt issued
        against one replays to the identical hash against the other. Two indexes, built at
        different times from different configs, computed the same answer.
  - [x] **The finding that shapes the whole thing: an answer must pin its block.** nuthatch's
        `/sql` answers from sealed history *plus the unsealed tip*, and the tip moves — the same
        dataset reported `as_of` 499,659,175, then 499,659,807, then 499,666,752 inside one
        afternoon. An unpinned answer cannot be reproduced by anyone, including whoever took it.
        So `attest` refuses to sign one, and `replay` refuses to compare against a nest that has
        not sealed that far, because that mismatch means "not caught up" rather than "the issuer
        lied". That guard fired on its first real use.
- [ ] **Verification / attestation service.** Verify ZK proofs or view-key disclosures
      against the ground-truth store; emit signed audit tags; support permissioned decryption and
      selective disclosure. **Half of this now exists**: tattler establishes the ground truth a
      disclosure would be checked *against*. Checking an actual ZK or view-key scheme does not.
- [x] **Auditor console, first half: [`/verify`](https://www.lodestar-dashboard.com/verify).**
      Paste or drop a receipt and see whether the rows still hash to what was signed and whether
      the signature covers the body. Three outcomes, kept distinct because collapsing them into
      "invalid" tells a reader nothing about whether they are looking at a bad paste or at somebody
      lying: rows altered, bad signature, not a receipt.
  - [x] **It is the tattler crate compiled to WebAssembly, not a TypeScript rewrite.** Verification
        hinges on two parties computing byte-identical canonical bytes; a second implementation is a
        second set of decisions about key ordering, integer formatting and length prefixes, and the
        day they disagree the page reports a forgery that never happened. Whoever chased that would
        be debugging the verifier while believing they were auditing the data.
  - [x] **It runs entirely in the reader's browser and cannot phone home.** Everything needed to
        *issue* a receipt sits behind a `cli` feature, so the library has no clock, no network and
        no randomness: the browser build cannot generate a key and cannot make a request. Not that
        it does not — that it cannot, and `cargo tree` is the proof. Checking a receipt against our
        server would mean trusting us, which is the thing a receipt exists to avoid.
  - [x] **A guard against the failure this design could still have had.** A committed `.wasm` can
        go stale against the Rust it came from, and then the page verifies by yesterday's rules
        while the CLI uses today's — silently, which is the exact divergence compiling was meant to
        prevent. A Lodestar test runs the *shipped* binary against the frozen production receipt.
        Checked by installing a deliberately divergent build: four tests fail, one naming the cause.
  - [x] **Receipts over declared queries, not just over SQL.** `tattler attest-named` signs the
        answer to a published question asked by name and typed arguments, and a named receipt
        **replays by name**: the other endpoint answers using *its own* definition rather than being
        asked to agree with your text. A name is the unit two parties can agree on;
        `net_delegation_to_indexer(0x…, 497000000)` means the same thing to both of them next year,
        where reading back somebody's ad-hoc SELECT is interpretation rather than verification. If
        the two sides define it differently, `replay` prints both, because replaying raw SQL would
        have hidden exactly the disagreement worth seeing.
  - [x] Adding those fields **did not invalidate a single receipt already issued**: both are omitted
        when unset, so an unnamed body signs as it always did. Asserted directly, and the frozen
        production fixture from before they existed is checked by the current binary every run.
  - [x] **A gap in yesterday's staleness guard, found by walking into it.** The browser verifier is
        a compiled artefact, and serde ignores unknown fields — so the stale build parsed a named
        receipt, computed the signature without the new fields, and reported `bad_signature`. A
        verifier calling an honest receipt a forgery is the worst answer it can give, and the guard
        missed it because it only checked a receipt issued *before* the fields existed. Both shapes
        are pinned now: a verifier must be re-tested against every shape it may be handed, not
        merely the oldest.
  - [ ] Export audit reports, role-based access, and a disclosure view. Not started.
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

**Reconciled 2026-08-28.** `src/data/catalyst-roadmap.ts` (the public homepage card) and this file
now carry the **same eight numbers**, and a test in `src/data/__tests__/catalyst-roadmap.test.ts`
pins them so a change to one has to be a change to both.

They drifted badly once already: for most of 28 August the card told the public 37% and Dispatch
60% while this file knew better, which is the same class of failure as a catalogue saying
"Live · Production" about a service that stopped answering in July. A number nobody has checked
against reality is not evidence, it is decoration, and that applies to our own numbers first.

The card's *rationales* are still editorial and argued in prose. The numbers are not.

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
