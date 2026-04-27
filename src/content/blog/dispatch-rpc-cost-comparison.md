---
title: "Dispatch vs Alchemy vs Infura: Real RPC Pricing Numbers"
date: "2026-04-22"
author: "cargopete"
tags: ["dispatch", "rpc", "alchemy", "infura", "pricing", "infrastructure"]
category: "Analysis"
excerpt: "Concrete, code-derived cost comparisons between Dispatch and the major centralised RPC providers — plus a step-by-step guide to getting an RPC URL from the Dispatch network today."
---

> **This is an experimental, unofficial, community-led project.**
>
> Dispatch is not affiliated with The Graph Foundation or Edge & Node. It is an independent experiment exploring decentralised JSON-RPC on Horizon. Not production-ready. Use accordingly.

Every time someone compares "centralised vs decentralised RPC" the pricing numbers are either missing, wrong, or hand-wavy. This post uses concrete numbers derived directly from the Dispatch source code — specifically the `base_price_per_cu` constant in `dispatch-gateway` — and compares them against Alchemy, Infura, and QuickNode's published CU pricing.

Then it shows you exactly how to get a working RPC URL from the Dispatch network in under two minutes.

---

## The pricing model

Dispatch prices by **compute unit (CU) weight**. Every request has a CU weight depending on how expensive it is to serve. The gateway multiplies that weight by a configurable `base_price_per_cu` to produce a GRT receipt value. That receipt gets signed and sent to the provider alongside the request — payment happens off-chain and settles on Arbitrum One periodically via GraphTally (TAP v2).

The current default, hardcoded in the gateway source:

```
base_price_per_cu = 4_000_000_000_000  (GRT wei per CU)
```

GRT has 18 decimal places, so this is **4×10⁻⁶ GRT per CU**.

CU weights per method:

| Method | CU weight |
|---|---|
| `eth_blockNumber`, `eth_chainId`, `net_version` | 1 |
| `eth_getBalance`, `eth_getCode`, `eth_getTransactionCount`, block queries | 5 |
| `eth_call`, `eth_estimateGas`, `eth_getTransactionReceipt` | 10 |
| `eth_getLogs` | 20 |

---

## The comparison

Alchemy's CU system uses different weights (26 CU for `eth_call`, 75 CU for `eth_getLogs`) at $0.45 per million CUs. The table below converts everything to a single unit: **USD per million calls**.

**At $0.09/GRT (current price range):**

| Method | Dispatch | Alchemy | Infura | QuickNode |
|---|---|---|---|---|
| `eth_blockNumber` | **$0.36/M** | $4.50/M | $4–8/M | $5–7/M |
| `eth_getBalance` | **$1.80/M** | $4.50/M | $4–8/M | $5–7/M |
| `eth_call` | **$3.60/M** | $11.70/M | $8–12/M | $11–15/M |
| `eth_getLogs` | **$7.20/M** | $33.75/M | $20–40/M | $30–60/M |

Dispatch is **3–5× cheaper** than Alchemy at current GRT prices.

### GRT price sensitivity

Dispatch pricing is denominated in GRT, so USD cost moves with the token price. Here's `eth_call` across a range of GRT prices:

| GRT price | Dispatch eth_call /M | vs Alchemy $11.70/M |
|---|---|---|
| $0.05 | $2.00/M | **5.9× cheaper** |
| $0.09 | $3.60/M | **3.3× cheaper** |
| $0.15 | $6.00/M | **1.95× cheaper** |
| $0.29 | $11.60/M | roughly equal |
| $0.45 | $18.00/M | 1.5× more expensive |

**Break-even on `eth_call` vs Alchemy: ~$0.29/GRT.**
**Break-even on `eth_getLogs` vs Alchemy: ~$0.42/GRT.**

GRT has traded above $0.29 only during peak 2021/2024 bull periods. At any price you're likely to encounter in 2025/2026, Dispatch is cheaper on a per-call basis.

### What you're not getting

