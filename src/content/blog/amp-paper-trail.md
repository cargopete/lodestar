---
title: "Amp's Paper Trail: What Survived the Repo Going Private"
date: "2026-08-26"
author: "cargopete"
tags: ["amp", "camp", "edge-and-node", "busl", "licensing", "open-source"]
category: "Analysis"
excerpt: "edgeandnode/amp 404s if you ask anonymously. But a December 2025 snapshot got out before the door shut, a public binary is still on ghcr.io, and BUSL-1.1 has quite a lot to say about what you may do with both. Here is the full paper trail, with dates, repo IDs, and the licence read properly."
---

If you go looking for `edgeandnode/amp` today, GitHub returns a 404. Not "you need permission." Just gone, as far as an anonymous request is concerned.

This surprises people, because Amp was launched loudly, from a stage, ten months ago, and because there is still an enormous amount of Amp material lying around in public: docs, npm packages, a Docker image, a GitHub Action, several forks. The obvious question, and the one I get asked most often, is which of that is legitimately usable and which of it is a trap.

So this is the paper trail. Dates, artefacts, repository IDs, and a careful read of the licence. It is deliberately not another architecture post; if you want the pipeline explained there is [an introduction](/blog/intro-to-amp), a [deep dive on the decode layer](/blog/camp-deep-dive), and [two](/blog/run-local-amp-node) [parts](/blog/run-local-amp-node-part-2) on running it yourself. This post is about provenance.

I should declare an interest immediately, because it becomes relevant around the third section: **camp-node is mine.** I maintain the fork this post traces. I have tried to write the lineage section as I would want a stranger to write it, but you should read it knowing that.

---

## The timeline

| When | What |
|---|---|
| **5 Nov 2025** | Amp unveiled at Chainlink's SmartCon. Rodrigo Coelho, CEO of Edge & Node, "Introducing Amp: Enterprise-Grade Onchain Data," Grand Central stage, 1:52 PM EST. |
| **6 Nov 2025** | Launch blog on thegraph.com: "It's Here. Fast. Verifiable. Enterprise-Ready. Amp." |
| **Nov 2025** | Further promotion at ETHGlobal Pragma, Frontier Forum, DevConnect Buenos Aires. |
| **12 Dec 2025** | Commit `a1937bf`. The last publicly forkable state of `edgeandnode/amp`. |
| **Feb 2026** | Community architecture write-ups appear. Amp adds Solana support. |
| **Early–mid 2026** | Repositioning around enterprise compliance: GENIUS Act, SOC 2, the `ampersend` agent-payments product. The repo goes private. Distribution moves to the `ampup.sh` installer and a token-gated releases API. |
| **5 May 2026** | `ghcr.io/edgeandnode/amp:latest` tagged **v0.0.36**. Still the newest publicly obtainable binary. |
| **6–7 Jun 2026** | `nightswatchhq/amp` archived and deprecated. `lodestar-team/camp-node` v0.2.0 released. |

Edge & Node's own SmartCon video is unambiguous about the framing: "At SmartCon 2025, Rodrigo Coelho, CEO of Edge & Node… unveiled Amp, the world's first blockchain-native database." The launch blog puts the scale context at 1.27 trillion queries served to more than 75,000 projects.

Ten months later the thing is a closed binary behind a token gate. That is not a scandal, it is a company deciding it has an enterprise product rather than an open one, and it is entirely their prerogative. But it does mean the public record and the shipping artefact have quietly parted company, and it is worth knowing exactly where they diverged.

The divergence point is `a1937bf`, 12 December 2025.

## What is still standing

Rather more than you would expect. Everything below is public today.

**From Edge & Node:**

| Artefact | What it is |
|---|---|
| `edgeandnode/amp` | 404 anonymously. README still cached and indexed. |
| `edgeandnode/amp-python` | Python client and connectors. |
| `edgeandnode/ampup` | Official rustup-style version manager. Installs `ampd`/`ampctl`. |
| `edgeandnode/setup-amp` | GitHub Action. |
| `edgeandnode/amp-mcp` | MCP documentation server (npm `@edgeandnode/amp-mcp`). |
| `edgeandnode/amp-demo`, `amp-templates` | Example apps, `create-amp`. |
| npm `@edgeandnode/amp` | TS/JS client, v0.0.51, BUSL-1.1. |
| `ampup.sh/docs` + a fuller Mintlify set | Arrow Flight, streaming, SQL, concepts, Admin API errors. |
| `ghcr.io/edgeandnode/amp:latest` | **The v0.0.36 binary.** Pullable by anyone. |

The `setup-amp` README is the most quietly informative document in that list, because it says the quiet part in a troubleshooting note: "While the Amp repository is private, the default workflow token only works for workflows running inside `edgeandnode/amp` itself." That is the gate, described by the people who built it.

**Third-party, all BUSL-1.1:**

- `nightswatchhq/camp-node` and `lodestar-team/camp-node`, the live fork.
- `nightswatchhq/amp`, deprecated, archived 6 June 2026, pointing at camp-node.
- `aUsABuisnessman/amp`, the fork-network root.
- `engine.camp`, a free keyless REST/SQL API running `ampd` against Arbitrum One.

