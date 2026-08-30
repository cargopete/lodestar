# What a body with an entity should actually do

**A recommendation, not a plan.** The Night's Watch has no legal entity, will not acquire one, and
cannot hold a SOC 2 certification or sign an SLA. So this is the other thing available to us: to
have gone far enough down the road to say precisely what somebody who *can* should do, and where the
work is harder than it looks.

Written 2026-08-30. Everything below is either something we built and measured, or a gap we hit and
are naming rather than papering over.

---

## The gap, in the Foundation's own words

The Project Catalyst material concedes it: no SLAs, no SOC 2. That is a fair admission and it is
also the whole obstacle. An institution evaluating chain data does not primarily ask "is this
correct" — it asks "who is accountable when it is not", and a decentralised network's honest answer
has so far been "nobody in particular". Every technical property below is downstream of that
sentence.

## 1. Publish SLOs before you promise SLAs, and publish them measured

An SLA is a contractual promise with a credit remedy attached. An SLO is a number you publish about
yourself and let people check. **The second is a prerequisite for the first**, and almost nobody
does it, because an unmeasured SLO is a hostage.

Do it in this order:

1. **Instrument what you already run**, then look at the numbers for a month before promising
   anything. You will find at least one thing you assumed was working.
2. **Publish the measurement surface**, not just the summary. A status page that reports "healthy"
   with no way to check is a claim; an endpoint that reports its inputs is evidence.
3. **Only then** turn the observed distribution into a promise, with the tier you can actually hold
   rather than the tier that sounds impressive.

We did step 1 and 2 on our own infrastructure and it is worth being specific about what fell out.

### What we measure, and what it caught

`/api/health` reports every scheduled job with a staleness verdict rather than a bare timestamp.
That distinction is not cosmetic. The endpoint used to publish `last_run` and leave the reader to
know each job's cadence from memory — which is the same shape as reading a registry and calling it
liveness: the data is there and the judgement is not, so a stopped job stays silent until somebody
happens to look *and* happens to know.

Three states are kept deliberately apart, because they have three different responses:

| | meaning | response |
|---|---|---|
| **stale** | it stopped running | go and look |
| **failing** | it runs on time and errors | read the error |
| **retired** | decommissioned on purpose | nothing, and it says so |

That third row exists because a decommissioned job sat in our own health output for 28 days looking
broken. **A monitoring surface that cries wolf about a retired job teaches people to ignore
staleness in that table**, and the next genuinely stopped job goes with it.

### The measurements, as of 2026-08-30

| | observed |
|---|---|
| Named query, end to end | p50 **0.45 s**, max **1.00 s** over 5 samples |
| Scheduled jobs tracked | 13, **0 stale, 0 failing** |
| Health endpoint latency | ~1.9 s (it does real work: Postgres, Redis, ingestion freshness) |
| Nest readiness | polled every 15 min, edge-triggered alerts |

Five samples is not a distribution and we are not calling it one. It is the honest state of the
instrument, which is the point of publishing it at this stage rather than a nine.

**A recommendation with a number attached is worth more than a framework.** Anyone quoting a
"99.9%" without a measurement surface behind it is quoting a hope.

## 2. SOC 2: start the clock long before you start the work

The single most useful thing in this document. **The Type II observation window is three to six
months of calendar time, and no amount of engineering compresses it.**

That means the sequencing is inverted from how it usually gets planned. The controls are the easy
part and the waiting is the hard part, so:

- **Start in Q1 even if the code lands in Q4.** A recommendation published in January is worth
  materially more than the identical words in October, because the clock is the binding constraint.
- **Scope to Security and Confidentiality first.** Availability sounds like the relevant one for a
  data service and it is the expensive one, because it drags SLAs in behind it.
- **Adopt a compliance-automation platform** (Vanta, Drata, Comp AI class) rather than assembling
  controls by hand. The cost is real and the alternative is a person's year.
- **HSM key management** shares a boundary with the signing work below. Do them together or you will
  do the second one twice.

