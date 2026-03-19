# RFC-001: Lodestar Next — Intelligence Feed, Mobile-First, Historical Analytics

**Author:** Chief + Jenny
**Date:** 2026-03-19
**Status:** Draft

---

## Executive Summary

Three features that would make Lodestar the definitive Graph Protocol dashboard post-Horizon. Nobody else is doing any of these well — the official Explorer has two charts and no mobile support, GraphSeer is a WASM black box, Graphtronauts is possibly abandoned, and GraphScan was archived in December 2025. We have an open lane.

---

## 1. Protocol Intelligence Feed ("Intel Feed")

### What It Is

A persistent right-side panel — think Bloomberg Terminal meets crypto. Not a blog page you visit; a living feed that makes the dashboard feel alive with protocol-level intelligence.

### Why It Matters

Every other Graph dashboard shows static snapshots. Nobody generates human-readable intelligence from on-chain events. The official Explorer has zero news/feed integration. This is the single biggest visual differentiator we can ship.

### Data Sources (All Verified Working)

| Source | Endpoint | Auth | Content Type |
|--------|----------|------|-------------|
| **Graph Forum** | `forum.thegraph.com/c/{category_id}.json` | None (public JSON API) | Governance proposals, GIP discussions, announcements |
| **GIP Repository** | `api.github.com/repos/graphprotocol/graph-improvement-proposals/commits` | None (public) | GIP updates, new proposals |
| **Epoch Data** | Already in our subgraph proxy | Already configured | On-chain epoch summaries (generated) |
| **GRT Price** | Already at `/api/price` | Already configured | Price movements |

**Not included:** The Graph Blog has no RSS feed or API. However, major blog posts are cross-posted to the forum, so the forum covers this ground without fragile scraping.

### Content Types

**1. Governance & GIP Cards** (`type: 'governance' | 'gip'`)
- Source: Forum JSON API (categories 17, 11, 29) + GitHub commits API
- Left border accent: violet for GIPs, amber for governance
- Fields: title, excerpt, timestamp, view count, reply count, tags
- Links out to forum thread or GitHub commit
- Update frequency: 5-minute cache

**2. Epoch Summary Cards** (`type: 'epoch'`)
- Source: Generated server-side from consecutive epoch comparison
- Left border: green if rewards up, red if down
- Content: epoch number, rewards delta %, query fee delta %, total distributed
- Example: "Epoch 59365: +2.3% rewards, -1.1% query fees. 26.4K GRT distributed to delegators"
- This is the Bloomberg-style differentiator — nobody else does this
- Update frequency: 60-second cache (matches existing subgraph polling)

**3. Announcement Cards** (`type: 'announcement'`)
- Source: Forum general/announcements category
- Left border: star-base gradient
- Lower frequency, higher importance

### Architecture

```
src/
  app/api/feed/route.ts           — Server-side aggregation, in-memory cache
  components/layout/IntelFeed.tsx  — Right-side panel (desktop) / drawer (mobile)
  components/feed/FeedCard.tsx     — Card component with type-based styling
  components/feed/FilterBar.tsx    — Tag filter pills: All | Governance | GIPs | Epochs
  hooks/useFeed.ts                — React Query hook, 5-min staleTime + refetchInterval
  lib/feed.ts                     — Types (FeedItem interface), utilities
```

**API Route (`/api/feed`):**
- Fetches all sources in parallel
- Merges, deduplicates, sorts by timestamp descending
- In-memory cache with 5-minute TTL
- Returns unified `FeedItem[]` array
- Stale-while-revalidate for instant responses during refresh

**Feed Item Interface:**
```typescript
interface FeedItem {
  id: string;
  type: 'governance' | 'gip' | 'epoch' | 'announcement';
  title: string;
  summary: string;
  url: string;
  timestamp: string;  // ISO 8601
  tags: string[];
  metadata: {
    views?: number;
    replies?: number;
    gipStage?: string;
    epochNumber?: number;
    rewardsDelta?: string;
  };
}
```

### Layout Design

**Desktop (>1024px):** Fixed right panel, 320px wide, collapsible to 40px icon strip.
```
┌──────────┬──────────────────────────────┬────────────┐
│ Sidebar  │       Main Content           │ Intel Feed │
│  220px   │      (flexible)              │   320px    │
│          │                              │            │
│  nav     │   dashboard pages            │  cards     │
│  items   │   charts, tables             │  filters   │
│          │                              │  scroll    │
└──────────┴──────────────────────────────┴────────────┘
```

New CSS variables:
```css
--feed-width: 320px;
--feed-width-collapsed: 40px;
```

Main content padding adjusts: `pr-[var(--feed-width)]` when expanded, `pr-[var(--feed-width-collapsed)]` when collapsed.

