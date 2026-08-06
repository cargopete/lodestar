---
title: "Graphite: Write The Graph Subgraphs in Rust"
date: "2026-04-16"
author: "cargopete"
tags: ["graphite", "rust", "subgraphs", "developer-tools", "wasm", "assemblyscript"]
category: "Ecosystem"
excerpt: "AssemblyScript is the only language graph-node accepts, or so everyone assumed. Graphite compiles Rust to WASM that graph-node cannot tell apart from AssemblyScript. No patches. No forks. Already live on Arbitrum One."
---

AssemblyScript is a strange language to build on. It's TypeScript with the standard library ripped out, a custom garbage collector bolted on, and a set of constraints that make many normal programming patterns impossible. No closures that capture state. No real iterators. No crates.io. No `cargo test`. You get type annotations and not much else.

Nobody chose AssemblyScript because they love it. They chose it because graph-node accepts AssemblyScript WASM, and nothing else.

Today that assumption breaks. **Graphite** lets you write subgraph mappings in Rust. The compiled WASM is structurally indistinguishable from AssemblyScript output, so graph-node accepts it without modification, without a fork, without a PR to the protocol.

ERC20 and ERC721 subgraphs are live on The Graph Studio, indexing Arbitrum One right now.

---

## The problem with AssemblyScript

If you've written a production subgraph, you know the pain. The type system fights you constantly. `BigInt` arithmetic requires calling methods instead of operators. Null checks are manual everywhere. The standard library is a stub. Testing requires spinning up a full graph-node stack (Docker, PostgreSQL, an Ethereum archive node) or using Matchstick, which mocks so much of the runtime that you often end up testing the mocks.

The ecosystem is a desert. If a library doesn't exist in AssemblyScript (and most don't), you write it yourself from scratch.

Rust fixes all of this. You get proper closures, iterators, algebraic types, pattern matching, zero-cost abstractions, and crates.io. You get `cargo test` that runs in milliseconds on your laptop, no infrastructure required.

The catch, historically, was that graph-node only speaks AssemblyScript. Nobody wanted to change that.

---

## The key insight

We spent time trying to change graph-node. We wrote a proposal (GRC-003) for a native Rust ABI: a new calling convention, new type layout, first-class Rust support. The maintainers were polite but firm: a second ABI is a permanent maintenance burden, and they weren't going to take it on.

Fair enough. So we asked a different question: *why does graph-node only accept AssemblyScript WASM?*

The answer is simpler than you'd expect. Graph-node does two things when it loads a subgraph WASM:

1. It checks that the manifest declares `language: wasm/assemblyscript`.
2. It reads two fields from each allocated object's 20-byte header: `rtId` (the class ID) and `rtSize` (the payload size in bytes).

That's it. Graph-node doesn't verify the compiler, inspect the toolchain, or validate anything beyond what it needs to actually run the subgraph. Host functions (`store.set`, `log.log`, `ethereum.call`, and so on) are matched by *name only*.

If you give graph-node WASM that:

- Exports `__new(size, rtId) -> ptr` and pins the right functions
- Uses UTF-16LE strings
- Builds `TypedMap` objects with the right class IDs and header layout
- Imports the host functions under their expected names

...it accepts it. Completely. No special cases. No flags.

---

## What Graphite does

Graphite is four crates:

**`graph-as-runtime`** is the core: a `no_std` Rust crate that implements the AssemblyScript memory model. It provides a bump allocator that writes proper AS object headers, UTF-16LE string constructors, `TypedMap` builders (what graph-node reads when you call `store.get`), and all the host function FFI declarations. This crate is what makes the trick work. It compiles to a handful of kilobytes of WASM.

**`graphite-macros`** provides two procedural macros. `#[handler]` takes a normal Rust function and generates both the testable `_impl` version and the `extern "C"` WASM entry point graph-node calls. `#[derive(Entity)]` takes a generated struct and adds `new`, `load`, `save`, `remove`, and typed setters, so writing to the store looks like `Transfer::new(&id).set_from(event.from).set_value(event.value).save()`.

