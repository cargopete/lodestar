---
title: "The 3 Rules of Graph-Node Stack Architecture"
date: "2026-03-25"
author: "cargopete"
tags: ["infrastructure", "graph-node", "indexers", "guide"]
category: "Guides"
excerpt: "There are many ways to set up your graph-node stack, but the constraints boil down to 3 rules. A practical guide to node roles, sharding, tiered indexing, and the pitfalls that catch everyone."
---

There are many ways to set up your graph-node stack. You can run a single box or a fleet of specialised nodes. You can shard your Postgres across machines or keep it all on one beefy instance. But no matter how creative you get, three architectural rules must hold — break any of them and things fall apart in ways that are annoying to debug.

These rules are well-known among experienced indexers (credit to Marc-André Dumas / Ellipfra for articulating them clearly), but they're scattered across Discord threads, office hours recordings, and tribal knowledge. This post collects them in one place, along with the advanced patterns that become possible once the fundamentals are solid.

> **Note on Horizon**: The Graph's Horizon upgrade (December 2025) changed the protocol layer significantly — allocations, payments, staking — but graph-node's internal architecture is completely unchanged. Everything in this post applies equally pre- and post-Horizon. We cover the Horizon-era stack differences at the end.

## The stack

A graph-node deployment has four components:

- **graph-node** — the Rust binary that ingests blocks, runs WASM subgraph mappings, stores entity data, and serves GraphQL queries
- **PostgreSQL** — the main store for all subgraph entity data, block caches, deployment metadata, and assignment tables
- **IPFS** — stores subgraph manifests, schemas, and WASM bytecode (network indexers typically use `https://ipfs.thegraph.com`)
- **Chain RPC / Firehose** — blockchain data sources, either JSON-RPC endpoints or gRPC Firehose streams

graph-node sits in the centre: it pulls blocks from chain providers, fetches manifests from IPFS, processes triggers through WASM handlers, writes entities to Postgres, and serves queries back out.

## Rule 1: Single ingestor

**Only one node ingests blocks per chain.**

Block ingestion is configured in the `[chains]` section of your `config.toml`:

```toml
[chains]
ingestor = "block_ingestor_node"
```

The node whose `--node-id` matches the `ingestor` value is the one that polls chain heads and writes new blocks into the block cache. Every other node must either have a different `--node-id` or set `DISABLE_BLOCK_INGESTOR=true` as a hard safety override.

**Why this matters**: Block ingestion is a single-writer process. If two nodes ingest the same chain, you get duplicate blocks in the cache, wasted RPC calls, and burnt provider rate limits. It won't corrupt data, but it's wasteful and can cause confusing log noise.

**Practical tip**: Always set `DISABLE_BLOCK_INGESTOR=true` on every node that isn't the designated ingestor. Don't rely solely on the name mismatch — the env var is a belt-and-braces safety net.

## Rule 2: Every instance supports every chain

**All graph-node instances need RPC/Firehose access to every chain in your config.**

Even if a node is only indexing Arbitrum subgraphs today, it needs providers for Ethereum mainnet, Gnosis, and every other chain you've configured. This applies to query nodes too.

**Why this matters**: Subgraphs can be reassigned to any node at any time via `graphman reassign`. If the target node doesn't have providers for that subgraph's chain, it will fail. Query nodes also need chain metadata to properly resolve queries and check block freshness. The `[chains]` config is shared across all nodes reading that config file — there's no per-node chain filtering.

## Rule 3: Full networking and low latency between all nodes and PG shards

**Every graph-node instance must have fast, reliable access to every PostgreSQL shard.**

In a sharded setup, shards communicate with each other using `postgres_fdw` (foreign data wrapper). The primary shard holds system-wide metadata that all other shards need. Firewall rules must allow traffic between all shards, and `pg_hba.conf` must permit cross-shard connections.

**Why this matters**: High latency between nodes and Postgres causes connection pool exhaustion, query timeouts, and indexing stalls. The default `GRAPH_STORE_CONNECTION_TIMEOUT` is only 5000ms. If your query node can't reach a shard in time, the query fails.

**Practical tip**: Keep graph-node instances and Postgres shards in the same datacenter or availability zone. Cross-region setups are asking for trouble.

## Node roles

Every graph-node instance has a role determined by its `--node-id` (or `GRAPH_NODE_ID` env var) and the config:

### Index nodes

The workhorses. They process blocks, run WASM handlers, and write entity data. Started with a unique node ID (e.g., `index_node_0`). Subgraphs are assigned to them via the `subgraphs.subgraph_deployment_assignment` table in Postgres.

### Query nodes

Configured via regex in the TOML:

```toml
[general]
query = "query_node_.*"
```

Any node whose ID matches this pattern becomes query-only — it won't index anything, just serves GraphQL. Query nodes get their own pool sizes (typically much larger than index nodes) since they're handling concurrent read traffic.

### The ingestor