**Collapsed state:** Vertical "Intel" text label, click to expand. Subtle pulse indicator when new items arrive.

**Mobile (<1024px):** The panel doesn't render as a sidebar. Instead:
- A floating button or tab triggers a bottom-sheet drawer
- Three positions: closed (handle only), half (50vh), full (90vh)
- Swipe down to dismiss
- Same feed content, full-width cards

### Caching Strategy

| Source | Server Cache | Stale-While-Revalidate | Rationale |
|--------|-------------|----------------------|-----------|
| Forum topics | 5 min | 15 min | Forum posts change slowly |
| GIP commits | 10 min | 30 min | GIPs update days apart |
| Epoch summaries | 60 sec | 5 min | Reuses existing subgraph data |

Client-side: React Query with `staleTime: 5 * 60 * 1000`, `refetchInterval: 5 * 60 * 1000`.

### No New Dependencies

Everything builds on `fetch`, `@tanstack/react-query` (already installed), and the existing design system.

---

## 2. Mobile-First Responsive Overhaul

### Why It Matters

The Graph's own community has called out the official Explorer for being unusable on mobile (there's a governance forum proposal about it). No Graph dashboard has good mobile support. Delegators check portfolios on their phones. This is a wide-open gap.

### Current State

The layout shell has zero responsive breakpoints. The 220px sidebar eats ~60% of the screen on mobile. Data tables overflow. Touch targets are too small (nav items at `py-[7px]` = ~30px, well below the 44px minimum). The `StatGrid` component is the only thing that's already responsive.

### Navigation: Sidebar to Bottom Tab Bar

Hide the sidebar below `md` (768px). Replace with a fixed bottom tab bar in the thumb zone.

**Bottom tab items (5):**
1. **Protocol** — Home/overview (current `/`)
2. **Indexers** — Indexer directory (`/indexers`)
3. **Services** — Horizon services (`/services`)
4. **Portfolio** — Connected wallet view (`/profile`)
5. **More** — Drawer with: Delegators, Subgraphs, Calculator, Compare, Intel Feed

```
┌─────────────────────────────────────┐
│         Page Content                │
│                                     │
│                                     │
├─────────────────────────────────────┤
│ Protocol│Indexers│Services│Portfolio│More│
└─────────────────────────────────────┘
```

Implementation:
```tsx
// Hide sidebar on mobile, show bottom nav
<aside className="hidden md:flex fixed left-0 ...">
<nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden
  h-16 bg-[var(--bg-surface)] border-t border-[var(--border)]
  flex items-center justify-around pb-[env(safe-area-inset-bottom)]">
```

### Topbar Simplification

**Desktop:** Full topbar with Arbitrum pill, GRT price, epoch, wallet address
**Mobile:** Page title + GRT price + wallet icon only. Hide Arbitrum pill and epoch number.

```tsx
<span className="hidden md:inline ...">Arbitrum</span>
<span className="hidden lg:inline ...">E{epoch}</span>
```

### Data Tables: Table-to-Card Pattern

Tables with 5-6 columns don't work on 375px screens. Pattern:

```tsx
{/* Cards on mobile, table on md+ */}
<div className="block md:hidden space-y-3">
  {data.map((item) => <MobileCard key={item.id} item={item} />)}
</div>
<div className="hidden md:block overflow-x-auto">
  <table>...</table>
</div>
```

For the indexer/curator/services tables, the mobile card shows:
- Hero: Name + primary metric (stake, signal, etc.)
- Secondary row: 2-3 compact stats
- Tap to expand: full detail breakdown

### Responsive Grid Adjustments

Components that need updating:

| Component | Current | Mobile Fix |
|-----------|---------|------------|
| `StatGrid` | Already responsive | No change needed |
| `ProvisionsPanel` stats | `grid-cols-3` | `grid-cols-1 sm:grid-cols-3` |
| `ProvisionCard` stats | `grid-cols-3` | `grid-cols-3` with reduced padding |
| Service `ServiceCard` params | `grid-cols-4` | `grid-cols-2 sm:grid-cols-4` |
| Delegation positions | `grid-cols-2` | `grid-cols-1 sm:grid-cols-2` |
| Compare page table | Full table | Stacked cards on mobile |

### Touch Targets

Minimum 44x44px for all interactive elements on mobile:
- Nav items: `py-3 md:py-[7px]`
- Buttons: already adequate (px-3 py-2 ≈ 36px height, bump to py-2.5)
- Table rows: add `py-3` minimum

### Key Breakpoints

