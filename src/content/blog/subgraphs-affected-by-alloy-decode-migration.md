---
title: "Which subgraphs break under graph-node 0.42? A network-wide decode audit"
date: "2026-07-14"
author: "cargopete"
tags: ["the-graph", "graph-node", "subgraphs", "alloy", "ethabi", "poi", "disassembly", "lodestar", "wasm"]
category: "News"
excerpt: "graph-node 0.42 swapped its ABI decoder from ethabi to alloy, and alloy is strict where ethabi was absurdly lenient — so some ethereum.decode() calls now silently return null and subgraphs quietly stop producing data. The type string is a compile-time constant in the mapping WASM, so the whole network is auditable without syncing a thing. I scanned all 7,668 signalled deployments. Eight are affected."
---

*graph-node 0.42 swapped its ABI decoder from ethabi to alloy. alloy is strict where ethabi was absurdly lenient, so a class of `ethereum.decode()` calls now silently returns `null` — and subgraphs quietly stop producing data while still reporting healthy. The affected type string is a compile-time constant baked into the mapping WASM, so you can audit the entire network statically, without syncing anything. I did. Eight signalled subgraphs are affected.*

---

## The bug nobody sees

It started, as these things do, in Discord. An indexer's POIs were diverging on a Circle CCTP subgraph. Then another. Marc-André from Ellipfra traced it to the root cause and [wrote it up as graph-node #6683](https://github.com/graphprotocol/graph-node/issues/6683): the 0.42 migration from the `ethabi` crate to `alloy` for parsing `ethereum.decode(typeString, data)` calls.

The nasty part is the *silent* failure mode. A mapping that null-checks the decode result and early-returns keeps its subgraph **synced and healthy** while dropping every entity on the floor. No deterministic failure, no red flag in the UI — just data that quietly went stale weeks ago. One of the CCTP subgraphs had produced zero data points since June 30th and looked perfectly fine the whole time.

Then Tehn asked the question that started this post:

> I could imagine how many such cases occurred for other subgraphs — can we see which subgraphs are affected by this?

Yes. And you don't need to sync a single block to find out.

## Why this is a static-analysis problem

The type string passed to `ethereum.decode` is, in almost every real subgraph, a **compile-time constant**. It sits in the WASM mapping's data segment as a literal — `(uint32,uint32,uint32,uint64,bytes32,bytes32,bytes32,bytes128)` and friends. The mapping WASM is content-addressed on IPFS and fetchable by deployment ID. [Lodestar's subgraph disassembler](/disassembly) already pulls and statically parses exactly these modules.

So the audit is: fetch the deployed WASM, recover the string constants, and for each ABI-shaped candidate, ask *"does ethabi accept this but alloy reject it?"* If yes, that deployment breaks on graph-node ≥0.42.

The one rule I set myself: **do not reimplement the parsers.** ethabi's leniency is genuinely deranged, and any approximation would miss cases. So I compiled the *real* `ethabi 18` and `alloy-dyn-abi 0.8` crates to WASM and let them adjudicate. Exact parity, no guessing.

## It's worse than just `bytes128`

Diffing the two parsers directly turns up several divergence classes, not one:

