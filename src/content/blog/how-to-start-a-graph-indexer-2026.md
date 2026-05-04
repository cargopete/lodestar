---
title: "How to Start a Graph Indexer in 2026"
date: "2026-05-04"
author: "cargopete"
tags: ["indexing", "horizon", "infrastructure", "guide", "subgraphs", "chainstack", "hetzner"]
category: "Guides"
excerpt: "We just did this. Everything that the docs don't tell you — hardware, RPC, Horizon's on-chain quirks, graft chains, and the honest economics."
---

We just went through this ourselves. What follows is the guide we wish had existed before we started — drawn from the research we did, the official docs, and the parts that broke.

The short version before the long one: **at GRT's current price (~$0.024), running an indexer on 100–200k GRT is a break-even-at-best operation in USD terms.** That's not a reason not to do it, but it should be the first thing you understand. The rest of this post assumes you've decided to proceed anyway — for strategic, technical, or speculative reasons.

---

## The Economics (Read This First)

Q4 2025 Messari numbers: **75.1M GRT issued to indexers**, but only $4.1M in USD at quarter-end prices. Total network query fees: **$98,667 for the quarter**. Ninety-nine indexers with allocated stake competing for that.

The math at 150k GRT self-stake, no delegation:

- Your share of network stake: ~0.0066%
- Monthly indexing rewards: roughly **1,600–2,000 GRT**
- USD value at $0.024: ~**$40–$48/month gross**
- Fixed costs: Hetzner AX102 + RPC = ~**$180–$220/month**

You're running at a deficit of around $140–$170/month at spot price. Break-even requires one of: GRT recovering to ~$0.10, attracting ≥1M GRT in delegation, or both. Delegation is the actual lever — it multiplies your stake by up to 16× without proportional cost increase.

**Why do it anyway?** A few real reasons: you believe GRT recovers significantly, you want technical skin in the game, you're building on The Graph and want operational insight, or (like us) you're running a dashboard about indexers and want to actually be one. These are all legitimate. Just don't go in expecting a USD profit at current spot.

One more thing: **REO (GIP-0079) is deployed on Arbitrum One and activation is pending a governance vote.** Once live, indexers who don't actually serve real query traffic lose issuance eligibility. "Open allocation and collect rewards" will stop working. Make sure your query path works before REO activates.

---

## Hardware

The sensible single-server choice is a **Hetzner AX102** — Ryzen 9 7950X3D, 128 GB DDR5 ECC, 2×1.92 TB Gen4 NVMe. After Hetzner's April 1, 2026 price adjustment: **€117.30/month in Helsinki**, €122.30 in Falkenstein. Pick Helsinki unless you have a reason not to — it's €5/month cheaper and the latency difference from Falkenstein is irrelevant for indexing.

Check the **Server Auction** first (`hetzner.com/sb`). You'll often find AX102-class hardware at €85–€115 — same specs, slightly older drives. We used an auction server. The rescue-mode OS installation (installimage over the existing OS, RAID 1 mdadm across the two NVMes) took about 20 minutes.

**Postgres tuning for 128 GB RAM.** The defaults are conservative. In `compose-graphnode.yml`, add these postgres command args:

```yaml
command: [
  "postgres",
  "-c", "shared_preload_libraries=pg_stat_statements",
  "-c", "shared_buffers=40GB",
  "-c", "effective_cache_size=80GB",
  "-c", "maintenance_work_mem=2GB",
  "-c", "work_mem=128MB",
  "-c", "max_connections=200",
  "-c", "random_page_cost=1.1",
  "-c", "effective_io_concurrency=200",
  "-c", "checkpoint_completion_target=0.9",
  "-c", "wal_buffers=64MB"
]
```

**OS-level tuning** — add `/etc/sysctl.d/99-indexer.conf`:

```
vm.swappiness=10
vm.overcommit_memory=2
vm.overcommit_ratio=80
net.core.somaxconn=65535
net.ipv4.tcp_max_syn_backlog=65535
fs.file-max=1000000
```

**Self-hosting archive RPC nodes is not worth it at this stake level.** Ethereum Erigon archive: ~1.77 TB. Arbitrum One archive (PathDB): ~3.27 TB growing ~100 GB/month. Base (op-reth): ~7 TB. To run all three in-house you need more hardware than the indexer itself costs. Use third-party RPC until you're at 500k+ GRT stake or taking chain-integration grant work.

---

## RPC: Chainstack + Backup