The single node named in `[chains] ingestor = "..."`. It polls chain heads and ingests blocks. It can simultaneously index subgraphs too — there's no rule that says the ingestor must be dedicated.

### Node IDs are persistent

Each node ID must be unique across your cluster and should stay the same across restarts. Subgraphs are assigned to *node IDs*, not to physical machines. If you restart a node with a different ID, its subgraphs become orphaned until you reassign them.

## Managing subgraphs with graphman

`graphman` is the CLI tool for managing deployments:

```bash
# Move a subgraph to a different node
graphman --config config.toml reassign <DEPLOYMENT> <NODE_ID>

# Pause indexing by assigning to a non-existent node
graphman reassign QmXYZ... paused_node_0

# Resume by assigning back to a real node
graphman reassign QmXYZ... index_node_0

# Stop indexing entirely (removes the assignment)
graphman unassign QmXYZ...
```

The reassign trick of using a non-existent node ID is a clean way to pause indexing without losing state — the subgraph keeps its progress but no running node picks it up.

## Advanced patterns

Once the three rules are satisfied, you can get creative with how you organise your stack.

### Index-node tiers

Create nodes with different resource allocations for different workloads:

```toml
[deployment]
[[deployment.rule]]
match = { name = "(uniswap|aave)/.*" }
shard = "vip"
indexers = [ "index_node_fast_0", "index_node_fast_1" ]

[[deployment.rule]]
match = { network = "gnosis" }
indexers = [ "index_node_slow_0" ]

[[deployment.rule]]
# Catch-all
shards = [ "sharda", "shardb" ]
indexers = [ "index_node_general_0", "index_node_general_1" ]
```

Heavy subgraphs (Uniswap, Aave) go to beefy "fast" nodes. Lightweight ones share resources on "general" nodes. You can manually move subgraphs between tiers with `graphman reassign` based on their actual indexing needs.

Pool sizes support this pattern with regex matching:

```toml
pool_size = [
  { node = "index_node_fast_.*", size = 30 },
  { node = "index_node_general_.*", size = 20 },
  { node = "query_node_.*", size = 80 }
]
```

Rules match in order — first match wins. **It's an error if no rule matches a running node**, so always include a catch-all.

### Tiered shards

Move subgraphs between PostgreSQL shards based on their needs using `graphman copy`:

```bash
# Copy a deployment to the vip shard, activate when caught up, replace the source
graphman copy create --activate --replace <DEPLOYMENT> <DEST_SHARD>

# Check copy progress
graphman copy list
graphman copy stats sgdDEST
```

The copy runs in the background — it copies existing data, then indexes independently until it catches up to chain head. Once caught up, `--activate` makes it the live copy and `--replace` marks the source for cleanup (deleted ~8 hours later by the reaper).

**When to shard**: Start with a single shard. Only add shards when one Postgres instance is maxed out. A good pattern is:

- Small primary shard for metadata only
- Dedicated shards for high-traffic subgraphs (few subgraphs, fast storage)
- Shared shards for low-traffic subgraphs (many subgraphs per shard)
- Separate shards for block caches if they're eating disk

### PG replicas for query load

Each shard can have read replicas with weighted query distribution:

```toml
[store.primary]
connection = "postgresql://graph:pass@primary/graph"
weight = 0          # Zero queries to the writer
pool_size = 10

[store.primary.replicas.repl1]
connection = "postgresql://graph:pass@replica1/graph"
weight = 1

[store.primary.replicas.repl2]
connection = "postgresql://graph:pass@replica2/graph"
weight = 1
```

Setting `weight = 0` on the primary means all query traffic goes to replicas, keeping the writer free for indexing.

**The catch**: Replicas have replication lag. A query hitting a replica may see data a few seconds (or under heavy load, minutes) behind what's been written. This means a subgraph's "latest block" on a replica might be stale, and entity data could be a few blocks behind. For most use cases this is fine — but if you need strict consistency, be aware of the tradeoff.

### Custom query proxy

The graph-node docs recommend not exposing ports 8000/8001 directly. In practice, operators put nginx or HAProxy in front of query nodes for load balancing, rate limiting, TLS termination, and routing by subgraph. You could even build a custom proxy that routes queries to different query nodes based on subgraph characteristics.

## Common misconfigurations

### Duplicate node IDs

Running two graph-node instances with the same `--node-id` is the classic blunder. Both nodes try to index the same subgraphs (assignments are keyed to node ID), causing write collisions:

```
"subgraph has already processed block; there are most likely two (or more)
nodes indexing this subgraph"
```

**Docker gotcha**: The default Docker entrypoint replaces hyphens with underscores in node names. If you need literal hyphens, set `GRAPH_NODE_ID_USE_LITERAL_VALUE=true`. Changing this on an existing installation requires updating the `subgraph_deployment_assignment` table manually.

### PG connection sprawl

The formula that catches everyone:

```
Total connections = (num graph-nodes) × (pool_size) × (num shards + replicas)
```

Example: 6 index nodes (pool 20) + 2 query nodes (pool 80), across 3 shards each with 2 replicas:

