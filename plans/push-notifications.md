# Push Protocol — Lodestar Delegator Alerts

## Research Summary

**Push Protocol** (push.org) is a decentralised notification layer for web3. Users subscribe via wallet signature (gasless). Channels send targeted or broadcast notifications server-side via a private key — also gasless. Notifications surface in the Push dApp, browser extension, and mobile app.

### Why it fits Lodestar

We already detect every event worth notifying about:
- Cut changes → `parameter_changes` table (Postgres)
- Indexer inactivity → allocation data in main subgraph
- Self-stake drops → stake history (time-travel) or enriched cache

The missing piece is the delivery layer. Push Protocol adds that with minimal backend change.

---

## Key Facts

| Property | Value |
|---|---|
| Channel creation cost | 50 PUSH tokens (~£15–40 one-time) |
| Channel creation chain | Ethereum mainnet (CCR allows initiating from Arbitrum) |
| Sending notifications | **Free and gasless** — EIP-712 signed off-chain |
| Targeted notifications | Yes — `channel.send(['0xAddr1', '0xAddr2'], ...)` |
| Non-subscriber delivery | Delivered to spam box, not inbox |
| Rate limits | None documented |
| SDK | `@pushprotocol/restapi@1.7.32` + `ethers@^5.7` |
| Server auth | Raw private key → `ethers.Wallet` → `PushAPI.initialize()` |
| Arbitrum support | Yes — Push Communicator deployed on chain 42161 |

---

## Notification Triggers

| Event | Data source | Severity |
|---|---|---|
| Indexer reward cut change | `parameter_changes` table (already tracked) | High |
| Indexer query fee cut change | `parameter_changes` table | Medium |
| Indexer has no active allocations | Allocation data, enriched cache | High |
| Self-stake drops >20% | Stake history / enriched cache | Medium |

---

## Targeted Delivery Strategy

Push Protocol lets us query the full subscriber list of our channel. For each trigger event:

1. **Get Lodestar channel subscribers** — `pushUser.notification.subscribers()`
2. **Get delegators of affected indexer** — from main subgraph `indexer.delegators`
3. **Intersect** → only notify wallets that are both delegating to the indexer AND subscribed
4. **Send** → `pushUser.channel.send(intersectedAddresses, { ... })`

This means cold users (not subscribed) get nothing — which is fine. We drive subscriptions via the UI on the indexer profile page.

---

## Server Auth Pattern (Recommended)

Use a **delegate wallet** — a cheap burner EOA that can send on behalf of the channel. The channel owner key never touches the server.

```typescript
// One-time: add delegate (from channel owner wallet, in Push dApp or SDK)
await ownerPushUser.channel.delegate.add(`eip155:1:${DELEGATE_ADDRESS}`);

// Server: initialise with delegate key, send as channel
const signer = new ethers.Wallet(`0x${process.env.PUSH_DELEGATE_PRIVATE_KEY}`);
const pushUser = await PushAPI.initialize(signer, {
  env: CONSTANTS.ENV.PROD,
  account: `eip155:1:${process.env.PUSH_CHANNEL_ADDRESS}`,
});
await pushUser.channel.send(delegatorAddresses, { ... });
```

---

## SDK Installation

```bash
pnpm add @pushprotocol/restapi ethers@^5.7
```

Note: ethers **v5** is the peer dep, not v6. We currently use ethers v6 elsewhere — install as a separate dep or use the raw fetch approach.

---

## Subscription Flow (Frontend)

```typescript
// Subscribe (gasless EIP-712 sig — no transaction)
const pushUser = await PushAPI.initialize(walletSigner, { env: CONSTANTS.ENV.PROD });
await pushUser.notification.subscribe(`eip155:1:${CHANNEL_ADDRESS}`);

// Check subscription status
const subs = await pushUser.notification.subscriptions();
const isSubscribed = subs.some(s => s.channel.toLowerCase() === CHANNEL_ADDRESS.toLowerCase());
```

---

## Open Questions Before Building

1. **Does push.org have a faucet or grant for protocol integrations?** Channel creation is 50 PUSH — worth asking in their Discord before paying.
2. **ethers v5 vs v6** — we use v6 in the main app. Need to either install v5 as a separate dep (`ethers5`) or use the lower-level fetch API for sending.
3. **Subscription storage** — do we query Push nodes every time for the subscriber list, or cache it? Their API is fast enough that querying per-trigger is fine.
4. **UI placement** — subscribe button lives on the indexer profile page. Should it be per-indexer context ("get alerts for this indexer") or global ("get Lodestar alerts")?

---

## References

- [Push Docs — Send Notification](https://comms.push.org/docs/notifications/build/send-notification/)
- [Push Docs — Channel Delegates](https://comms.push.org/docs/notifications/build/channel-delegates/)
- [Push Docs — Manage Subscriptions](https://comms.push.org/docs/notifications/build/manage-subscriptions/)
- [Push Docs — Create Channel](https://comms.push.org/docs/notifications/tutorials/create-your-channel/)
- [push-protocol/push-sdk on GitHub](https://github.com/push-protocol/push-sdk)
