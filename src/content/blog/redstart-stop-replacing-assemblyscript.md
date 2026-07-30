---
title: "Redstart: I Stopped Trying to Replace AssemblyScript"
date: "2026-06-26"
author: "cargopete"
tags: ["redstart", "assemblyscript", "subgraphs", "the-graph", "developer-tools", "compilers", "rust", "matchstick"]
category: "Ecosystem"
excerpt: "I built Matchstick in 2021 and have been trying to get off AssemblyScript ever since. None of these grievances are new — I have a graveyard of attempts to prove it. Redstart is where it ends, and it turns out the answer was a transpiler all along."
---

I built Matchstick in 2021, and I've been trying to get off AssemblyScript ever since. None of the grievances in this post are new — I've been the guy yelling "subgraphs in Rust" for five years, with a graveyard of attempts to prove it: a binary-level forgery, a rejected graph-node patch, an entire AssemblyScript runtime reimplemented in Rust that shipped to mainnet, and a from-scratch polyglot WASM runtime built to leave subgraphs behind altogether. Redstart is where it ends — and it turns out the answer was a transpiler the whole time. Here's the full arc, and why the boring solution is the one that survives.

---

## Where this started: Matchstick, 2021

In 2021, at LimeChain, I built **Matchstick** — the unit-testing framework most of you run when you type `graph test`. I'm proud of it. It's also patient zero for this entire grudge.

Look at the shape of it. Matchstick's host is written in **Rust**, and it wraps a WebAssembly module full of **AssemblyScript** mappings and tests. To make that work, the host has to act as a proxy for graph-node's own structs and pass the host-function implementations down into the module — `store.set`, `ethereum.call`, the lot — plus a pile of mocked extras glued on top. Even in 2021, my day job was *Rust on the outside, AssemblyScript on the inside, and a fragile translation boundary holding the two together.* I have been trying to delete the AssemblyScript half of that sentence ever since.