The cost delta is real, but centralised providers have meaningful advantages right now:

| | Alchemy / Infura | Dispatch |
|---|---|---|
| Uptime SLA | ✓ 99.9%+ | ✗ best-effort, single provider |
| Global edge nodes | ✓ many regions | ✗ single EU-central VPS |
| Chain coverage | ✓ 40+ chains | ✗ Arbitrum One only |
| Archive data | ✓ | ✓ (Arbitrum One) |
| Debug/trace | ✓ | ✓ (Arbitrum One) |
| Censorship resistance | ✗ ToS-bound | ✓ |
| Response attestation | ✗ | ✓ signed by provider |
| Account required | ✓ KYC/email | ✗ just GRT |

The network currently has one provider. "Decentralised" is the direction, not the present state.

---

## Getting a working RPC URL

Three paths, from zero-config to fully trustless.

### Option 1: Direct gateway URL (zero setup, no GRT needed)

The gateway manages escrow on your behalf. Just point your app at it:

```
http://167.235.29.213:8080/rpc/42161
```

That's it. Chain ID 42161 (Arbitrum One) in the path. Works with curl, ethers.js, viem, wagmi, cast — anything that speaks JSON-RPC.

```bash
curl -s -X POST http://167.235.29.213:8080/rpc/42161 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

With viem:

```typescript
import { createPublicClient, http } from "viem";
import { arbitrum } from "viem/chains";

const client = createPublicClient({
  chain: arbitrum,
  transport: http("http://167.235.29.213:8080/rpc/42161"),
});

const block = await client.getBlockNumber();
```

You're trusting the gateway to route honestly and pay providers fairly. Same trust model as Alchemy, different operator.

The gateway also supports chain selection via header if you'd rather use a single base URL:

```bash
curl -s -X POST http://167.235.29.213:8080/rpc \
  -H "Content-Type: application/json" \
  -H "X-Chain-Id: 42161" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

You can verify the attestation header on any non-batch response:

```bash
curl -si -X POST http://167.235.29.213:8080/rpc/42161 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  | grep x-drpc-attestation
```

The attestation is a provider-signed `{signer, signature}` JSON blob over `keccak256(chain_id || method || keccak256(params) || keccak256(result))`. The gateway verifies every attestation before forwarding — a provider that returns wrong or inconsistent responses gets penalised in QoS scoring.

---

### Option 2: dispatch-proxy (drop-in, your own key)

The proxy runs a standard JSON-RPC server on `localhost:8545`. It handles provider discovery, TAP receipt signing, and QoS routing. Your existing app needs zero code changes — just swap the RPC URL.

```bash
git clone https://github.com/cargopete/dispatch
cd dispatch/proxy
npm install
npm start
```

