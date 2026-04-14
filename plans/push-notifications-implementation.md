# Push Protocol — Implementation Plan

## Overview

Add opt-in delegator alerts via Push Protocol. Delegators subscribe once (gasless wallet sig), then receive targeted notifications when their indexers change cuts or go inactive.

**Scope:** Notification sending only — no custom Push UI library, no on-chain triggers, no smart contract changes.

---

## Phase 1 — One-Time Setup (manual, ~1h)

### 1.1 Create the Lodestar channel

- Go to [app.push.org](https://app.push.org) → Create Channel
- Wallet: dedicated Lodestar channel owner EOA (not a personal wallet)
- Fill in: name ("Lodestar Indexer Alerts"), description, logo, URL
- Deposit 50 PUSH tokens (get from Uniswap/exchange)
- Save channel address → `PUSH_CHANNEL_ADDRESS` env var

### 1.2 Create a delegate wallet

- Generate a fresh EOA (e.g. `cast wallet new` with Foundry)
- Add it as a delegate via Push dApp → Channel Settings → Delegates
- Save private key → `PUSH_DELEGATE_PRIVATE_KEY` env var
- This wallet never needs ETH (sending is gasless)

### 1.3 Add env vars to Vercel

```
PUSH_CHANNEL_ADDRESS=0x...
PUSH_DELEGATE_PRIVATE_KEY=0x...
```

---

## Phase 2 — Backend Notification Service (~1 day)

### 2.1 Install SDK

```bash
pnpm add @pushprotocol/restapi
pnpm add ethers@5 --save-exact  # alias as ethers5 to avoid conflict with app ethers v6
```

In `package.json` add alias:
```json
"dependencies": {
  "ethers5": "npm:ethers@^5.7.2"
}
```

### 2.2 Create `src/lib/push.ts`

```typescript
import { PushAPI, CONSTANTS } from '@pushprotocol/restapi';
import { Wallet } from 'ethers5';

let _pushUser: Awaited<ReturnType<typeof PushAPI.initialize>> | null = null;

async function getPushUser() {
  if (_pushUser) return _pushUser;
  const signer = new Wallet(process.env.PUSH_DELEGATE_PRIVATE_KEY!);
  _pushUser = await PushAPI.initialize(signer, {
    env: CONSTANTS.ENV.PROD,
    account: `eip155:1:${process.env.PUSH_CHANNEL_ADDRESS}`,
  });
  return _pushUser;
}

export async function getChannelSubscribers(): Promise<string[]> {
  const push = await getPushUser();
  const subs = await push.channel.subscribers({ page: 1, limit: 10000 });
  return (subs.subscribers ?? []).map((s: { subscriber: string }) =>
    s.subscriber.toLowerCase()
  );
}

export async function sendDelegatorAlert({
  indexerAddress,
  indexerName,
  delegatorAddresses,
  eventType,
  detail,
}: {
  indexerAddress: string;
  indexerName: string;
  delegatorAddresses: string[];
  eventType: 'cut_change' | 'inactive' | 'stake_drop';
  detail: string;
}) {
  if (delegatorAddresses.length === 0) return;
  const push = await getPushUser();

  const titles: Record<string, string> = {
    cut_change: `Cut change — ${indexerName}`,
    inactive:   `Indexer inactive — ${indexerName}`,
    stake_drop: `Stake drop — ${indexerName}`,
  };

  await push.channel.send(delegatorAddresses, {
    notification: {
      title: titles[eventType],
      body: detail,
    },
    payload: {
      title: titles[eventType],
      body: detail,
      cta: `https://www.lodestar-dashboard.com/indexers/${indexerAddress}`,
    },
  });
}
```

### 2.3 Create `src/lib/push-notify.ts` — notification logic

```typescript
import { db } from '@/lib/db';
import { subgraphQuery } from '@/lib/subgraph';
import { getChannelSubscribers, sendDelegatorAlert } from '@/lib/push';
import { resolveIndexerName } from '@/lib/utils';

/**
 * Fetch delegators of an indexer from the main subgraph
 */
async function getIndexerDelegators(indexerAddress: string): Promise<string[]> {
  const result = await subgraphQuery<{
    indexer: { delegators: { delegator: { id: string } }[] } | null;
  }>(`{
    indexer(id: "${indexerAddress}") {
      delegators(first: 1000) {
        delegator { id }
      }
    }
  }`);
  return (result.indexer?.delegators ?? []).map(d => d.delegator.id.toLowerCase());
}

/**
 * For a given indexer event, intersect its delegators with Push subscribers
 * and send targeted notifications.
 */
