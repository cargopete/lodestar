---
title: "How to Claim a Sync Bounty as an Indexer"
date: "2026-05-11"
author: "cargopete"
tags: ["bounty", "indexing", "horizon", "guide", "subgraphs"]
category: "Guides"
excerpt: "Developers can now post on-chain GRT bounties for subgraph deployments they need indexed. Here's the complete walkthrough for indexers — from spotting a bounty to collecting the GRT."
---

Sync bounties are a new primitive on the Lodestar Bounty Board. A developer locks GRT on-chain against a specific subgraph deployment ID. Any indexer who syncs that deployment and can prove it — by presenting a valid POI — can claim the GRT. Trustless, no intermediary, first valid claim wins.

This post walks through the full process from an indexer's perspective.

## What the contract actually checks

Before doing anything, understand the two on-chain conditions `BountyBoard.claim()` verifies:

1. **Your allocation is open**: `SubgraphService.getAllocation(allocationId).closedAt == 0`
2. **You presented a POI after the bounty was posted**: `lastPOIPresentedAt > bounty.postedAt`

Both must be true at the moment you call `claim()`. That's it. The contract reads from `SubgraphService` directly — no oracle, no trust.

The implication: you need an *active* (not closed) allocation, and you need to have called `collect()` on SubgraphService at least once after the bounty was created. The indexer-agent's `presentPOI` action does this without closing your allocation.

---

## Step 1 — Find a bounty

