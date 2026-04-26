---
title: "How to Run a Local Amp Node"
date: "2026-04-07"
author: "cargopete"
tags: ["amp", "self-hosted", "infrastructure", "arbitrum"]
category: "Guides"
excerpt: "Edge & Node's Amp is available as a hosted service — but you can run it yourself. Here's how to self-host a local ampd node, with no waitlists and no dependency on E&N infrastructure."
---

*This post is unaffiliated with Edge & Node or The Graph Foundation — just a hobby project documenting what worked.*

Edge & Node's [Amp](https://thegraph.com/amp/) is positioned as a hosted enterprise service, but the daemon — `ampd` — is available as a standalone binary. You can run it yourself, point it at any RPC endpoint, and index whatever on-chain data you need. No waitlist, no E&N account, no hosted service dependency.

## Why self-host?

Ampd indexes raw on-chain events and exposes them via SQL. Subgraphs give you current protocol state — but they don't give you event history. Ampd is a different layer: every raw log, queryable by contract address, topic, and block range.

None of this requires E&N's hosted service. You just need a machine, a Postgres instance, and an RPC endpoint.

## What you need

- Linux machine with 16GB+ RAM and fast NVMe storage (a ThinkPad works fine)
- Postgres
- An Arbitrum One RPC endpoint (Chainstack, Alchemy, Infura — anything works)
- ~50GB free disk for a few months of history, ~400GB+ for full chain history

> **On disk space:** Full history from genesis requires hundreds of GB. Picking a sensible start block (e.g. a contract deployment block, or 3–6 months ago) is the practical move — 50–100GB covers most use cases.

## Install ampd

```bash
curl --proto '=https' --tlsv1.2 -sSf https://ampup.sh/install | sh
```

This installs `ampd`, `ampctl`, and `ampup` to `~/.amp/bin/`. Symlink them:

```bash
sudo ln -sf ~/.amp/bin/ampd   /usr/local/bin/ampd
sudo ln -sf ~/.amp/bin/ampctl /usr/local/bin/ampctl
```

## Configure

Create the directory structure and config file:

```bash
sudo mkdir -p /var/lib/ampd/{data,providers,manifests} /etc/ampd
```

Write `/etc/ampd/ampd.toml`:

```toml
data_dir      = "/var/lib/ampd/data"
providers_dir = "/var/lib/ampd/providers"
manifests_dir = "/var/lib/ampd/manifests"

flight_addr        = "127.0.0.1:16021"
jsonl_addr         = "127.0.0.1:1603"
poll_interval_secs = 3.0

[metadata_db]
url = "postgres://ampd:YOUR_PASSWORD@localhost/ampd"

[writer]
compression = "zstd(1)"
```

Write the provider config at `/var/lib/ampd/providers/arbitrum_one_rpc.toml`:

```toml
kind    = "evm-rpc"
network = "arbitrum-one"
url     = "https://YOUR_RPC_ENDPOINT"
```

## Run as a systemd service

```ini
[Unit]
Description=Amp blockchain database daemon
After=network.target postgresql.service

[Service]
User=ampd
Group=ampd
Environment=AMP_CONFIG=/etc/ampd/ampd.toml
ExecStart=/usr/local/bin/ampd solo --flight-server --jsonl-server --admin-server
Restart=on-failure
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

Note the `solo` subcommand — this runs the server, worker, and controller in one process. The `AMP_CONFIG` environment variable is how ampd reads its config (not `--config`).

## Expose via nginx

Ampd's JSON Lines server listens on `127.0.0.1:1603`. Put nginx in front of it on a public port with secret-header auth:

```nginx
map_hash_bucket_size 128;

map $http_x_amp_token $amp_authorized {
    "YOUR_SECRET_TOKEN" 1;
    default             0;
}

server {
    listen      1604;
    server_name _;

    if ($amp_authorized = 0) { return 403; }

    location / {
        proxy_pass http://127.0.0.1:1603;
        proxy_read_timeout 300s;
        proxy_buffering    off;
    }
}
```

Requests without the `X-Amp-Token` header get a 403 before ampd sees them.

## Start indexing

Generate a manifest and register the dataset:

```bash
ampctl manifest generate \
    --network     arbitrum-one \
    --kind        evm-rpc \
    --start-block YOUR_START_BLOCK \
    -o /var/lib/ampd/manifests/arbitrum_one_raw.json