**`graphite-sdk`** is the user-facing library. BigInt, BigDecimal, Bytes, Address, the mock store for testing, crypto utilities, JSON parsing, ENS resolution: everything a subgraph handler needs.

**`graphite-cli`** is the developer toolchain. `graphite init` scaffolds a new project, optionally fetching the ABI from Etherscan. `graphite codegen` reads your ABIs and `schema.graphql` and generates typed Rust structs. `graphite manifest` converts `graphite.toml` to `subgraph.yaml`. `graphite build` compiles to WASM and runs `wasm-opt`. `graphite deploy` uploads to IPFS and registers with graph-node or The Graph Studio.

---

## What it looks like

A complete ERC20 Transfer handler:

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

And the test for it, with no Docker, no PostgreSQL, running in milliseconds:

```rust
#[test]
fn transfer_creates_entity() {
    mock::reset();

    let raw = RawEthereumEvent {
        tx_hash: [0xab; 32],
        params: alloc::vec![
            EventParam { name: "from".into(), value: EthereumValue::Address([0xaa; 20]) },
            EventParam { name: "to".into(),   value: EthereumValue::Address([0xbb; 20]) },
            EventParam { name: "value".into(), value: EthereumValue::Uint(alloc::vec![100]) },
        ],
        ..Default::default()
    };

    handle_transfer_impl(
        &ERC20TransferEvent::from_raw_event(&raw).unwrap(),
        &graphite::EventContext::default(),
    );

    assert_eq!(mock::entity_count("Transfer"), 1);
}
```

The full developer workflow is:

```bash
graphite init my-subgraph --from-contract 0xA0b... --network mainnet
graphite codegen
# write your handlers
cargo test
graphite build
graphite deploy --node https://api.studio.thegraph.com/deploy/ \
  --ipfs https://api.thegraph.com/ipfs/ \
  --deploy-key YOUR_KEY \
  --version-label v1.0.0 \
  my-subgraph-slug
```

---

## Feature parity

Graphite covers the full AssemblyScript graph-ts surface:

| Feature | Status |
|---------|--------|
| Event / Call / Block / File handlers | ✅ |
| `store.set` / `store.get` / `store.remove` / `store.getInBlock` | ✅ |
| `ethereum.call`, `ethereum.encode`, `ethereum.decode` | ✅ |
| `ipfs.cat`, `json.fromBytes`, `ens.nameByAddress` | ✅ |
| `dataSource.create` / factory pattern | ✅ |
| `crypto.keccak256` / `sha256` / `sha3` / `secp256k1.recover` | ✅ |
| `BigInt`: full arithmetic, bitwise, shifts | ✅ |
| `BigDecimal`: full arithmetic | ✅ |
| All GraphQL scalar types | ✅ |
| Block handler filters (`every: N`) | ✅ |
| Native `cargo test` | ✅ |

Six examples ship with the repository: ERC20, ERC721, ERC1155, Uniswap V2 (factory + template pattern), multi-source (multiple contracts in one WASM), and an IPFS file data source example.

---

## Status

This is not a proof of concept. ERC20 and ERC721 subgraphs are deployed to The Graph Studio and indexing Arbitrum One. The entire chain (Rust handler → `graph-as-runtime` → WASM → unmodified graph-node) has been validated on live mainnet data.

GRC-004, a proposal to the Graph Foundation for official recognition of Rust as a first-class subgraph language, is in draft. If you want to see Rust subgraphs become a supported target on The Graph, the RFC is the place to make noise.

---

## Get started

```bash
cargo install graphite-cli
graphite init my-subgraph --network mainnet
```

- **GitHub:** [github.com/cargopete/graphite](https://github.com/cargopete/graphite)
- **Docs:** [cargopete.github.io/graphite](https://cargopete.github.io/graphite)
- **GRC-004 draft:** in the repository at `GRC-draft.md`

The `no_std` overhead is real (`alloc::format!` instead of `format!`, `alloc::vec!` instead of `vec!`), but it's mechanical, and the compiler tells you exactly what to fix. The tradeoff is getting the entire Rust type system, the full crates.io ecosystem, and a test suite you can actually run.

AssemblyScript is not the only option anymore.
