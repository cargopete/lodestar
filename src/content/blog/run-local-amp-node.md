---
title: "How to Run a Local Amp Node for Graph Horizon Data"
date: "2026-04-07"
author: "cargopete"
tags: ["amp", "horizon", "self-hosted", "infrastructure", "arbitrum"]
excerpt: "Edge & Node's Amp is available as a hosted service — but you can run it yourself. Here's how to self-host a local ampd node indexing Graph Horizon staking events, with no waitlists and no dependency on E&N infrastructure."
---

Edge & Node's [Amp](https://github.com/edgeandnode/amp) is positioned as a hosted enterprise service, but the daemon — `ampd` — is available as a standalone binary. You can run it yourself, point it at any RPC endpoint, and index whatever on-chain data you need. No waitlist, no E&N account, no hosted service dependency.

This is how we set up a local Amp node indexing **Graph Horizon staking events** on Arbitrum One for Lodestar.

## Why self-host?

The Graph Network Subgraph gives you current protocol state — indexer stakes, delegation positions, provisions. It's excellent for what it does. But it doesn't give you event history: when a delegator moved their stake, the full timeline of provision changes, the exact block a slashing occurred.

Ampd indexes raw on-chain events and exposes them via SQL. That's a different layer. Used together with the subgraph, you can build things that weren't previously possible from a frontend:

- **Delegation timelines** — every `TokensDelegated` and `TokensUndelegated` event for an address, with exact blocks and amounts
- **Provision history** — full chronological log of `ProvisionCreated`, `ProvisionSlashed`, parameter changes
- **Slashing audit trail** — every `ProvisionSlashed` and `DelegationSlashed` ever, queryable by address
- **Stake flow charts** — net delegation in/out per indexer per week, derived from raw events

None of this requires E&N's hosted service. You just need a machine, a Postgres instance, and an RPC endpoint.

## What you need

- Linux machine with 16GB+ RAM and fast NVMe storage (a ThinkPad works fine)
- Postgres
- An Arbitrum One RPC endpoint (Chainstack, Alchemy, Infura — anything works)
- ~50GB free disk for 3 months of history, ~400GB+ for full Horizon history

> **On disk space:** The HorizonStaking contract was deployed in June 2024 (block 209819702). Full history to present is ~240M blocks and requires hundreds of GB. Starting from January 2026 (block 416000000) gives you ~3 months of history — enough for all active positions and events — in around 50GB.

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
    --start-block 416000000 \
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
    "sql": "SELECT block_number, tx_hash, topic1, topic2, data FROM \"_/arbitrum_one@1.0.0\".logs WHERE address = '\''0x00669a4cf01450b64e8a2a20e9b1fcb71e61ef03'\'' AND topic0 = '\''0x804c9b842b2748a22bb64b345453a3de7ca54a6ca45ce00d415894979e22897a'\'' ORDER BY block_number DESC LIMIT 10"
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

**The sync speed ceiling is your RPC.** On a Chainstack Growth plan (250 req/s), expect roughly ~100–120 blocks per 15 seconds. At that rate, 33M blocks (Jan 2026 to present) takes ~2–3 days. There's no way to go faster without a local Arbitrum node.

## Integrating with a Next.js app

In `src/lib/amp.ts`:

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

Set `AMP_ENDPOINT` and `AMP_TOKEN` in your Vercel environment, and your API routes have direct access to the full event history.

## The full setup

The complete setup scripts, provider configs, systemd service, and nginx config are in the [amping repo](https://github.com/cargopete/amping). It covers Manjaro/Arch and Ubuntu, and includes scripts for full history reindex vs. narrowed start blocks.