export async function notifyIndexerDelegators(params: {
  indexerAddress: string;
  indexerName: string;
  eventType: 'cut_change' | 'inactive' | 'stake_drop';
  detail: string;
}) {
  const [subscribers, delegators] = await Promise.all([
    getChannelSubscribers(),
    getIndexerDelegators(params.indexerAddress),
  ]);

  const subscriberSet = new Set(subscribers);
  const targets = delegators.filter(d => subscriberSet.has(d));

  if (targets.length === 0) return;

  await sendDelegatorAlert({
    ...params,
    delegatorAddresses: targets,
  });
}
```

### 2.4 Hook into existing cron — `src/app/api/cron/ingest-epochs/route.ts`

The `ingest-epochs` cron already processes new parameter changes. Add notification dispatch:

```typescript
import { notifyIndexerDelegators } from '@/lib/push-notify';

// After inserting new parameter changes into DB:
for (const change of newChanges) {
  const pct = (change.new_value / 1_000_000 * 100).toFixed(1);
  const prev = (change.old_value / 1_000_000 * 100).toFixed(1);
  const label = change.param_name === 'reward_cut'
    ? 'Indexing Reward Cut'
    : 'Query Fee Cut';

  await notifyIndexerDelegators({
    indexerAddress: change.indexer_address,
    indexerName: change.indexer_address.slice(0, 8) + '...',
    eventType: 'cut_change',
    detail: `${label} changed from ${prev}% → ${pct}%`,
  });
}
```

---

## Phase 3 — Subscribe UI (~half day)

### 3.1 Create `src/components/ui/PushSubscribeButton.tsx`

A client component that:
- Checks if the connected wallet is already subscribed
- Shows "Subscribe to alerts" / "Subscribed ✓" toggle
- Handles the gasless subscribe/unsubscribe flow

```typescript
'use client';

import { useState, useEffect } from 'react';
import { PushAPI, CONSTANTS } from '@pushprotocol/restapi';

const CHANNEL_ADDRESS = process.env.NEXT_PUBLIC_PUSH_CHANNEL_ADDRESS!;

export function PushSubscribeButton({ walletSigner }: { walletSigner: any }) {
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!walletSigner) return;
    (async () => {
      const push = await PushAPI.initialize(walletSigner, { env: CONSTANTS.ENV.PROD });
      const subs = await push.notification.subscriptions();
      setSubscribed(subs.some((s: any) =>
        s.channel.toLowerCase() === CHANNEL_ADDRESS.toLowerCase()
      ));
    })();
  }, [walletSigner]);

  async function toggle() {
    if (!walletSigner || subscribed === null) return;
    setLoading(true);
    const push = await PushAPI.initialize(walletSigner, { env: CONSTANTS.ENV.PROD });
    if (subscribed) {
      await push.notification.unsubscribe(`eip155:1:${CHANNEL_ADDRESS}`);
      setSubscribed(false);
    } else {
      await push.notification.subscribe(`eip155:1:${CHANNEL_ADDRESS}`);
      setSubscribed(true);
    }
    setLoading(false);
  }

  if (!walletSigner || subscribed === null) return null;

  return (
    <button
      onClick={toggle}
      disabled={loading}
      className={`px-3 py-1.5 text-xs rounded-[var(--radius-button)] border transition-colors ${
        subscribed
          ? 'border-[var(--green)] text-[var(--green)] hover:bg-[var(--green)]/10'
          : 'border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10'
      }`}
    >
      {loading ? '...' : subscribed ? '🔔 Alerts on' : '🔔 Get alerts'}
    </button>
  );
}
```

Add `NEXT_PUBLIC_PUSH_CHANNEL_ADDRESS` to env vars.

### 3.2 Place on indexer profile page

Add `<PushSubscribeButton>` to the header area of the indexer profile, next to the address/ENS. Only renders if wallet is connected.

---

## Phase 4 — Inactive Indexer Alerts (~half day)

Add a check to the `snapshot-network` or `refresh` cron: if an indexer has `allocationCount === 0` and was previously active (had allocations last snapshot), fire an `inactive` notification.

This requires a small state-tracking addition — store `last_allocation_count` per indexer in the enriched cache or a new Postgres column.

---

## Environment Variables Summary

| Var | Where | Notes |
|---|---|---|
| `PUSH_CHANNEL_ADDRESS` | Vercel (server) | Channel owner EOA address |
| `PUSH_DELEGATE_PRIVATE_KEY` | Vercel (server, secret) | Burner wallet private key |
| `NEXT_PUBLIC_PUSH_CHANNEL_ADDRESS` | Vercel (public) | Same address, exposed to frontend |

---

## Effort Estimate

| Phase | Effort | Blocker |
|---|---|---|
| 1 — Channel + wallet setup | ~1h | Need 50 PUSH tokens |
| 2 — Backend service + cron hook | ~1 day | Phase 1 done |
| 3 — Subscribe UI | ~half day | Phase 1 done |
| 4 — Inactive alerts | ~half day | Phase 2 done |

**Total: ~2.5 days** for full implementation.

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| ethers v5/v6 conflict | Alias `ethers5` in package.json |
| Low subscription rate → few notifications land in inbox | Prominent subscribe button + tooltip explaining the value |
| Push API changes | Pinned SDK version, low-effort to update |
| Delegate key compromised | Key can only send notifications, cannot drain funds or transfer channel |
