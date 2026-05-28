# Lodestar vs. Graph Explorer & Studio — Gap Analysis

> Last updated: 2026-05-28  
> Goal: reach feature parity with official Graph products.  
> Status legend: ✅ Live | 🟡 Partial | ❌ Missing | 🔒 Out of scope  
> All items verified by reading actual source code — not inferred.

---

## Lodestar's Moat (features the official products don't have)

These are Lodestar's differentiators — don't lose them chasing parity.

- 11-dimensional indexer risk scoring (A–F grade) with per-dimension breakdown and weights
- REO eligibility with oracle-sourced renewal countdown and heuristic fallback
- Rolling 30d/90d APY (Explorer only shows instantaneous APR)
- Live node syncing status per deployment (blocks behind, sync %, fatal errors, 30s refresh)
- POI consensus dashboard with divergence detection
- IPFS manifest complexity analyser (Light → Extreme), handler breakdown, chain-aware scoring
- Greedy indexer detection with hard-cap risk score penalty
- Delegation advisor with preference sliders (returns / stability / safety / network contribution)
- Redelegation calculator with break-even analysis
- Indexer comparison tool (up to 8 side-by-side)
- GraphTally/TAP payment pipeline tracking
- DeFi protocol directory with family aggregation
- Governance tracker (GIP-0079/0086/0087/0088/0070) with live metrics
- Community voting (EIP-712 + SIWE)
- Parameter change history timeline
- QoS oracle charts per indexer
- Lodie AI Q&A over live network data
- Horizon multi-data-service provisions tracking
- iCal thaw reminder downloads

---

## Gap Table by Feature Area

### 1. Subgraph Discovery & Filtering

| Feature | Explorer | Lodestar | Verified Status |
|---|---|---|---|
| Search by **contract address** (find subgraphs indexing it) | ✅ | ❌ | Missing — search only accepts name or Qm hash (`subgraph-search/route.ts`) |
| Category filter: DeFi / NFTs / DAOs | ✅ | ❌ | Missing — has network, complexity, elite filters only (`subgraphs/page.tsx`) |
| Sort: Most Queried | ✅ | ❌ | Missing — sort keys are `signal \| stake \| queryFees` only |
| Sort: Recently Created / Recently Updated | ✅ | ❌ | Missing — same sort key enum |
| Per-subgraph **query count** (not just fees) | ✅ | ❌ | Missing — only fees, signal, stake shown |
| Filter by indexed chain | ✅ | ✅ | Live |
| Sort by signal / stake / fees | ✅ | ✅ | Live |
| Complexity filter (Light/Moderate/Heavy/Extreme) | ❌ | ✅ | Lodestar leads |
| Elite filter (>1K GRT fees) | ❌ | ✅ | Lodestar leads |

---

### 2. Subgraph Detail Page

| Feature | Explorer | Lodestar | Verified Status |
|---|---|---|---|
| **Built-in GraphQL playground** | ✅ Full GraphiQL (schema browser, autocomplete, syntax highlight) | 🟡 | Partial — custom textarea + run button + response panel, proxied server-side via `GRAPH_API_KEY`. Functional but no schema browser, autocomplete, or syntax highlighting |
| **Subgraph version history** (semver labels, all deployment IDs, timestamps) | ✅ | ❌ | Missing — "History" tab is a signal/stake/fees chart, not a deployment version list |
| **Activity log** (deployments, signals, queries over time) | ✅ | ❌ | Missing — no activity tab exists |
| **Network gateway query URL** displayed + copyable | ✅ | ❌ | Missing — playground shows lodestar's own proxy path `/api/subgraph-playground/[hash]`, not the actual `gateway.thegraph.com` endpoint |
| Per-subgraph indexer status table (stake, fees, sync status) | ✅ | ✅ | Live — IndexerStatus section shows all allocating indexers |
| Signal / Unsignal on-chain from subgraph page | ✅ | ✅ | Live (via /curate) |
| Schema browser | ✅ | ✅ | Live |
| Curator breakdown | ✅ | ✅ | Live |
| Signal/stake/fees history chart | ✅ | ✅ | Live |
| Manifest & complexity analysis | ❌ | ✅ | Lodestar leads |

---

### 3. Indexer Table & Directory