| Breakpoint | Width | Layout Changes |
|-----------|-------|----------------|
| Default | 0px | Single column, bottom nav, cards only, no sidebar |
| `sm` | 640px | 2-col stat grids, slightly wider cards |
| `md` | 768px | Sidebar appears, bottom nav hidden, tables shown |
| `lg` | 1024px | Full tables, Intel Feed panel appears, 2-col card grids |
| `xl` | 1280px | 4-5 col stat grids, max content width |

### Viewport Configuration

```tsx
// layout.tsx
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,        // prevents zoom on input focus
  viewportFit: 'cover',   // for notched devices
};
```

CSS for safe areas:
```css
:root {
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --bottom-nav-height: 64px;
}
```

### Progressive Disclosure

The most impactful mobile UX pattern for data-heavy views. Show summary first, tap to expand:

```tsx
const [expanded, setExpanded] = useState(false);

<div onClick={() => setExpanded(!expanded)}>
  {/* Always visible: name + hero metric */}
  <div className={cn(
    "overflow-hidden transition-all duration-200",
    expanded ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
  )}>
    {/* Full breakdown: all metrics, charts, actions */}
  </div>
</div>
```

### PWA (Future Enhancement)

Adding `app/manifest.ts` would let users "install" Lodestar to their home screen. Relevant for a portfolio tracker checked daily. Not essential for v1 but worth keeping in mind.

---

## 3. Historical Trend Charts

### Why It Matters

The official Explorer has TWO charts (token supply, query volume). We already have one (rewards per epoch). Expanding to a proper analytics suite turns Lodestar from "snapshot tool" into "analytics platform."

### Available Data (Verified Against Real Subgraph)

The subgraph has **1,203 epochs** of historical data. Query root is `epoches` (not `epochs`). Each epoch spans 7,200 blocks (~6.4 hours on Arbitrum).

**Epoch fields available:**

| Field | Type | Chart Use |
|-------|------|-----------|
| `id` | ID | X-axis (epoch number) |
| `startBlock` / `endBlock` | Int | Derive approximate dates |
| `totalRewards` | BigInt | Total indexing rewards minted |
| `totalIndexerRewards` | BigInt | Indexer share of rewards |
| `totalDelegatorRewards` | BigInt | Delegator share of rewards |
| `totalQueryFees` | BigInt | Total query fees generated |
| `queryFeesCollected` | BigInt | Fees distributed to indexers |
| `curatorQueryFees` | BigInt | Curator share of fees |
| `queryFeeRebates` | BigInt | Rebates distributed |
| `taxedQueryFees` | BigInt | Protocol tax collected |
| `signalledTokens` | BigInt | Curation signal amount |
| `stakeDeposited` | BigInt | Stake activity |

**Secondary sources for per-indexer history:**
- `allocations` (closed) — have `indexingRewardCutAtStart`/`AtClose`, enabling reward cut change tracking over time
- `signalTransactions` — mint/burn events with timestamps for curation history

**What does NOT exist:** No daily/hourly snapshots, no `graphNetworkDailyData` entity. Epochs are the only native time-series.

### Chart Suite

**Chart 1: Network Rewards Trend** (existing, enhance)
- Type: Stacked area
- Series: `totalIndexerRewards` + `totalDelegatorRewards`
- Already exists as `StakingTrendChart.tsx` — enhance with time range selector and additional fields

**Chart 2: Query Fee Distribution**
- Type: Multi-line
- Series: `totalQueryFees`, `queryFeesCollected`, `curatorQueryFees`, `taxedQueryFees`
- Shows how fees flow through the protocol
- Insight: Is query fee revenue growing? What's the curator/protocol/indexer split?

**Chart 3: Staking & Signal Trends**
- Type: Dual-axis area
- Series: `stakeDeposited` (left axis), `signalledTokens` (right axis)
- Shows protocol growth and curation activity correlation

**Chart 4: Epoch-over-Epoch Comparison** (mini sparklines)
- Type: Small inline sparklines on the Protocol Overview page
- Show: rewards trend (last 30 epochs), fee trend (last 30 epochs)
- Compact, at-a-glance trend indicators next to stat cards

**Chart 5: Indexer Reward Cut History** (on indexer detail pages)
- Type: Step chart
- Data: From closed `allocations` — `indexingRewardCutAtStart` vs `indexingRewardCutAtClose`
- Critical for delegators: "Did this indexer raise their cut after attracting delegators?"
- No other dashboard shows this

### Time Range Selector

Standard crypto pattern:
```
[7D] [30D] [90D] [1Y] [All]
```

Epoch mapping (~3.75 epochs per day on Arbitrum):
- 7D = ~26 epochs
- 30D = ~112 epochs
- 90D = ~337 epochs
- 1Y = ~1,370 epochs (capped at available ~1,203)
- All = full history