Building the test framework also meant I didn't get to write one subgraph and look away. I had to faithfully emulate graph-node's host environment so *other people's* mappings would behave under test. That's how I learned the `AscPtr` object graph, the 20-byte managed headers, the UTF-16LE strings, and the `TypedMap` layout by heart — not because I wanted to, but because Matchstick had to mock all of it. (Keep that in mind. Years later it's exactly the monster that ate my first escape attempt — and the reason I was reckless enough to try.)

And Matchstick is itself a monument to how unpleasant AssemblyScript is. The thing exists because testing AS mappings is miserable: you need a Postgres install (graph-node leans on diesel, which leans on libpq), and you're choosing between a Docker image and a downloaded binary and a `matchstick-as` version you have to keep pinned in lockstep with `graph-ts`. I built the tool that made AssemblyScript *survivable*. Everything after it has been an attempt to make it *unnecessary*.

So when I list grievances below, understand it's not a hot take. It's a five-year ledger.

## What AssemblyScript actually costs you

The thing that defines AssemblyScript isn't the compile errors. It's the deploys that *don't* error. You write a handler, it type-checks, `graph build` is green, you deploy, and then it dies three hours into a sync — an opaque trap, on a field you'd stopped thinking about, on a contract that hasn't changed in months.

The receipts, in short. AssemblyScript is TypeScript with the standard library ripped out and a custom garbage collector bolted on. No closures that capture state. No real iterators — `.map()` and `.filter()` can crash the compiler outright. `BigInt` arithmetic is method calls, not operators. Nullability is a minefield: type narrowing works on locals but not on property accesses, so the same null check that's safe on one line miscompiles on the next. `==` versus `===` does not mean what you think it means. Contract calls that revert abort the whole handler instead of returning something you can branch on. Arrays prefill with garbage. And the single most common production bug in the entire ecosystem is forgetting to call `.save()` — no error, the entity just silently never lands.

When something does go wrong at runtime, you get `failed to read AscPtr` with no field, no type, no context. The official debugging technique is to comment everything out and uncomment line by line until the trap moves. Testing means either standing up a full graph-node stack — Docker, PostgreSQL, an archive node — or using Matchstick, which (and I can say this, I wrote it) mocks so much of the runtime that you can end up testing the mocks. And `crates.io` doesn't exist for you. If a library isn't in AssemblyScript, and most aren't, you write it yourself.

Nobody chose this. They chose it because graph-node accepts AssemblyScript WASM and, historically, nothing else.

## Why nobody can just leave

That last sentence is the whole trap, and it's worth being precise about what graph-node is actually welded to. When it loads a subgraph, it does three things: checks the manifest says `language: wasm/assemblyscript`, reads two fields — `rtId` and `rtSize` — off each allocated object's 20-byte header, and matches host functions like `store.set` and `ethereum.call` by name. That's it. It doesn't inspect the compiler or validate the toolchain.

So the thing graph-node speaks isn't *AssemblyScript the language*. It's a memory layout, an allocator protocol, and a string encoding. Hold onto that distinction — every attempt below missed it in some way, and the one that worked is built on it.

## Attempt one — yogurt: fake it from outside

The first real swing was the obvious one: write handlers in pure Rust, compile to `wasm32-unknown-unknown`, and emulate AssemblyScript's memory model at the binary level so graph-node can't tell the difference. No protocol change, no permission needed. And I went in cocky, because — thanks to Matchstick — I already knew that memory model better than almost anyone.

The output side worked. `yogurt` v0.1.57 wrote real entities to the store with hardcoded values — `__new`, `__pin`, `__unpin`, `__collect` satisfying the AS runtime contract, TypeId globals injected via WASM post-processing, 16-byte `AscEnum` headers, `TypedArray` wrappers for `Bytes` and `BigInt`. I could produce the format graph-node reads.

The input side broke, and it broke for good. Reading event parameters back *out* of graph-node's AS-formatted memory means parsing managed object headers with `rtId` at offset −8 and `rtSize` at −4, UTF-16LE strings, `AscEnum` padding that has to be exactly right, and `TypedArray` wrappers that require runtime introspection — all while AssemblyScript's memory sanitization catches your pointer arithmetic before your own guards can run. The exact monster I'd spent 2021 mocking in Matchstick turned out to be unfakeable from the guest side. After 66 deploy iterations I archived it. The conclusion, in the repo's own words: graph-node is too tightly coupled to AssemblyScript's memory model for a pure-Rust toolchain to fake it from outside.

yogurt's "Future Direction" section wrote my next two tickets for me: build a real ABI for Rust, and change graph-node to accept it.

## Attempt two — a native ABI: change graph-node

So I took the advice. GRC-003, and then graph-node PR #6462: a parallel `rust_abi/` serialization layer of about 1,450 lines, selected by the manifest with `language: wasm/rust`, sitting next to the AssemblyScript path and leaving the runtime, store, and chain ingestion untouched.

The design was everything yogurt's flailing taught me to want. A dead-simple `ptr + len` calling convention: the host serializes the trigger to a flat byte buffer, calls `allocate(len)` on the mapping, copies the bytes in, invokes `handler(ptr, len)`, and resets the arena afterward. The module owns its own bump allocator; graph-node never reaches into an AS-style managed heap. Explicit TLV serialization with a documented tag table — no implicit coercions, no silent endianness bugs. Versioned from day one. wasmtime fuel metering instead of the old `parity_wasm` gas injection, because `parity_wasm` can't even parse the bulk-memory opcodes modern Rust emits.

And it *ran*. I benchmarked the handler path at roughly 617,000 Transfer events per second — about 1.62 microseconds an event — under wasmtime. I wrote a full spec. I deployed it against a mainnet fork, indexed real USDC `Transfer` events from block 24,756,400, and got correct GraphQL results for every field.

The maintainers said no. Politely, firmly, and correctly. The objection was never the code. It was that a second ABI is a permanent second surface to maintain on a critical code path; that Rust isn't popular with the people who actually write mappings; and that the moment anyone shipped a Rust subgraph, the Foundation would be on the hook to keep *my* SDK alive too. I closed the PR myself.

That "no" was the most useful thing in this entire saga. It told me the maintenance burden *was* the product. Any solution that asks the protocol to carry a new runtime — however clean the benchmarks — is dead on arrival, and deserves to be.

## Attempt three — Graphite: become AssemblyScript

If the protocol won't carry a second runtime, don't ask it to. Go back to the distinction from earlier: graph-node accepts a memory layout, not a language. Implement *that* layout in Rust, and the WASM you emit is structurally indistinguishable from AssemblyScript's. graph-node accepts it with no fork, no flag, no PR.

That's Graphite. The core is `graph-as-runtime`, a `no_std` crate that *is* the AssemblyScript runtime reimplemented in Rust — a bump allocator exporting `__new`/`__pin`/`__unpin`, UTF-16LE string constructors, `TypedMap` builders with the right class IDs, and the host FFI declarations under their exact AS names. (Everything I learned mocking those structs in Matchstick, finally turned into a real, complete implementation.) On top sit `graphite-macros` (`#[handler]`, `#[derive(Entity)]`), `graphite-sdk`, and `graphite-cli`. ERC20 and ERC721 subgraphs went live on The Graph Studio, indexing Arbitrum One. Full `graph-ts` parity. `cargo test` in milliseconds. All four crates published.

It shipped. It works. It's still up. So why am I writing this instead of closing the book?

Because Graphite won the deploy and I was still fighting the wrong thing. Here's a Graphite handler:

```rust
#![cfg_attr(target_arch = "wasm32", no_std)]
extern crate alloc;

use alloc::format;
use graphite_macros::handler;

mod generated;
use generated::{ERC20TransferEvent, Transfer};

#[handler]
pub fn handle_transfer(event: &ERC20TransferEvent, ctx: &graphite::EventContext) {
    let id = format!("{}-{}", hex(&ctx.tx_hash), hex(&ctx.log_index));
    Transfer::new(&id)
        .set_from(event.from.to_vec())
        .set_to(event.to.to_vec())
        .set_value(event.value.clone())
        .set_block_number(ctx.block_number.clone())
        .set_timestamp(ctx.block_timestamp.clone())
        .save();
}
```

It's real Rust, and that's the problem as much as the solution. Three costs the April announcement was honest about, and that I under-weighted at the time:

**I now own a from-scratch reimplementation of AssemblyScript's runtime, in binary lockstep, forever.** The maintenance objection that killed attempt two didn't evaporate when I routed around it — it moved to my desk. The day the AS compiler changes a header detail or a `TypedMap` internal, my users' subgraphs miscompile and it's my pager. `graph-as-runtime` is the most fragile kind of contract: an undocumented binary one I keep in sync by reading someone else's compiler output. I'd built Matchstick to track that boundary in 2021; now I'd signed up to track it in production, forever.

**It's still `no_std` ceremony.** `alloc::format!` instead of `format!`, `alloc::vec!` instead of `vec!`, the `#![cfg_attr(target_arch = "wasm32", no_std)]` dance, the builder-and-`.save()` pattern. Mechanical, yes. But I set out to make subgraph authoring *pleasant*, and "the borrow checker plus `no_std` plus a builder you can still forget to terminate" is a strange place to land if pleasant was the goal. I'd traded AssemblyScript's footguns for Rust's ceremony and a binary-compat treadmill.

**And it didn't touch the thing that bites people most.** Which is the part I'd been walking past since 2021.

## The esoteric branch: leaving subgraphs entirely

Around this time I also stopped trying to make *subgraphs* nice and asked a more violent question: what if the subgraph execution model is the problem, and the move is to not use it at all? This is the genuinely esoteric corner of the journey, and I went all the way into it.

**liminal** is what came out: a polyglot, capability-isolated WASIp2 component runtime — a "third lane" alongside Subgraphs and Substreams, not a replacement for either. You write pipeline stages as WASM *components* in any language that targets the component model (Rust, naturally), wired into a DAG by typed WIT interfaces, run on Wasmtime, with capabilities — HTTP, key-value, filesystem — granted per-component by the host instead of per-pipeline. Untrusted middleware becomes a concrete engineering construct rather than a code-review prayer.

The proof-of-concept does a thing a production subgraph flatly cannot: it decodes Uniswap v3 `Swap` events, enriches them with live USD prices over HTTP from DeFiLlama, and fans out to both a Postgres analytics store and a Kafka topic — from one source connection, one cursor, one process. The equivalent today is three processes, three cursors, and a Debezium dependency. It runs against live mainnet on Wasmtime 44 (WASIp2), with WASIp3's async streams tracked upstream.

And here's the honest part: in this design, AssemblyScript simply doesn't exist. That's the appeal and the tell. liminal is the maximalist version of "run away from AssemblyScript" — don't replace the language, evacuate the entire paradigm that requires it. But it is explicitly *not* a subgraph: no GraphQL endpoint on the decentralised network, no Proof-of-Indexing. So as an answer to "how do I escape AssemblyScript *for the subgraphs I actually need to ship*," it's an escape by emigration. It proved I'd explored the whole space, out to its weird edge. It did not answer the question.

## The problem under the problem

Step back from "what language." A subgraph is three artifacts: `schema.graphql`, `subgraph.yaml`, and your mappings. They're stitched together by stringly-typed names and a manual `graph codegen` step, and *nothing checks them against each other*. Rename an event in the manifest and forget the handler. Change a field in the schema and miss it in the mapping. It compiles. It deploys. It dies three hours into a sync.

Now line up everything I'd tried. Fake the runtime from outside (yogurt). Patch the protocol to accept a new one (the native ABI). Reimplement the runtime byte-for-byte (Graphite). Abandon the model that needs it (liminal). Every one of those either *fought* AssemblyScript's runtime or *fled* it — and the runtime was never what I hated. The AS *compiler* is fine. It's maintained by people who aren't me, it's battle-tested, and it's the canonical path the entire network already trusts. What I hated was AssemblyScript *as a language you write by hand*, and the three-files-with-no-checking workflow wrapped around it.

Five years to see it. Stop fighting the runtime. Don't emulate AssemblyScript, don't replace it, don't reimplement it, don't run away from it. Replace the part you actually hate — writing it — and let the official compiler do the part it's genuinely good at.

## Redstart

Redstart is a single language for the whole subgraph — schema, manifest, and handlers — split across as many `.red` modules as you like (`mod`/`use`, just like Rust), type-checked against each other, that transpiles to readable AssemblyScript the canonical `graph build` compiles unmodified.

```
abi ERC20 from "./abis/ERC20.json"

entity Account {
  id: Id<Bytes>
  balance: BigInt
  label: Option<String>          // nullability is always explicit — there is no `null`
  transfersOut: [Transfer] derived from from
}

entity Transfer immutable {
  id: Id<Bytes>
  from: Account
  to: Account
  value: BigInt
  timestamp: BigInt
}

source Token {
  abi: ERC20
  network: mainnet
  address: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
  startBlock: 6082465
}

handler on Token.Transfer(event) {
  let receiver = Account.loadOrCreate(event.params.to, { balance: BigInt.zero })
  receiver.balance = receiver.balance + event.params.value
  // auto-saved at handler end (dirty-tracked) — forgetting `.save()` can't happen
}
```

`redstart build` turns that into `schema.graphql` + `subgraph.yaml` + `mappings.ts`. The event signature in the manifest — `Transfer(indexed address,indexed address,uint256)` — is derived from the ABI *by reference*. Rename the event and it's a compile error, not a runtime one.

Four things make this the attempt that survives.

**The eject path.** The AssemblyScript Redstart emits is readable, and the canonical toolchain consumes it unmodified — no patched `graph build`, no flag, no fork. Which means: if Redstart gets hit by a bus tomorrow, you run `redstart build` once, commit the generated subgraph, delete Redstart, and your production infra keeps indexing forever on the official toolchain. That's the bus-factor objection — the exact thing that killed the native ABI in attempt two, and the thing Graphite only relocated to my desk — defused *structurally*. Not promised in a README; built into where the artifacts live. There's no runtime for me to maintain in lockstep, because I don't ship a runtime. I ship a source-to-source compiler whose output is just AssemblyScript. After five years of owning that boundary, I finally don't have to.

**Unification.** One source of truth. Schema/manifest/handler drift is unrepresentable because they're one program. Entities can live in one module and the handlers that write them in another, and the compiler resolves and type-checks across all of them. The killer feature is the unification, not the syntax.

**Footguns deleted by construction.** Nullability is always explicit — there is no `null`. `load`, `loadInBlock`, and `ipfs.cat` return `Option<T>` you have to `match`. There is no `==`/`===` distinction to invert. Reverted contract calls are `Result` → `try_`, not silent aborts. No array prefill. Auto-save is dirty-tracked, so forgetting `.save()` can't happen. Every footgun on that five-year ledger is either a type error or simply absent from the grammar.

**Tests without infrastructure.** `redstart test` runs your `test` blocks natively — a tree-walking interpreter against an in-memory mock store. No WASM compile, no Docker, no downloaded Matchstick binary, and — because your tests are written in Redstart, not AssemblyScript — no `matchstick-as`/`graph-ts` version skew. (It took me five years and a whole career to put my own framework's setup tax out of business, and I could not be happier about it.)

```
test "a transfer debits the sender and credits the receiver" {
  Token.Transfer({ from: 0x01, to: 0x02, value: 100 })
  assertEq(Account.at(0x02).balance, 100)
  assert(Account.at(0x01).balance < 0)
}

test "approval writes the balance read via a contract call" {
  mockCall(ERC20.balanceOf(0x05), 4200)        // mock the eth_call
  Token.Approval({ owner: 0x05, spender: 0x06, value: 1 })
  assertEq(Account.at(0x05).balance, 4200)
}
```

That's the fast inner loop for handler *logic*. Fidelity to the real compiled WASM is a separate concern, handled separately — which brings us to the honest part.

## Status, and how I'd know if it's wrong

Redstart is Stage 0. Early. But real and end-to-end. The lexer and parser (`logos` plus recursive descent, `miette` diagnostics), the multi-file module loader with cycle detection, the semantic checker, the AssemblyScript codegen, the native test interpreter, `fmt`, a `dev` watch loop, a `deploy` command that chains into `graph codegen` → `graph build` → `graph deploy`, a tree-sitter grammar, an LSP with diagnostics and hover and go-to-def, and a VS Code extension — all working. The schema surface already covers enums, interfaces, `@derivedFrom`, immutable entities, and timeseries with aggregations. v0.1.0 shipped today.

The whole bet is the AssemblyScript lowering: does the AS I emit behave, field-for-field in the store, like a subgraph a competent human would have hand-written? I don't want you to take my word for it, so the kill/pivot threshold is falsifiable and automated. There's a conformance gate that store-diffs a real graph-node deployment of Redstart's output against an idiomatic hand-written reference at a fixed block. If they ever disagree on a single field, Redstart is wrong and the gate goes red. That's the bar. It's in `conformance/`; you can run it with nothing but Node.

Two things that gate already proves. First, the eject path holds for the *whole* feature surface, not a toy — `graph codegen` and `graph build` compile the generated subgraph into WASM with zero manual edits for `examples/factory`, a single project exercising event, call, and block handlers (on a source *and* a template), dynamic data sources with context, control flow, and an enum. (It caught a template-import-path bug on the way in, which is exactly why the gate exists.) Second, there's a faithful Redstart port of PaulieB14's real Graph Horizon indexer in the repo — three Arbitrum contracts, helper functions, timeseries and aggregations — ejecting to WASM unmodified, with seven native handler tests.

## What it is, and what it isn't

Redstart does not make indexing faster. It makes *staying on The Graph's decentralized network pleasant* — which, after years of watching people reach for a centralized alternative the moment AssemblyScript bit them, I think is the metric that actually matters. It's scoped as a Graph-Foundation-grant public good, in the lineage of Matchstick — the same Matchstick this story started with, which makes the loop a tidy one to close. It's not a venture bet. It's a single binary, batteries included — the Gleam/Elm/Prisma model — under MIT.

## The fourth try

The Graphite announcement ended: "AssemblyScript is not the only option anymore." That was true, and it wasn't enough. You could write Rust — but you were still feeding a runtime I had to forge by hand, and still herding three files that didn't know about each other.

The attempt that works is the one that stops fighting. You don't write AssemblyScript. You don't maintain a fake one. You don't flee to a different paradigm. You write one checked language, it emits AssemblyScript you'd be happy to read, and the compiler the whole network already trusts takes it from there. The footguns aren't documented — they're gone. The drift isn't caught — it's unrepresentable. And the day you want out, the exit is one build command, and the lights stay on.

I started in 2021 by building the tool that made AssemblyScript bearable. I spent the five years since learning the difference between hating a language and fighting its runtime — through a forgery, a rejected patch, a runtime I now maintain, and a whole component runtime built to run away. Redstart is what's left when you finally stop doing all of that and just write a compiler that targets the thing already in front of you.

## Get started

```bash
# Homebrew (macOS + Linux) — pre-compiled, no Rust required
brew install nightswatchhq/tap/redstart

# or with a Rust toolchain
cargo install --git https://github.com/nightswatchhq/redstart redstart-cli

redstart new my-subgraph
redstart check my-subgraph
redstart build my-subgraph
redstart test  my-subgraph
redstart dev   my-subgraph     # watch: check → build → test on save
```

- **GitHub:** [github.com/nightswatchhq/redstart](https://github.com/nightswatchhq/redstart)
- **Worked examples:** `examples/erc20` (split across two modules), `examples/factory`, `examples/horizon-indexer`
- **The Night's Watch:** if you want to help harden the open data layer, the door's open.

If Redstart saves you one three-hours-into-a-sync afternoon, it's done its job. If you want it to keep getting better, [the tip jar is here](https://github.com/sponsors/cargopete).
