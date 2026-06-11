# [RFC-005] Subgraph Disassembly: from static transparency to verifiable, runnable subgraphs

**Status:** Draft · **Author:** Pete · **Created:** 2026-06-11
**Phase 1 shipped:** v4.12.0 (`/disassembly`) · **Tracks:** [[project_subgraph_disassembly]], [[project_replacement_strategy]]

## TL;DR

A subgraph is a black box. You signal GRT on a deployment ID, indexers serve queries from it, and almost nobody can answer the most basic questions about what it actually *does*: which handlers make `eth_call`s, whether it touches IPFS, whether the deployed WASM even matches the public repo it claims to come from. Studio and Explorer don't tell you. Nobody's tool does.

**Phase 1** (shipped) cracked the box open *statically*: fetch the deployed WASM + manifest straight from IPFS, disassemble it, and map every handler to the host APIs it can reach. No build, no execution, no trust.

This RFC proposes the next three steps, in increasing order of ambition and payoff:

- **Phase 1.5 — Static enrichment.** Squeeze the analysis we already have: cross-version diffing, signal-weighted risk, and persistent shareable reports. Days of work, no new infrastructure.
- **Phase 2 — Source verification.** Build a subgraph's *source* in a sandbox and prove the deployed WASM matches the public repo. A genuine trust primitive nobody else offers.
- **Phase 3 — In-browser replay.** Port the graph-node runtime onto `wasmi` and actually *run* a handler against real trigger data in the browser. "Matchstick-in-the-browser." The differentiator, and the hard one.

Each phase stands on its own and ships independently. We do them in order; we stop wherever the value runs out.

## Where we are: Phase 1 (shipped, v4.12.0)

Lives entirely inside `graph-dashboard` — pure in-app TypeScript, no Rust service, no backend job.

- **`/disassembly` page** + `/api/disassembly?id=Qm…` route; nav under Developers (sidebar + mobile).
- **`src/lib/disassembly/`**: `ipfs.ts` (cat text/bytes from `ipfs.network.thegraph.com`), `manifest.ts` (deploy-grade extraction), `wasm.ts` (hand-rolled, graceful-degrading WASM parser + host catalog + per-handler call-graph reachability), `scorecard.ts`, `index.ts` (`runDisassembly` orchestrator).
- **What it produces:** per-handler reachability over the host catalog (`store`, `ethereum.call`, `ipfs`, `json`, `crypto`, `bigInt`, `bigDecimal`, `typeConversion`, `dataSource`, `log`), recovered handler/function names (WASM name section) and strings (UTF-16LE data segments), and a transparency scorecard (grade + Determinism/Performance/Transparency + risk flags).
- **Validated end-to-end** against real subgraphs (GNS, a grafted betswirl subgraph). All handlers resolved; `eth_call` vs pure-store handlers correctly distinguished.

**Design invariants we keep across all future phases:**
- The parser degrades gracefully: an unmodelled opcode sets an `incomplete` flag, never a silently-wrong reachability result. This is a *transparency* tool — a confident wrong answer is worse than an honest "unknown".
- `dynamicDispatch` (`call_indirect`) is ~always-true in AssemblyScript output, so it stays as one honest global caveat, not a per-handler signal or score penalty. We don't manufacture noise.
- Deployments are immutable, so everything is cacheable hard (reuses the existing `cached()` helper, 7d TTL).

## Phase 1.5 — Static enrichment (cheap wins, no new infra)

Same codebase, same parser, no sandbox, no runtime. Three features that multiply the value of what's already there.