## The lineage, with receipts

This is the part where people either take my word for it or do not, so here are the identifiers, which are checkable without my involvement.

The fork network root of `nightswatchhq/amp` is `aUsABuisnessman/amp`, GitHub `network_root_id` **1101719220**. `nightswatchhq/amp` itself is repo id **1250506772**, carried 1,313 commits, and was archived on 6 June 2026 marked "DEPRECATED — moved to a clean standalone repo."

That clean repo is `camp-node`, repo id **1261433744**. That single id is shared by both `lodestar-team/camp-node` and `nightswatchhq/camp-node`, which is the useful bit: **an identical repository id means the repo was transferred or renamed between the two orgs, not independently re-created.** One repository, two names, no clean-room story.

The two copies are at different points. `nightswatchhq/camp-node` is the current one at 29 commits, carrying the Postgres-wire server, the keyless `pinax` source, Cloudflare R2 support, `bench/`, `ROADMAP.md` and `benchmarking-against-amp.md`. `lodestar-team/camp-node` sits at 3 commits with releases v0.1.0 and v0.2.0. The tree is roughly 80% Rust, 20% TypeScript.

The conclusion that matters: **camp-node is a genuine fork of real Amp source taken at `a1937bf`, not a reimplementation.** It keeps the upstream binary names `ampd`, `ampctl` and `ampsync` for compatibility, versions independently, and is explicitly "not affiliated with, sponsored by, or endorsed by Edge & Node Ventures or The Graph."

Which is exactly why the licence is not a footnote.

## Reading BUSL-1.1 properly

The Business Source Licence 1.1 is **source-available, not open source.** People use the two interchangeably and it causes real damage. Two clauses do the work:

1. **A Change Date.** Each published version converts to Apache-2.0 three years after its own publication. Not the project, the version. `a1937bf` therefore has its own clock, ticking towards December 2028.
2. **An Additional Use Grant** with a non-compete. You may use it, but not to offer a competing service.

What that means in practice, split into the two piles that actually matter:

**Fine, and normal engineering practice:**

- Reading the camp-node source. It is public and it is licensed to be read.
- Building it and running it.
- Black-box observation of the public v0.0.36 binary. gRPC reflection (`grpcurl -plaintext localhost:1602 list` returns `arrow.flight.protocol.FlightService`), Arrow Flight `FlightInfo` schemas, FlightSQL command types, `strings` on the binary, watching wire formats, reading the protobuf and UDF definitions in the public source.
- Learning the architecture. Ideas are not copyrightable. Hash-linked immutable segments, revision-based reorg swaps, decoding as SQL UDFs over a raw `logs` table: these are design concepts, and you may absolutely go away and have them yourself.

**Not fine:**

- Decompiling the closed binary to reconstruct post-December-2025 internals.
- Bypassing the token gate on the private repo or on `ampup`.
- **Copying BUSL-licensed code into an Apache or MIT project.** This is the one that bites, because it looks like the harmless option. Until each version hits its Change Date the licences are incompatible, and a few pasted functions will quietly poison a permissive tree.

The line is "learn from it, then write your own." That is not a legal hedge, it is genuinely how this is supposed to work, and it is why [the benchmark post](/blog/yes-camp-is-better-than-amp) was careful to state on the record that it was black-box observation with no decompilation. If you are going to publish numbers about somebody else's binary, say how you got them.

The camp-node README makes the same point about upstream, and I think it is worth quoting because the precision is the point: Edge & Node "distributes Amp via ampup.sh; its source is not currently published at a public URL — the BUSL `LICENSE` shipped with the code is the governing grant." The licence travels with the code, not with the repository's visibility setting. Taking the repo private does not retroactively narrow the grant on a copy that was lawfully obtained beforehand.

## Caveats, because there are always caveats

**"Amp current" is not an artefact anybody outside can hold.** The only obtainable binary is v0.0.36 from 5 May 2026. Anything newer is private and may differ substantially. The private tree has had eight months to diverge from the December baseline that camp-node preserves, and I have no idea how far it has gone.

**I am not a lawyer.** This is a careful reading of a widely-used licence by someone who has had to make decisions under it, not advice. If you are about to build a business on the answer, pay someone.

**Some of the write-ups in circulation are community, not official.** The Medium series that gets passed around tracks the official material closely and has genuinely useful config and UDF examples, but it is not Edge & Node's documentation and should not be cited as such.

**There are two Amps and one token.** Sourcegraph's Amp is an AI coding agent spun off in December 2025. AMP is also a cryptocurrency. Neither has anything whatsoever to do with the database. This confusion is now responsible for a meaningful fraction of the search traffic that lands here, which is its own small comedy.

---

The short version, if you skipped: the engine that was demonstrated at SmartCon is readable today, lawfully, at commit `a1937bf`, and there is a runnable binary from May to poke at alongside it. That is an unusually good position to be in when studying a commercial system. It is also a strictly time-limited one, because nothing new is coming out through that door, and the gap between the public record and the shipping product widens every month.

Read it while it is still representative.