**Chainstack Growth at $49/month** is the right choice for a new indexer. Twenty million request units, 250 RPS, archive included (2 RU per archive call, no per-method multipliers). Covers Arbitrum, mainnet, Base, BSC, Gnosis, Polygon, and 70+ more chains from one plan.

Add **dRPC at ~$6/M requests** as a secondary endpoint in `config.toml`. graph-node round-robins and fails over — you want this.

One **critical warning about Chainstack plan quota**: the initial historical sync of multiple chains simultaneously is extremely RPC-intensive. We watched 97% of our monthly quota disappear while graph-node was backfilling xdai, BSC, and Base in parallel. The fix: only run the chains you actually need right now. Chains with no active subgraph deployments are pure quota burn. We cut from 5 chains to 3 (arbitrum-one, xdai, base) once we identified the waste.

**Configure Chainstack's Growth plan as your primary and dRPC as fallback**, per chain in `config.toml`:

```toml
[chains.arbitrum-one]
shard = "primary"
provider = [
  { label = "chainstack-arb", url = "https://arbitrum-mainnet.core.chainstack.com/YOUR_KEY", features = ["archive", "traces"] },
  { label = "drpc-arb", url = "https://arbitrum.drpc.org", features = ["archive", "traces"] }
]
```

---

## The Stack

Use **StakeSquid's `graphprotocol-mainnet-docker`** for a single-server setup. It's Docker Compose, includes Prometheus/Grafana/alerting, and is the fastest on-ramp. Update the image versions to Horizon-ready builds:

```
GRAPH_NODE_VERSION=graphprotocol/graph-node:v0.41.1
INDEXER_SERVICE_VERSION=ghcr.io/graphprotocol/indexer-service-rs:1.8.0
INDEXER_AGENT_VERSION=ghcr.io/graphprotocol/indexer-agent:v0.25.5
INDEXER_TAP_VERSION=ghcr.io/graphprotocol/indexer-tap-agent:1.12.3
```

**Do not use StakeSquid's `config.tmpl` for multi-chain setups.** The template only supports a single chain via `CHAIN_0_NAME`/`CHAIN_0_RPC` env vars. For multiple chains, write a static `graph-node-configs/config.toml` directly and patch `start-essential` to not overwrite it:

```bash
# In start-essential, replace the envsubst line with:
[ -f graph-node-configs/config.toml ] || envsubst < graph-node-configs/config.tmpl > graph-node-configs/config.toml
```

**Chain naming matters.** The network name in your `config.toml` must match what subgraph manifests declare. Gnosis chain is `xdai` in manifests — not `gnosis`. If you name it `gnosis` you'll get `network not supported: no network xdai found` errors on every Gnosis subgraph deploy attempt. Set `[chains.xdai]`, not `[chains.gnosis]`.

**TAP migrations.** `indexer-service-rs` and `indexer-tap-agent` require TAP database tables to exist before they'll start. The agent (Node.js `indexer-agent`) runs the Sequelize migrations that create these tables — but only if it can successfully reach its RPC endpoint. If your RPC is down (or your Chainstack invoice is unpaid), the agent crashes before migrating, and the service and tap containers crash-loop in a confused heap. Fix the RPC issue first; let the agent run and migrate; everything else starts clean. Do not manually apply TAP SQL migrations — it creates function conflicts that are painful to unwind.

---

## On-Chain Setup (Horizon / SubgraphService)

This is where the Horizon docs are incomplete and the actual ABI is your best friend.

**Wallet architecture:**
1. **Staking wallet** — holds your GRT, signs provision/stake transactions. Use a hardware wallet or Safe multisig. Cold.
2. **Operator wallet** — a hot mnemonic that the indexer-agent uses for allocation and POI transactions. Fund with ~0.05 ETH on Arbitrum One. The agent logs `ETHBalance: 0` if this is empty and quietly refuses to submit any transactions.

**The four transactions you need, in order:**

```bash
# 1. Approve the staking contract to spend your GRT
cast send $GRT_TOKEN "approve(address,uint256)" $STAKING_CONTRACT $AMOUNT \
  --rpc-url $ARB_RPC --private-key $STAKING_KEY

# 2. Stake
cast send $STAKING_CONTRACT "stake(uint256)" $AMOUNT \
  --rpc-url $ARB_RPC --private-key $STAKING_KEY

# 3. Provision to SubgraphService
cast send $STAKING_CONTRACT \
  "provision(address,address,uint256,uint32,uint64)" \
  $INDEXER_ADDRESS $SUBGRAPH_SERVICE $AMOUNT 1000000 2419200 \
  --rpc-url $ARB_RPC --private-key $STAKING_KEY

# 4. Set operator (note: 3 params in Horizon, not 2)
cast send $STAKING_CONTRACT \
  "setOperator(address,address,bool)" \
  $SUBGRAPH_SERVICE $OPERATOR_ADDRESS true \
  --rpc-url $ARB_RPC --private-key $STAKING_KEY
```