### 1.5a — Cross-version diff
Paste two deployment IDs (or pick a subgraph's version history); diff handler reachability, host-API surface, recovered entity types, and event signatures.

> "v3 added an `ethereum.call` to `handleTransfer` that v2 didn't have."
> "The new version dropped IPFS entirely — determinism score went A→A+."

Pure TypeScript over two existing `runDisassembly` results. This is the feature curators and delegators will actually use before re-signalling on an upgrade.

### 1.5b — Signal-weighted risk
A risk flag on a subgraph with 5 GRT signalled is trivia; the same flag on one with 400k GRT is news. Overlay the scorecard with the deployment's current signal/curation (we already pull this elsewhere in Lodestar) so flags are sorted by *stake at risk*, not just presence.

### 1.5c — Persist & share
Store disassembly results (keyed by immutable deployment ID) so a report is a stable, linkable, embeddable URL. Feeds directly into the broader goal of replacing Studio/Explorer as the canonical place to *understand* a subgraph, not just query it. Cache backing is the existing Postgres; the result JSON is small.

**Exit criteria for 1.5:** all three live behind `/disassembly`, cross-version diff validated against a real upgrade, reports shareable by URL.

## Phase 2 — Source-to-deployment verification

Phase 1 tells you what the *deployed artifact* does. Phase 2 answers a different, harder question: **does the deployed WASM actually correspond to the public source repo it claims to?**

### The mechanism
1. User provides a git repo + ref (or we resolve it from subgraph metadata).
2. We build it in a **locked-down sandbox**, network-gated: dependency install is allowed through a pinned proxy, the build itself has no network.
3. We disassemble the *produced* WASM with the Phase 1 pipeline and compare it against the *deployed* WASM from IPFS — ideally byte-identical, realistically structure-identical (handler set, host reachability, recovered strings) modulo non-reproducible build noise.
4. Output a verdict: **Verified / Diverged / Unbuildable**, with a diff for "Diverged".

### Why this is the trust story
Right now "this subgraph is open source" is an unverifiable claim. Phase 2 turns it into a checkable fact. That's the same primitive that makes verified contract source on Etherscan valuable — and nobody in The Graph ecosystem offers it.

### Infrastructure decision (settled)
**gVisor on the existing Hetzner box, not microVMs.** The feasibility report's reasoning holds: for a solo operator, gVisor's syscall-interception sandbox gives us adequate isolation for building untrusted `npm`/`graph build` projects without the operational tax of a microVM fleet. Network-gated installs through a caching proxy keep the blast radius small and builds reproducible-ish.

### Hard parts
- **Build reproducibility.** `graph build` + `asc` aren't guaranteed byte-reproducible across toolchain versions. Mitigation: compare at the *structural* level (handler/host/string signature) as the primary verdict, byte-match as a bonus.
- **Toolchain matrix.** Different `@graphprotocol/graph-cli` and `apiVersion` combos. Start with the modern majority, expand on demand.
- **Resource abuse.** Builds are the expensive, attacker-controlled surface. Hard timeouts, CPU/mem caps, one build at a time, aggressive caching by repo+ref.

**Exit criteria for 2:** a "Verify source" flow that, given a repo, returns Verified/Diverged/Unbuildable for a meaningful fraction of real subgraphs, sandboxed safely on Hetzner.

## Phase 3 — In-browser handler replay ("Matchstick-in-the-browser")

The crown jewel. Stop reasoning about what a handler *could* do and actually *run* it against real trigger data, in the browser, watching the entity writes land.

### The mechanism
- Port `graph-runtime-wasm`'s `HostExports` + `AscHeap` onto **`wasmi`** (a pure-Rust WASM interpreter that compiles to `wasm32`), so the whole thing runs client-side.
- Feed a handler real trigger data; stub the host functions; capture `store.set` / `store.remove` calls as the observable output.
- Source the inputs from assets we already have:
  - **Indexer `eth_call` cache** → offline, deterministic replay of `ethereum.call`-heavy handlers.
  - **camp-node Parquet trigger feed** → real historical events to replay against.
  - **Matchstick authorship** → we wrote the reference test runner; we know exactly which host behaviours matter.

### Why it's the differentiator
This is a debugger and a test harness for subgraphs that needs no local toolchain, no `graph-node`, no indexer. Paste a deployment, pick an event, watch the entities mutate. Nothing in the ecosystem does this.

### The thing that could sink it
**apiVersion ABI fragmentation (0.0.4–0.0.9).** The host ABI shifted subtly across these versions — pointer conventions, type-conversion semantics, nullability. A replay engine that's right for 0.0.7 and silently wrong for 0.0.5 violates our core transparency invariant. This is the single biggest risk in the whole RFC and the main reason Phase 3 comes last: we want Phase 1's per-version reachability data and Phase 2's build matrix as ground truth before we commit to emulating each ABI.

### De-risking approach
- Start with **one** apiVersion (whichever dominates current deployments), make it provably correct against Matchstick fixtures, then expand the matrix one version at a time.
- Treat any unmodelled ABI edge the way the Phase 1 parser treats unknown opcodes: flag `unsupported`, never fake a result.

**Exit criteria for 3:** a single handler from a real, current-apiVersion subgraph replays in-browser against real trigger data, producing entity writes that match Matchstick's output for the same input.

## Sequencing & rationale

```
Phase 1   ████████████  shipped (v4.12.0)
Phase 1.5 ░░░            days — pure TS, no infra, immediate user value
Phase 2   ░░░░░░         the trust primitive — sandbox on existing Hetzner box
Phase 3   ░░░░░░░░░░░░   the differentiator — gated on ABI risk being understood
```

We do them in order because each de-risks the next: 1.5's cross-version data and 2's build matrix are exactly the ground truth Phase 3 needs to get the ABI emulation right. And if attention runs out after 1.5 or 2, we've still shipped real, standalone value rather than a half-built moonshot.

## Open questions

1. **1.5c storage shape** — full result JSON in Postgres, or just an index + recompute-on-demand from the 7d cache? (Leaning: store the JSON; it's small and deployments are immutable.)
2. **Phase 2 source resolution** — can we auto-resolve repo+ref from subgraph metadata for any meaningful fraction of deployments, or is it always user-supplied?
3. **Phase 2 verdict threshold** — what structural-diff distance counts as "Verified" vs "Diverged" given non-reproducible build noise?
4. **Phase 3 scope** — single-handler replay only, or eventually a full block-range replay? (Start single-handler.)

## Appendix: asset leverage

Things we already own that make this cheaper than it'd be for anyone else:
- The Phase 1 static pipeline (parser, host catalog, scorecard) — reused by 1.5, 2, and 3.
- The Hetzner box — Phase 2's sandbox host, no new hosting.
- Indexer `eth_call` cache — Phase 3 offline replay.
- camp-node Parquet trigger feed — Phase 3 real input data.
- Matchstick authorship — Phase 3 correctness oracle.
