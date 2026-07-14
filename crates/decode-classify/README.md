# decode-classify

Exact parser-parity classifier for the `/disassembly` **Decode Compatibility Audit**.

graph-node 0.42 (PR graphprotocol/graph-node#6063) swapped its `ethereum.decode(typeString, data)`
ABI type-string parser from **ethabi** to **alloy**. alloy is strict where ethabi was absurdly
lenient, so type strings that ethabi accepted now make `decode` return `null` on graph-node
≥0.42 — often as *silent* data loss (see #6683, #6461).

This crate wraps the **real** parsers so classification is exact, not an approximation:

- `ethabi::param_type::Reader::read(s)` — graph-node ≤0.41 behaviour
- `alloy_dyn_abi::DynSolType::parse(s)` — graph-node ≥0.42 behaviour

A type string is **DIVERGENT** iff ethabi accepts it and alloy rejects it. We do **not**
reimplement ethabi in TypeScript — its leniency is bizarre (it parses `" address"` as `uint8`,
`address[` as `uint8`) and any approximation would miss cases.

## Single export

```rust
classify_json(s: &str) -> String
// { "ethabi": string|null, "alloy_ok": bool, "alloy_err": string|null }
```

## Building the committed artifact

The compiled WASM (`src/lib/disassembly/decode-classify/pkg/`) is **checked into the repo** so
CI and Vercel builds need no Rust toolchain. Rebuild only when this crate changes:

```sh
npm run build:classifier   # wasm-pack build --target nodejs → src/lib/disassembly/decode-classify/pkg
```

Then commit the regenerated `pkg/` (the `.js` glue, `_bg.wasm`, and `.d.ts`).

## Parity tests

```sh
cargo test   # native — asserts every verified vector from the audit spec
```