| Feature | Explorer | Lodestar | Verified Status |
|---|---|---|---|
| **Cooldown remaining** column (time until delegation params can change) | ✅ | ❌ | Missing as a table column — data (`delegatorParameterCooldown`) is in row shape and used in comparison/calculator/detail page but not rendered as a directory column (`IndexerTable.tsx` columns: Score, Name, Self Stake, Delegated, Capacity, Reward Cut, APR, APY 90d, Fees, Allocations) |
| Query Fee Cut % | ✅ | ✅ | Live |
| Effective Reward Cut | ✅ | ✅ | Live |
| Owned / Delegated / Allocated stake columns | ✅ | ✅ | Live |
| Available delegation capacity | ✅ | ✅ | Live |
| Lifetime query fees | ✅ | ✅ | Live |
| Search by address / name | ✅ | ✅ | Live |
| Risk score (A–F) | ❌ | ✅ | Lodestar leads |
| REO badge | ❌ | ✅ | Lodestar leads |
| Rolling 30/90d APY columns | ❌ | ✅ | Lodestar leads |

---

### 4. Indexer Detail Page

| Feature | Explorer | Lodestar | Verified Status |
|---|---|---|---|
| **Disputes / slashing history tab** | ✅ | ❌ | Missing — no disputes tab or section found in `indexers/[address]/page.tsx` |
| **Operator address** display | ✅ | ❌ | Missing — not referenced anywhere in indexer pages |
| **Historical / closed allocations** | ✅ | ❌ | Missing — only active allocations are fetched and displayed; no closed allocation table |
| **Cooldown remaining** on detail page | ✅ | ✅ | Live — shown inline in the parameters card as "Locked for Xd" when cooldown active |
| Live node syncing status per deployment | ❌ | ✅ | Lodestar leads |
| REO eligibility + renewal countdown | ❌ | ✅ | Lodestar leads |
| QoS oracle chart | ❌ | ✅ | Lodestar leads |
| Parameter change history timeline | ❌ | ✅ | Lodestar leads |
| 11-dimensional risk score breakdown | ❌ | ✅ | Lodestar leads |

---

### 5. Network & Epochs

| Feature | Explorer | Lodestar | Verified Status |
|---|---|---|---|
| **Epoch status per row**: Active / Settling / Distributing / Finalized | ✅ | ❌ | Missing — `Epoch` type in `queries.ts` has no status field; API only fetches block numbers, fee totals, reward totals |
| Per-epoch query fees + indexing rewards **table** | ✅ | ❌ | Missing — epoch data exists in API but is used for charts/progress bar, no sortable epoch table |
| Genesis-to-now cumulative token supply (minted / burned) | ✅ | 🟡 | Partial — charts exist; no clean headline stat |
| Annual issuance rate displayed (2.75%) | ✅ | ❌ | Missing — minor |
| Current epoch number + progress | ✅ | ✅ | Live |
| Protocol parameters grid | ✅ | ✅ | Live |
| Participant counts (indexers / delegators / curators) | ✅ | ✅ | Live |

---

### 6. User Profile / Delegator Portfolio

| Feature | Explorer | Lodestar | Verified Status |
|---|---|---|---|
| **Delegation status column**: Delegating / Undelegating / Withdrawable | ✅ | 🟡 | Partial — Status column exists showing "Active" / "Thawing" / "Closed" badges, but "Thawing" covers both still-thawing and ready-to-withdraw states. `UndelegatePanel` does detect `thawing.isComplete` and shows a green "Ready to withdraw" button — it just isn't reflected back in the table badge |
| **Withdraw thawed GRT** action | ✅ | ✅ | Live — full withdraw flow in `UndelegatePanel.tsx` with mode tabs, transaction status, and calendar reminder |
| **Undelegate** action (with 25%/50%/ALL quick inputs) | ✅ | ✅ | Live |
| **Indexer's own tabbed profile** (allocations / delegations / curations / settings) | ✅ | 🟡 | Partial — indexer detail page covers most data but not as a unified tabbed profile |
| **Operator address configuration** (for indexers) | ✅ | ❌ | Missing |
| **ENS name configuration** | ✅ | ❌ | Missing |
| Published subgraphs you've created | ✅ | 🟡 | Partial — accessible via /dock |
| Thawing countdown timer | ✅ | ✅ | Live |
| Delegation position cards with full metrics | ✅ | ✅ | Live |
| Rewards CSV export | ❌ | ✅ | Lodestar leads |
| iCal thaw reminder | ❌ | ✅ | Lodestar leads |

---

### 7. Studio-Equivalent Developer Tools