Key addresses (Arbitrum One, verify against current address book):
- Staking contract: `0x00669A4CF01450B64E8A2A20E9b1FCB71E61eF03`
- SubgraphService: `0xb2Bb92d0DE618878E438b55D5846cfecD9301105`
- GRT token: `0x9623063377AD1B27544C965cCd7342f7EA7e88C7` — note the last two characters are `C7`, not `C0`. The wrong address exists onchain and has no code.

**`setOperator` changed in Horizon.** It's now a 3-parameter function: `setOperator(address verifier, address operator, bool allowed)`. The first argument is the *verifier* (SubgraphService address), not the indexer address. If you're using an old script or ABI that calls the 2-param version, it will revert. Find the correct ABI in the agent container's bundled `@graphprotocol/interfaces` NPM package if you're unsure.

**Verifying the operator was set.** `isOperator` also has the arguments in a non-obvious order: `isOperator(operator, indexer)` — operator first, indexer second. Call it that way or you'll get `false` even when the operator is set correctly.

---

## Allocation Strategy

You have 100–200k GRT. The network has ~2.26B GRT total stake. If you allocate to the same mega-subgraphs as everyone else (Uniswap V3, Graph Network Arbitrum, Snapshot) you capture approximately your proportional share — which is ~0.007% of rewards. That's not interesting.

The move is to find subgraphs with high **curator signal relative to total staked** on that specific deployment. The signal/stake ratio tells you how much above or below average that deployment pays per staked GRT. Ratio > 1 means you earn above average; ratio < 1 means you're subsidising the curation signal.

To find these, query the network subgraph directly:

```graphql
{
  subgraphDeployments(
    first: 50
    orderBy: signalledTokens
    orderDirection: desc
    where: { stakedTokens_gt: "1000000000000000000000" }
  ) {
    ipfsHash
    stakedTokens
    signalledTokens
    versions(first: 1) {
      subgraph { metadata { displayName } }
    }
  }
}
```

Then compute `signalledTokens / stakedTokens` for each. Anything above 1.2 is worth investigating further.

**Graft chains are a silent trap.** Many high-signal subgraphs are grafted — they start from the final state of a previous deployment rather than from genesis. If you try to deploy a grafted subgraph without first having the graft base synced, you get `graft base is invalid: deployment not found`. The base itself may also be a graft, and so on recursively. We hit a four-level graft chain on Pancakeswap V3 BNB that would have taken months to resolve.

Before allocating to a subgraph, check its manifest:

```bash
curl -s "https://ipfs.network.thegraph.com/api/v0/cat?arg=<IPFS_HASH>" | grep -A3 "^graft:"
```

If there's a graft, check that base too. Three or more levels deep on a high-throughput chain like BSC means weeks of prerequisite sync work. Either account for this in your planning or choose a non-grafted deployment with comparable signal/stake ratio.

**Set rules via the CLI container.** StakeSquid's compose includes a `cli` container with `graph indexer` already configured:

```bash
# Set global default
docker exec cli graph indexer rules set global allocationAmount 1000 --network arbitrum-one

# Target a specific deployment
docker exec cli graph indexer rules set <IPFS_HASH> \
  allocationAmount 50000 decisionBasis always --network arbitrum-one

# Sync a graft prerequisite without allocating
docker exec cli graph indexer rules prepare <GRAFT_BASE_HASH> --network arbitrum-one
```

**Auto-graft handles this automatically.** As of indexer-agent v0.24.3, there's an `--enable-auto-graft` flag (or `INDEXER_AGENT_ENABLE_AUTO_GRAFT=true`) that makes the agent detect graft dependencies, deploy them in the correct order, sync each to the required block, and pause them — recursively, all the way down the chain. It's off by default. If you're indexing anything with deep graft chains, turn it on and save yourself the archaeology:

```bash
# In your indexer-agent environment
INDEXER_AGENT_ENABLE_AUTO_GRAFT=true
```

**Set a cost model before allocations open** or the gateway won't route queries to you:

```bash
echo "default => 0.00025;" > /tmp/cost.agora
docker cp /tmp/cost.agora cli:/tmp/cost.agora
docker exec cli graph indexer cost set model global /tmp/cost.agora --network arbitrum-one
```

**The operator wallet needs ETH before any of this works.** The agent logs `"Current operator ETH balance": 0` and silently skips all allocation transactions. 0.05 ETH on Arbitrum covers hundreds of allocation operations at current gas prices — top it up once and forget about it.

---

## What Actually Takes Time

The operation that surprises most new indexers is the sync time. graph-node has to replay every block from a subgraph's `startBlock` to the current chain head before the deployment is healthy and the agent will open an allocation for it.

Rough real-world sync rates (with Chainstack Growth at 250 RPS):

| Chain | Blocks/day (approx) | Notes |
|---|---|---|
| Gnosis (xdai) | 800k–1.5M | 5s blocks, light transactions |
| Base | 2M–5M | 2s blocks, lower event density helps |
| Arbitrum | 5M–10M | Fast catch-up, high block count |
| BSC | 500k–800k | High transaction density, RPC-intensive |

A subgraph that starts at block 10M on Gnosis (current head ~46M) needs to replay 36M blocks. At 1M blocks/day that's five to six weeks of sync before the allocation opens. Plan around this.

The agent won't open an on-chain allocation until the subgraph passes its health check (`synced: false` but `health: "healthy"` is normal during catchup — the allocation opens once `synced: true`). This is the right behaviour: you don't want to open an allocation and commit to a POI on a deployment that isn't at chain head.

---

## Monitoring

The StakeSquid stack includes Prometheus, Grafana, AlertManager, cAdvisor, and NodeExporter pre-configured. Worth adding:

- Alert on POI staleness > 20 days (you have 28 before forced closure)
- Alert on subgraph health regressions (healthy → unhealthy)
- Alert on RPC error rate > 1%
- Watch `docker logs indexer-agent` — it logs at INFO level by default and is readable

**indexerscore.com** (Graphtronauts) tracks your indexer's public score: 70% Allocation Efficiency Ratio + 30% Query Fee Ratio. Check it weekly once allocations are open. It'll tell you faster than anything else if the gateway has stopped routing to you.

Attend **Indexer Office Hours on Tuesdays at 17:00 UTC** in the Graph Discord. Most of what isn't in any doc lives in those archives.

---

## Common Failures

Things we hit or saw others hit:

- **Chainstack invoice goes unpaid → RPC returns 403 → agent can't reach chain → TAP migrations never run → service and tap crash-loop.** Pay your invoice. The cascade is non-obvious.
- **`setOperator` reverts with the old 2-param ABI.** Use the 3-param Horizon ABI. The verifier (SubgraphService) is the first argument.
- **Gnosis subgraphs fail with "network xdai not found".** Your `config.toml` chain name must be `xdai`, not `gnosis`.
- **Grafted subgraph deploy fails with "graft base not found".** Find the full graft chain and queue each ancestor as `offchain` before trying to deploy the target.
- **Agent submits no allocation transactions despite rules being set.** Check operator ETH balance first. Then check `docker logs indexer-agent` for health check failures.
- **Subgraph stuck N blocks behind chain head indefinitely.** See our [graph-node sync lag post](/blog/arbitrum-indexer-infrastructure) — it's usually `reorg_threshold` too high or `eth_call` latency in mappings.
- **`config.toml` gets overwritten on every restart.** Patch `start-essential` to only generate it if missing (see stack section above).

---

## The Decision Framework

| Condition | Action |
|---|---|
| GRT < $0.04 sustained, delegation < 500k | Running at a loss. Reduce to minimum viable setup or exit. |
| GRT ≥ $0.08 OR delegation ≥ 1M GRT | Profitable territory. Scale hardware, add chains. |
| REO activates | Verify real query traffic is flowing before the vote passes. |
| DIPs (GIP-0087/0088) launch | Bid on direct indexing agreements early. Consumer-funded indexing will matter. |

The minimum viable setup that's not losing money significantly requires either token price recovery or 500k+ GRT in delegation. Delegation takes time to attract — clean POIs, visible query serving, and a few months of track record. Engage the community; delegators at Graphtronauts (`t.me/graphtronauts`) do pay attention to new indexers.

---

We'll update this as our own stack matures. The allocations aren't open yet — we're still syncing. But the on-chain setup is complete, the stack is running, and the first subgraphs are in the queue. More when there's something to show.