ampctl dataset register _/arbitrum_one /var/lib/ampd/manifests/arbitrum_one_raw.json --tag 1.0.0
ampctl dataset deploy _/arbitrum_one@1.0.0
```

Check progress:

```bash
journalctl -u ampd --no-pager | grep "overall progress" | tail -1
```

## Query it

Once synced, query via HTTP from anywhere:

```bash
curl -s http://YOUR_HOST:1604/query \
  -H "Content-Type: application/json" \
  -H "X-Amp-Token: YOUR_SECRET_TOKEN" \
  -d '{
    "sql": "SELECT block_number, tx_hash, address, topic0, topic1, data FROM \"_/arbitrum_one@1.0.0\".logs WHERE address = '\''0xYOUR_CONTRACT_ADDRESS'\'' ORDER BY block_number DESC LIMIT 10"
  }'
```

The response is newline-delimited JSON — one row per line.

The `logs` table schema:

| Column | Description |
|--------|-------------|
| `block_number` | Block number |
| `tx_hash` | Transaction hash |
| `address` | Contract address (lowercase) |
| `topic0` | Event signature hash |
| `topic1`–`topic3` | Indexed event parameters (zero-padded to 32 bytes) |
| `data` | Non-indexed event data |

## Gotchas

**Tags must be semver.** `ampctl dataset register ... --tag latest` is rejected. Use `1.0.0`.

**`ampd` uses `AMP_CONFIG`, not `--config`.** The flag doesn't exist on the `solo` subcommand.

**Jobs persist in Postgres.** If you wipe the data directory and restart, old jobs will still be in the `jobs` table and will restart from their last checkpoint. Run `DELETE FROM jobs;` in the `ampd` database before a fresh reindex.

**Multiple RPC providers don't parallelize.** Adding two `arbitrum-one` provider files doesn't double throughput — ampd appears to use a single provider at a time. The bottleneck is sequential HTTP requests to the RPC endpoint, not local compute.

**The sync speed ceiling is your RPC.** On a Chainstack Growth plan (250 req/s), expect roughly ~100–120 blocks per 15 seconds. There's no way to go faster without a local node.

## So you have an amp node — what do you do with it?

Raw on-chain logs are only useful if you have a question the subgraph can't answer. Here are some things we use ours for.

### Graph Horizon event history

The Graph Network Subgraph gives you current protocol state — indexer stakes, delegation positions, provisions. It doesn't give you event history. With Amp:

- **Delegation timelines** — every `TokensDelegated` and `TokensUndelegated` event for an address, with exact blocks and amounts
- **Provision history** — full chronological log of `ProvisionCreated`, `ProvisionSlashed`, parameter changes
- **Slashing audit trail** — every `ProvisionSlashed` and `DelegationSlashed` ever, queryable by address
- **Stake flow charts** — net delegation in/out per indexer per week

### Integrating with a Next.js app

```typescript
import { keccak256, toHex } from 'viem';

const AMP_ENDPOINT = process.env.AMP_ENDPOINT;
const AMP_TOKEN    = process.env.AMP_TOKEN;

export async function ampQuery<T>(sql: string): Promise<T[]> {
  const res = await fetch(`${AMP_ENDPOINT}/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Amp-Token': AMP_TOKEN!,
    },
    body: JSON.stringify({ sql }),
  });
  const text = await res.text();
  return text.trim().split('\n').filter(Boolean).map(l => JSON.parse(l) as T);
}

function sig(s: string) { return keccak256(toHex(s)); }

export const TOPIC0 = {
  TokensDelegated:          sig('TokensDelegated(address,address,address,uint256,uint256)'),
  TokensUndelegated:        sig('TokensUndelegated(address,address,address,uint256,uint256)'),
  DelegatedTokensWithdrawn: sig('DelegatedTokensWithdrawn(address,address,address,uint256)'),
  ProvisionCreated:         sig('ProvisionCreated(address,address,uint256,uint32,uint64)'),
  ProvisionSlashed:         sig('ProvisionSlashed(address,address,uint256)'),
  DelegationSlashed:        sig('DelegationSlashed(address,address,uint256)'),
} as const;
```

Set `AMP_ENDPOINT` and `AMP_TOKEN` in your environment variables, and your API routes have direct access to the full event history.