- Index: 6 × 20 × 9 = 1,080 connections
- Query: 2 × 80 × 9 = 1,440 connections
- **Total: 2,520 connections**

PostgreSQL's `max_connections` defaults to 100. The Docker Compose default is 200. You'll blow through this fast.

**Always audit your pools** when changing config:

```bash
graphman --config config.toml config pools $all_node_ids
```

### Shared config vs per-node configs

Two approaches:

**Single shared config** — all nodes read the same `config.toml`. Role differentiation happens via the `[general] query` regex and `[chains] ingestor` directive. Simpler to manage.

**Per-node configs** — each instance gets its own TOML, loaded via `GRAPH_NODE_CONFIG=`. More flexible, but more files to keep in sync.

The pitfall with shared config: if `[deployment]` placement rules aren't precise, a new deployment can land on the wrong node. Simulate first:

```bash
graphman --config config.toml config place some/subgraph mainnet
```

## Useful environment variables

A handful of env vars worth knowing for tuning:

| Variable | Default | Purpose |
|----------|---------|---------|
| `ETHEREUM_REORG_THRESHOLD` | 250 | Max expected reorg depth |
| `GRAPH_ENTITY_CACHE_SIZE` | 10000 (KB) | In-memory entity cache |
| `GRAPH_STORE_WRITE_BATCH_DURATION` | 300s | How long to batch writes during sync |
| `GRAPH_STORE_CONNECTION_TIMEOUT` | 5000ms | DB connection wait timeout |
| `GRAPH_LOAD_THRESHOLD` | 0 (off) | Throttle queries when connection wait exceeds this (ms) |
| `GRAPH_QUERY_CACHE_BLOCKS` | 1 | Recent blocks cached per network |
| `GRAPH_QUERY_CACHE_MAX_MEM` | 1000 (MB) | Query result cache size |

## The Horizon-era indexer stack

Graph Horizon (December 2025) didn't change graph-node, but it significantly changed the services around it:

| Component | What changed |
|-----------|-------------|
| **graph-node** | Unchanged — same architecture, same config |
| **indexer-agent** | Upgraded — now manages provisions and Horizon-style allocations |
| **indexer-service** | Replaced — old TypeScript version replaced by `indexer-service-rs` (Rust) |
| **indexer-tap-agent** | New — handles GraphTally (TAP v2) receipt aggregation and RAV redemption |

**Allocations** are the biggest operational change. Pre-Horizon, allocations were short-lived (closed every ~28 epochs). Post-Horizon, allocations are long-lived — they don't need to be closed to collect rewards. Instead, freshness is enforced by `maxPOIStaleness`: indexers must submit POIs regularly, or stale allocations can be force-closed by anyone.

**Provisions** are also new: indexers must explicitly assign stake to a data service (e.g., SubgraphService) before operating. This replaces the old model where staked GRT was automatically available for everything.

None of this affects how you architect your graph-node stack. The three rules still hold. Your TOML config is the same. `graphman` still manages everything.

## Example topologies

### Small operator (1-3 subgraphs)

Single graph-node instance doing everything — ingestion, indexing, and queries. One Postgres instance. Simple and effective.

```
[graph-node] ←→ [PostgreSQL]
     ↕
[Chain RPC]
```

### Medium operator (10-50 subgraphs)

Dedicated ingestor, separate index and query nodes. Single Postgres with read replica for queries.

```
[ingestor] ←→ [PostgreSQL primary]
[index-0]  ←→ [PostgreSQL primary]
[index-1]  ←→ [PostgreSQL primary]
[query-0]  ←→ [PostgreSQL replica]
[query-1]  ←→ [PostgreSQL replica]
```

### Large operator (100+ subgraphs, multiple chains)

Tiered index nodes, multiple shards, read replicas, proxy layer.

```
[nginx/HAProxy]
    ↓
[query-0..N] ←→ [shard-vip replica] + [shard-general replica]
[ingestor]   ←→ [shard-vip primary] + [shard-general primary]
[fast-0..N]  ←→ [shard-vip primary]
[slow-0..N]  ←→ [shard-general primary]
```

## Further reading

- [graph-node/docs/config.md](https://github.com/graphprotocol/graph-node/blob/master/docs/config.md) — the TOML config reference (start here)
- [graph-node/docs/sharding.md](https://github.com/graphprotocol/graph-node/blob/master/docs/sharding.md) — PostgreSQL sharding architecture
- [graph-node/docs/graphman.md](https://github.com/graphprotocol/graph-node/blob/master/docs/graphman.md) — graphman command reference
- [graph-node/docs/environment-variables.md](https://github.com/graphprotocol/graph-node/blob/master/docs/environment-variables.md) — all environment variables
- [The Graph indexing docs](https://thegraph.com/docs/en/indexing/overview/) — official documentation
- [What changes with Graph Horizon](https://thegraph.com/docs/en/graph-horizon/what-changes/) — Horizon upgrade details