First run generates a consumer keypair and saves it to `./consumer.key`:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
dispatch-proxy v0.1.0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Chain:     Arbitrum One (42161)
Listening: http://localhost:8545
Consumer:  0xABCD...1234
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠  New consumer key generated → ./consumer.key
Fund escrow at:  https://lodestar-dashboard.com/dispatch
Consumer address: 0xABCD...1234
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Fund the escrow at [lodestar-dashboard.com/dispatch](https://lodestar-dashboard.com/dispatch) using the displayed consumer address, then point your app at `localhost:8545`. The proxy prints running totals per request:

```
[12:34:56] ✓ eth_blockNumber      42ms  0.000004 GRT   total: 0.000004 GRT
[12:34:57] ✓ eth_getBalance       38ms  0.000020 GRT   total: 0.000024 GRT
[12:34:58] ✓ eth_call             71ms  0.000040 GRT   total: 0.000064 GRT
```

You're paying providers directly from your own escrow. The gateway is not involved.

**Configuration:**

| Variable | Default | Description |
|---|---|---|
| `DISPATCH_SIGNER_KEY` | *(auto-generated)* | Consumer private key (loaded from `./consumer.key` if not set) |
| `DISPATCH_CHAIN_ID` | `42161` | Chain to proxy |
| `DISPATCH_PORT` | `8545` | Local port |
| `DISPATCH_BASE_PRICE_PER_CU` | `4000000000000` | GRT wei per CU |

---

### Option 3: Consumer SDK (fully trustless)

Signs receipts locally, discovers providers from the on-chain subgraph, no intermediary at all.

```bash
npm install @lodestar-dispatch/consumer-sdk
```

```typescript
import { DISPATCHClient } from "@lodestar-dispatch/consumer-sdk";

const client = new DISPATCHClient({
  chainId: 42161,
  dataServiceAddress: "0x7101D5C1A5c89C3647F5118da118E56C023bA0b9",
  graphTallyCollector: "0x8f69F5C07477Ac46FBc491B1E6D91E2bb0111A9e",
  subgraphUrl: "https://api.studio.thegraph.com/query/1747796/rpc-network/v0.2.0",
  signerPrivateKey: process.env.CONSUMER_KEY as `0x${string}`,
  basePricePerCU: 4_000_000_000_000n,  // GRT wei per CU
});

const blockNumber = await client.request("eth_blockNumber", []);
const balance = await client.request("eth_getBalance", ["0x...", "latest"]);
```

The client handles provider discovery (polling the subgraph), QoS-scored selection, TAP receipt signing, and latency EMA tracking — all in your process.

You need to fund escrow before requests will be accepted. Providers check on-chain escrow balance every 30 seconds and return a 402 for consumers with zero balance. Easiest path is the Lodestar dashboard; manual path via cast:

```bash
# 1. Approve the PaymentsEscrow contract
cast send 0x9623063377AD1B27544C965cCd7342f7EA7e88C7 \
  "approve(address,uint256)" \
  0xf6Fcc27aAf1fcD8B254498c9794451d82afC673E \
  1000000000000000000 \
  --rpc-url https://arb1.arbitrum.io/rpc \
  --private-key $YOUR_KEY

# 2. Deposit (payer, collector, receiver, amount)
cast send 0xf6Fcc27aAf1fcD8B254498c9794451d82afC673E \
  "depositTo(address,address,address,uint256)" \
  $YOUR_CONSUMER_ADDRESS \
  0x8f69F5C07477Ac46FBc491B1E6D91E2bb0111A9e \
  $PROVIDER_ADDRESS \
  1000000000000000000 \
  --rpc-url https://arb1.arbitrum.io/rpc \
  --private-key $YOUR_KEY
```

---

## Deployed addresses (Arbitrum One)

| Contract | Address |
|---|---|
| RPCDataService (proxy) | `0x7101D5C1A5c89C3647F5118da118E56C023bA0b9` |
| GraphTallyCollector | `0x8f69F5C07477Ac46FBc491B1E6D91E2be0111A9e` |
| PaymentsEscrow | `0xf6Fcc27aAf1fcD8B254498c9794451d82afC673E` |
| HorizonStaking | `0x00669A4CF01450B64E8A2A20E9b1FCB71E61eF03` |

Subgraph: `https://api.studio.thegraph.com/query/1747796/rpc-network/v0.2.0`

---

## The honest summary

The cost numbers are real — derived from the deployed `base_price_per_cu` constant and cross-checked with a passing unit test in the gateway source. At current GRT prices, Dispatch is cheaper per call than any of the major centralised providers.

The network is also one VPS and one provider. The economic model works on paper; the network effects that make decentralisation actually useful take more providers. If you're a Graph indexer and already have the stake, [the provider setup is documented here](https://github.com/cargopete/dispatch).

---

## Further reading

- [Dispatch GitHub](https://github.com/cargopete/dispatch)
- [Original Dispatch post — architecture deep dive](/blog/dispatch-json-rpc-horizon)
- [GraphTally / TAP v2 GIP](https://github.com/graphprotocol/graph-improvement-proposals/blob/main/gips/0054-timeline-aggregation-protocol.md)
- [The Graph Horizon documentation](https://thegraph.com/docs/en/horizon/)