| type string | ethabi (≤0.41) | alloy (≥0.42) | verdict |
|---|---|---|---|
| `bytes128`, `bytes33`, `bytes0` | `FixedBytes(n)` | reject | alloy caps fixed-bytes at 32 |
| `uint255`, `uint257` | `Uint(n)` | reject | non-multiple-of-8 widths |
| `uint8[0]` | `FixedArray(Uint(8),0)` | reject | zero-length fixed array |
| `unit8` (a typo!) | **`Uint(8)`** | reject | ethabi's fallback for *anything* it can't parse |
| `" address"` (leading space) | **`Uint(8)`** | reject | the [#6461](https://github.com/graphprotocol/graph-node/issues/6461) case |

The last two rows are the interesting ones. ethabi's parser, when handed a string it doesn't recognise, doesn't error — it **silently falls back to `Uint(8)`**. So a subgraph that decoded `" address"` (with a stray leading space) or a misspelt `unit8` was never decoding the field it thought it was. It was producing `uint8` garbage the whole time — deterministic garbage that every indexer agreed on, so nobody noticed. alloy just made the pre-existing bug visible.

## The scan

The driver walks the network subgraph → every signalled deployment → its manifest on IPFS → the deduplicated mapping WASMs → the classifier. WASM dedup matters: tons of deployments share mapping code, so the unique-module count is what actually gets fetched.

- **7,668** signalled deployments
- **17,912** unique mapping WASMs fetched and parsed from IPFS
- **402** import `ethereum.decode`
- **8** carry a type string that ethabi accepts and alloy rejects

## The affected deployments

Each links to its full Lodestar disassembly and decode audit.

| Subgraph | Signal (GRT) | Divergent type string | alloy says |
|---|--:|---|---|
| [CCTP Arb One](/disassembly/QmQtNd36amtQ8h8GF5rwkLLWyyBGwqad3j3WgZAMuLvDMd) | 5,735 | `(uint32,…,bytes32,bytes128)` | invalid size for type: bytes128 |
| [CCTP Ethereum](/disassembly/QmWgi6hNfwCGiTAhH7gTSMSfvvYUPRbBQSjRmvuviRGGwy) | 5,689 | `(uint32,…,bytes32,bytes128)` | invalid size for type: bytes128 |
| [solv-payable-factory-arbitrum](/disassembly/QmNzLPf8zvkM2G3QJqmyiQ3pNE9nbiEb3ddxcUZe3LYcbc) | 4,950 | `(address,address,uint256,`**`unit8`**`,int32,…)` | invalid type string: unit8 |
| [CCTP Sepolia](/disassembly/QmXmPT7cB45DsPc9AwKywyRBZJDxW8JCMhxTLhcwDvEG42) | 118 | `(uint32,…,bytes32,bytes128)` | invalid size for type: bytes128 |
| [CCTP Arb Sep](/disassembly/QmTBhQokLsyBW5PztZeKPg7hpC49aH7sY4DyPHu4ceyM3T) | 51 | `(uint32,…,bytes32,bytes128)` | invalid size for type: bytes128 |
| [cctp-arb-one Upgraded](/disassembly/QmXF3MrvJYw2jLgBVpzrsgUa8R1g8r5viXn8NGN2jjtXoD) | 1 | `(uint32,…,bytes32,bytes128)` | invalid size for type: bytes128 |
| [cctp-mainnet](/disassembly/QmZbWhnBTTwTMANmFqWwQLLngKdyCbx73fD9iLQQbZ8mEu) | 1 | `(uint32,…,bytes32,bytes128)` | invalid size for type: bytes128 |
| [CCTP Arb Sep](/disassembly/QmbRRPyMoKTcAzFhVyeutD6CM6NaccuhHRjkE3oNaksuPs) | 0 | `(uint32,…,bytes32,bytes128)` | invalid size for type: bytes128 |

Two stories in that table:

**The `bytes128` cluster** — all seven are Circle CCTP deployments. `bytes128` is not a valid Solidity type; the ABI it came from should have used `bytes`. ethabi waved it through as a 128-byte fixed array; alloy correctly refuses. This is the exact #6683 case, now enumerated across every chain it was deployed to.

**The `unit8` typo** — `solv-payable-factory-arbitrum`, carrying nearly 5,000 GRT of signal, decodes against `(address,address,uint256,unit8,…)`. That `unit8` is a typo for `uint8`. ethabi's fallback silently parsed it as `Uint(8)`, so the subgraph has been producing data all along — data that happened to be correct only because `Uint(8)` is what they meant anyway. On 0.42 the free pass ends. A latent typo, dormant for the life of the subgraph, detonated by a decoder upgrade.

## An honest note on rigour

The first pass of this scan reported **25** affected deployments. Seventeen were false.

The disassembler recovers strings by reconstructing the WASM's linear memory, and occasionally a printable byte from an adjacent object's header gets glued onto the end of a constant — `(address,address,uint256,bool)` comes back as `(address,address,uint256,bool)L`. And because ethabi parses *any* unparseable string as `Uint(8)`, that stray `L` manufactured a phantom divergence out of a perfectly valid tuple. The fix was to classify only the *cleaned* form of each string, never the raw one — while carefully preserving leading whitespace, because a leading space is a real divergence, not junk. Re-audited, the list collapsed to the eight above. A good reminder that ethabi's leniency doesn't just break subgraphs — it'll happily lie to your scanner too.

## Caveats

- **Scope:** deployments with curation signal > 0. An unsignalled-but-indexed deployment wouldn't appear here.
- **No dataflow:** this is a static data-segment scan. A flagged string is present in the mapping but not *proven* to be the exact argument passed to `ethereum.decode` — though every module in the list does import it. Dynamically-constructed type strings are invisible to it. In practice I've never seen one in the wild.
- **Snapshot:** as of 2026-07-14. The list shrinks as subgraph authors fix their ABIs.

## Try it on any subgraph

The per-subgraph version of this is live for everyone. Paste any deployment ID into the [disassembler](/disassembly) and expand a data source — if it imports `ethereum.decode`, the **Decode Compatibility Audit** panel tells you whether its type strings survive alloy, and if a divergence is found, whether your indexers are failing loud or losing data in silence.

The fix, in every case, lives with the subgraph author: correct the ABI type string and redeploy. graph-node can't paper over it — and after 0.42, it no longer will.