Go to [lodestar-dashboard.com/dock](https://www.lodestar-dashboard.com/dock) and open the **Bounty Board** tab. Each bounty shows:

- The deployment ID (IPFS hash) — this is what you'll index
- The GRT reward
- The developer's message (usually explains what they need and why)
- Expiry date — you must claim before this

Copy the deployment ID. You'll need it for every step below.

---

## Step 2 — Deploy the subgraph to your graph-node

The deployment may or may not be published on the Graph Network. Either way, you deploy it the same way — via the graph-node admin API (JSON-RPC on port 8020).

**Create a namespace and deploy:**

```bash
# Replace Qm... with the actual deployment ID from the bounty
DEPLOYMENT_ID="QmYourDeploymentIdHere"

# Create a name slot
curl -s -X POST http://your-graph-node:8020/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"subgraph_create","params":{"name":"bounty/'$DEPLOYMENT_ID'"},"id":1}'

# Deploy it
curl -s -X POST http://your-graph-node:8020/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"subgraph_deploy","params":{"name":"bounty/'$DEPLOYMENT_ID'","ipfs_hash":"'$DEPLOYMENT_ID'","node_id":"index_node_0"},"id":2}'
```

Your graph-node will pull the manifest from IPFS and start syncing. Check progress via the status API:

```bash
curl -s -X POST http://your-graph-node:8030/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ indexingStatuses(subgraphs: [\"'$DEPLOYMENT_ID'\"]) { synced health chains { latestBlock { number } } } }"}'
```

Wait for `synced: true` before proceeding.

> **StakeSquid / standard compose setups:** graph-node ports (8020, 8030) are typically `expose`-only and not mapped to the host. Run the commands above from inside the server with `docker exec` instead:
> ```bash
> # Admin API (subgraph_create / subgraph_deploy)
> docker exec index-node-0 curl -s -X POST http://localhost:8020/ \
>   -H "Content-Type: application/json" \
>   -d '...'
>
> # Status API (sync check) — route via indexer-agent since index-node-0 has no curl
> docker exec indexer-agent curl -s -X POST http://query-node-0:8030/graphql \
>   -H "Content-Type: application/json" \
>   -d '...'
> ``` Depending on the subgraph and chain, this can take anywhere from minutes to days.

---

## Step 3 — Allocate to the deployment

You need an active allocation against this deployment ID. The indexer-agent handles this — either via an indexing rule or a direct action.

**Via indexing rule (recommended — agent manages it automatically):**

```graphql
mutation {
  setIndexingRule(rule: {
    identifier: "QmYourDeploymentIdHere"
    identifierType: deployment
    decisionBasis: always
    allocationAmount: "10000000000000000000000"  # 10,000 GRT in wei
    protocolNetwork: "eip155:42161"
  }) { identifier decisionBasis allocationAmount }
}
```

**Or queue a direct allocate action:**

```graphql
mutation {
  queueActions(actions: [{
    type: allocate
    deploymentID: "QmYourDeploymentIdHere"
    amount: "10000"
    protocolNetwork: "eip155:42161"
    status: approved
    priority: 0
    isLegacy: false
    source: "manual"
    reason: "bounty"
  }]) { id type status failureReason }
}
```

Post both mutations to your indexer-agent management API at `http://localhost:8000/`. The agent will execute the allocation on its next reconcile loop, typically within a minute.

> **StakeSquid / compose users:** Port 8000 isn't mapped to the host by default. Prefix your curl with `docker exec indexer-agent` and keep `http://localhost:8000/` as-is — the container resolves it correctly.

**Finding your allocation ID after it's created:**

Once the agent allocates, you'll need the allocation ID (an Ethereum address) to claim. Query the agent:

```graphql
{ allocations(filter: {}) { id subgraphDeployment } }
```

Or check Arbiscan — look for a `ServiceStarted` or `AllocationCreated` event on the [SubgraphService contract](https://arbiscan.io/address/0xb2Bb92d0DE618878E438b55D5846cfecD9301105#events) from your indexer address.

---

## Step 4 — Wait for the subgraph to sync

The allocation and the sync can happen in parallel. You just need both to be true before presenting a POI:

- `synced: true` from the graph-node status API
- Allocation exists on-chain

If the subgraph has a graft base, you'll need to deploy the base deployment first and wait for it to sync before the target deployment can graft onto it. The bounty page on Lodestar should indicate if this is the case (you can also check the manifest via `https://api.thegraph.com/ipfs/api/v0/cat?arg=QmYour...`).

---

## Step 5 — Present a POI (the critical step)

This is the step most indexers miss. The bounty contract checks `lastPOIPresentedAt > bounty.postedAt`. This timestamp is only set when you call `SubgraphService.collect()` — which the indexer-agent does via the `presentPOI` action. It collects indexing rewards without closing your allocation.

Run this against your management API (`http://localhost:8000/`) — same docker exec note as Step 3 applies if your ports aren't host-mapped:

```graphql
mutation {
  queueActions(actions: [{
    type: presentPOI
    deploymentID: "QmYourDeploymentIdHere"
    allocationID: "0xYourAllocationIdHere"
    protocolNetwork: "eip155:42161"
    status: approved
    priority: 0
    isLegacy: false
    source: "manual"
    reason: "bounty claim"
  }]) { id type status failureReason }
}
```

The agent will call `SubgraphService.collect()` on your behalf. Once confirmed on-chain, `lastPOIPresentedAt` will be set to the current block timestamp.

**Timing note:** The Lodestar claim modal polls the chain every 10 seconds and shows you live status. You can open it immediately after queuing the action and watch for the confirmation.

---

## Step 6 — Claim on Lodestar

1. Go to the [Bounty Board](https://www.lodestar-dashboard.com/dock) (Bounty Board tab)
2. Find the bounty and click **Claim**
3. Enter your allocation ID (the `0x...` address from Step 3)
4. The status panel will show:
   - **Allocation: Open**: your allocation is still active
   - **POI verified on-chain: Yes**: your `presentPOI` was confirmed
5. Once both are green, click **Claim GRT** and sign the transaction with your indexer wallet

The contract pays out immediately on confirmation. No waiting, no admin approval.

---

## Common issues

**"Allocation: Closed"**: Your allocation was closed before you claimed. You need an *open* allocation at claim time. Don't close it before claiming.

**"POI verified on-chain: Not yet"**: Either the `presentPOI` transaction hasn't confirmed yet (wait a minute and the panel will update), or you haven't submitted a POI at all. Run the mutation in Step 5.

**Transaction reverts**: The most likely cause is someone else claimed first (first valid claim wins). Check Arbiscan for a `BountyClaimed` event on the BountyBoard contract.

**`presentPOI` action fails with "Invalid action input"**: This can happen on certain agent builds where the action validation doesn't recognise the `presentPOI` type. Patch it by editing `/opt/indexer/packages/indexer-common/dist/actions.js` inside your agent container — add `case ActionType.PRESENT_POI: hasActionParams = 'deploymentID' in variableToCheck && 'allocationID' in variableToCheck; break;` before the `RESIZE` case, then restart the agent. Note: most v0.25.6 builds handle `presentPOI` correctly without this patch — only apply it if you actually see the error.

**Can't find allocation ID**: Query `{ allocations(filter: {}) { id subgraphDeployment } }` against your management API, or search for your indexer address in the SubgraphService events on Arbiscan.

---

## Notes on unpublished subgraphs

Bounties can be posted for deployments that are not (yet) published on the Graph Network. The deployment ID is all you need — the manifest lives on IPFS regardless of whether the subgraph is in GNS. This is by design: developers can spin up a private subgraph, post a bounty to get it indexed before launch, and publish later.

The BountyBoard contract doesn't check GNS — it only talks to SubgraphService.

---

If you hit any issues, the Lodestar claim modal shows the GraphQL mutation pre-filled with your deployment ID. Feel free to [open an issue on GitHub](https://github.com/nightswatchhq/lodestar/issues) or reach out to **@cargopete** (Petko) directly on Discord.