## 3. Ground truth is a solved problem and nobody has claimed it

This is the part where the technical work is already further along than the commercial framing, and
where a body with an entity could move quickly.

An auditor's question is not "what does this API say" but "can I check what this API said, later,
against something that was not produced by the people I am checking". Three pieces already exist:

- **Content-addressed, lineage-tagged chain data.** A nuthatch nest produces sealed segments with a
  provenance stamp: the block an answer was true as of, how far the nest had sealed, and the
  registry hash that decoded it. Six weeks running on ordinary hardware.
- **Signed, replayable receipts** ([tattler](https://github.com/nightswatchhq/tattler)). An answer
  can be signed, verified offline by anyone, and **replayed** against a different operator's nest.
  Verified across two independently backfilled nests producing an identical hash.
- **A browser verifier** ([`/verify`](https://www.lodestar-dashboard.com/verify)) that runs the same
  compiled code as the CLI, so a reader with no toolchain can check a receipt without trusting the
  page it came from.

### The distinction an institution will care about, and most vendors blur

**A signature makes tampering detectable. Only replay makes lying detectable.**

A signed wrong answer is a wrong answer, signed. What turns a receipt into evidence is a second
party, who did not coordinate with the first, computing the same answer from the same sealed history
and getting the same hash. Any vendor offering "signed data" without a replay story is offering you
their word with extra steps.

**The load-bearing detail:** an answer must **pin its block**. A nest serves sealed history plus a
moving tip, and over one afternoon the same dataset reported `as_of` 499,659,175, then 499,659,807,
then 499,666,752. An unpinned answer cannot be reproduced by anyone, including whoever took it, ten
seconds later. Every attestable query should carry its pin, and a verifier should refuse to compare
against a source that has not indexed that far — because that mismatch means "not caught up", and
reporting it as disagreement trains people to ignore the real ones.

## 4. What we would tell an auditor to ask a data-service operator

Cheap questions with expensive answers, in order:

1. **"Has your payment path ever run against the deployed contracts?"** Not "do your tests pass". Of
   the services we checked, one had two separate fatal defects behind a fully green suite: it never
   called `accept()`, which only the named data service may call, so no agreement written for it
   could be accepted by anybody; and its `collect()` encoded four fields against a six-field struct.
   Both invisible, because the mock stored the calldata without decoding it. **A mock that accepts
   any input is not a test of the input**, and it is worse than no mock because it manufactures
   confidence.
2. **"Which addresses are you calling, and did you resolve them or copy them?"** Two addresses in
   wide circulation turned out to be implementations rather than proxies. Calling an implementation
   does not revert — its storage is uninitialised, so a view returns **zero**, forever, silently.
3. **"What does your health endpoint know that it does not say?"** See §1.
4. **"What happens when your embedder, index parameters, or encoding change?"** Anything derived from
   a model or a shape is a token space, and changing it silently orphans everything stored before.
   The answer should be "it refuses to start", not "it warns".

## 5. What this does not solve

- **Nobody is accountable.** Every property above is verifiable and none of it is a counterparty. An
  institution that needs somebody to sue is not served by cryptography, and saying otherwise is the
  reason these conversations stall.
- **The privacy schemes are unrated.** NIST has issued no formal ratings for specific ZK, FHE or MPC
  constructions, so "we verify ZK disclosures" caps institutional confidence at whatever the scheme
  itself commands.
- **We have not verified a confidential-transfer scheme.** The ground truth exists; checking a
  disclosure *against* it does not, and we are not pretending otherwise.

---

## The short version

Start the SOC 2 clock now, scope it to Security and Confidentiality, and publish measured SLOs before
promising contractual ones. The ground-truth and attestation layer is further along than the
commercial framing suggests and is free to adopt. And when evaluating any data service, ask whether
its payment path has ever run against the real thing — because for at least one of ours, on a fully
green test suite, it had not.

*Nothing here is a service offer. We build these things and do not operate them; this is what we
learned doing it, written down for whoever can.*