Implementation: Filter client-side from a cached full dataset. Fetch all 1,203 epochs in two paginated queries, cache with React Query (10-minute staleTime), filter in a `useMemo`.

### Recharts Implementation Notes

**Responsive containers:** Fixed-height parent required. Use `h-[280px]` for dashboard grids, `h-[400px]` for full-page charts.

**Custom tooltip for crypto data:**
```tsx
const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload) return null;
  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)]
      rounded-lg p-3 shadow-lg">
      <p className="text-sm font-medium text-[var(--text)]">Epoch {label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} className="text-xs font-mono">
          <span className="text-[var(--text-muted)]">{entry.name}:</span>{' '}
          <span style={{ color: entry.color }}>{formatGRT(entry.value)} GRT</span>
        </p>
      ))}
    </div>
  );
};
```

**Epoch-to-date conversion** (for tooltip context):
```typescript
// Arbitrum ~0.25s block time
// Reference: use startBlock of a known recent epoch
function epochToApproxDate(startBlock: number, refBlock: number, refTime: number): Date {
  const blockDiff = startBlock - refBlock;
  const timeDiff = blockDiff * 250; // 250ms per block
  return new Date(refTime + timeDiff);
}
```

**Dark theme styling (consistent with existing):**
- `CartesianGrid`: `stroke="var(--border)"`, `vertical={false}`
- Axes: `axisLine={false}`, `tickLine={false}`, `tick={{ fill: 'var(--text-faint)', fontSize: 11 }}`
- Gradients: `stopOpacity` 0.3 to 0 (already established in `StakingTrendChart`)
- Unique gradient IDs per chart to avoid SVG conflicts

**Performance:**
- Under 200 data points: No concerns, render directly
- 200-500 points: Consider `isAnimationActive={false}`
- 500+: Downsample (every Nth epoch or group into daily averages)
- Always use `useMemo` for data transformation (already done in existing charts)

### Existing Query Enhancement

Current `EPOCH_HISTORY_QUERY` fetches 6 fields. Add the missing fee breakdown fields:

```graphql
epoches(first: $first, orderBy: startBlock, orderDirection: desc) {
  id startBlock endBlock
  signalledTokens stakeDeposited
  totalQueryFees totalRewards totalIndexerRewards totalDelegatorRewards
  queryFeesCollected curatorQueryFees queryFeeRebates taxedQueryFees  # ADD THESE
}
```

### Reusable Chart Wrapper

Build a `TrendChart` wrapper that encapsulates the time range selector, responsive container, custom tooltip, and dark theme styling. All specific charts become thin configurations on top of it.

```
src/
  components/charts/
    TrendChart.tsx          — Reusable wrapper (time selector + responsive + tooltip)
    TimeRangeSelector.tsx   — [7D] [30D] [90D] [1Y] [All] button group
    NetworkRewardsChart.tsx  — Stacked area: indexer + delegator rewards
    QueryFeeChart.tsx        — Multi-line: fee distribution
    StakingSignalChart.tsx   — Dual-axis area: stake + signal
    EpochSparkline.tsx       — Mini inline sparklines for stat cards
    RewardCutHistory.tsx     — Step chart for indexer detail pages
```

---

## Implementation Priority

| Phase | Feature | Effort | Impact |
|-------|---------|--------|--------|
| **Phase 1** | Mobile layout shell (bottom nav, sidebar hide, viewport) | Medium | High — unlocks entire mobile experience |
| **Phase 2** | Intel Feed panel + `/api/feed` route | Medium | High — immediate visual differentiation |
| **Phase 3** | Historical charts (enhance existing + 2 new charts) | Medium | High — "analytics platform" positioning |
| **Phase 4** | Table-to-card patterns for mobile | Low-Medium | Medium — polishes mobile UX |
| **Phase 5** | Time range selector + full epoch history | Low | Medium — power user feature |
| **Phase 6** | Indexer reward cut history chart | Low | High — delegator trust tool, nobody has this |

Phase 1 and 2 can be built in parallel (different areas of the codebase). Phase 3 builds on existing chart infrastructure. Total: probably a few solid sessions of work.

---

## What This Gets Us

After shipping all three features, Lodestar would be:

1. **The only Graph dashboard with a protocol intelligence feed** — nobody else generates epoch summaries or tracks GIP activity inline
2. **The only Graph dashboard with proper mobile support** — the community has literally asked for this in governance proposals
3. **The most chart-rich Graph analytics tool** — 5+ historical trend charts vs the Explorer's 2
4. **The only dashboard properly surfacing Horizon** — we already have Services + Provisions; charts and the feed make this even stronger

Combined with what we already have (delegation calculator, indexer comparison, provisions panel, multi-service view), this would make Lodestar unambiguously the most comprehensive Graph Protocol dashboard in existence.