| Feature | Studio | Lodestar | Verified Status |
|---|---|---|---|
| **API key management** — create, rename, regenerate, delete | ✅ | ❌ | Missing — all `GRAPH_API_KEY` references are server-side env vars, not user-managed keys |
| **API key domain/subgraph restrictions** | ✅ | ❌ | Missing |
| **Indexer routing preferences per key** (speed / price / freshness / security) | ✅ | ❌ | Missing |
| **Query usage monitoring per key** (queries executed, GRT spent, spending limits) | ✅ | ❌ | Missing |
| **Billing** — GRT deposit/withdraw, credit card, balance | ✅ | 🔒 | Out of scope |
| **Subgraph version history** list (all past deployment IDs + semver labels) | ✅ | ❌ | Missing — /dock stores current `version_label` only, no history list |
| **Deploy key** display and regeneration | ✅ | ✅ | Live — `/api/studio/deploy-key` with display and regenerate button in /dock |
| Playground for unpublished / development subgraphs | ✅ | ❌ | Missing |
| Subgraph metadata editing (name, description, image, links) | ✅ | 🟡 | Partial — via /dock |
| Subgraph ownership transfer | ✅ | ❌ | Missing |

---

### 8. Ecosystem / Product Discovery

| Feature | Explorer | Lodestar | Verified Status |
|---|---|---|---|
| Token API discovery + links | ✅ | ❌ | Missing — nav link only needed, no build |
| Substreams discovery + links | ✅ | ❌ | Missing — nav link only needed, no build |
| AI/MCP gateway (in development at Graph) | Planned | ✅ | Lodestar leads with Lodie |

---

## Priority Tiers

### Tier 1 — High impact, core parity, buildable now

1. **GraphQL playground upgrade** — swap the textarea for a proper embedded GraphiQL (schema browser, autocomplete, syntax highlighting). The API proxy already exists at `/api/subgraph-playground/[hash]`; just replace the UI layer.
2. **"Withdrawable" delegation status badge** — the logic already exists in `UndelegatePanel.tsx` (`thawing.isComplete`); surface it as a third badge state in the portfolio table so users can see at a glance which positions are ready to withdraw without opening the manage panel.
3. **Contract address search** on subgraph directory — enter a contract address, get subgraphs that index it. Needs a new branch in `subgraph-search/route.ts` querying `dataSources.source.address`.
4. **Subgraph version history tab** — list all past deployment IDs with semver labels and timestamps. Data available from GNS subgraph via `subgraph.versions`.
5. **Historical / closed allocations** on indexer detail — a second table (or tab) showing closed allocations alongside active ones.
6. **API key management** — Studio's primary developer feature. Even a basic version (create, view, delete, restrict by domain) would close a major gap for developers using Lodestar as a Studio alternative.

### Tier 2 — Meaningful gaps, moderate effort

7. **Cooldown remaining column** on indexer table — data is already in the row shape; just add it as an optional column. Low effort.
8. **Epoch status states** in an epoch table — Active / Settling / Distributing / Finalized. Needs a `status` field added to the epoch GQL query.
9. **Subgraph activity log** — per-subgraph event history (deployments, signals, queries) as a new tab.
10. **Disputes / slashing history** on indexer detail — historical dispute events from the network subgraph.
11. **Subgraph category filters** — DeFi / NFT / DAO classification (could be manual tag mapping or inferred from metadata) + sort by Most Queried / Recently Created.
12. **Per-subgraph query count** — expose raw query count alongside fees.
13. **Operator address** display on indexer detail.
14. **Network gateway query URL** on subgraph detail — show and copy the real `gateway.thegraph.com/api/.../deployments/id/[hash]` endpoint, not just the lodestar proxy path.

### Tier 3 — Polish / low effort / minor

15. Token API & Substreams discovery links — nav additions only.
16. ENS name configuration in profile settings.
17. Genesis-to-now cumulative token supply headline stat on network page.
18. Annual issuance rate (2.75%) stat card on network page.
19. Subgraph ownership transfer UI.
20. Playground for unpublished/development subgraphs (Studio workflow — lower priority unless /dock expands).

---

## Notes

- **Billing** is out of scope — Lodestar doesn't charge users and shouldn't.
- **Cooldown remaining** is present on the indexer *detail* page already; the gap is only the directory *table* column.
- **Deploy key** in /dock is fully live — not a gap.
- **Delegation withdraw** is fully live — not a gap.
- **GraphQL playground** is functional (not a link) — the gap is upgrade quality (schema browser / autocomplete), not existence.
- Tier 1 item #6 (API key management) is the biggest lift but also the most differentiating Studio feature Lodestar doesn't touch at all.
