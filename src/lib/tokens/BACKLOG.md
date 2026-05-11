# Tokens Detail Page — Deferred Enhancements

Captured 2026-05-07. Sized roughly; "lift" is engineering effort, not value.

## Higher lift (multi-hour)

### Lending-market expansion (Compound / Morpho / Spark)
- Aave V3 mainnet shipped 2026-05-08 (`src/lib/tokens/lending.ts` +
  `LendingCard` on detail page; 35 of our seed tokens light up).
- Compound V3 (cUSDCv3, cWETHv3, cUSDTv3) and Morpho Blue both have
  per-market schemas; add as additional `markets[]` entries with the
  same shape so the existing card renders multi-protocol breakdowns
  without a redesign. Spark (forked Aave V3) shares the schema.
- Future: cross-chain Aave V3 (Arbitrum, Base, Polygon, Optimism)
  using `altContracts` from the seed and per-chain subgraph IDs.

### Price-impact estimate via V3 ticks
- "$10K moves price 0.2% on top pool" — separates real liquidity from
  headline TVL.
- Real math: pull pool ticks from the V3 subgraph, simulate a swap of
  given size against current liquidity distribution. Existing libs
  (e.g. Uniswap SDK) handle the math but pull a heavy dependency.

### Holder count delta over time
- "+312 holders this week" / "-1.2% from peak". Token API gives us a
  point-in-time holder count but no history.
- Needs a daily cron writing the holder count to Redis/KV under a
  `holders:<chain>:<contract>:<date>` key. Pre-deploy infra work.

### ATH / drawdown from ATH
- Standard sentiment anchor.
- Token API `/v1/evm/pools/ohlc` caps each page at 100 daily bars.
  Detail today fetches 4 pages (~200 days). For true ATH we'd need
  ~12 pages — expensive. Probably better to fetch monthly bars first
  for the long lookback, then daily for the recent window.

## Notes

- Quick-win items #1–#5 shipped 2026-05-07.
- Medium-lift items #6 (volume strip), #7 (vol vs ETH benchmark),
  #8 (cross-pool spread) shipped 2026-05-07.
- 2026-05-08: PancakeSwap V3 mainnet + Aerodrome Base added to DEX
  volume aggregator (~+$386M total daily volume captured); Aave V3
  mainnet lending card shipped on detail page.
- 2026-05-08 (later): Aave V3 lending expanded to all 5 Graph-Network
  deployments (mainnet + Arbitrum + Base + Polygon + Optimism); 17 seeds
  patched with missing `altContracts` to unlock L2 lending coverage;
  Hyperliquid perps card added on detail page (Pinax Token API
  `/v1/hyperliquid/*`, surfacing OI / 24h volume / annualized funding /
  daily liquidations split by long/short).
- Remaining items below are real builds. Skip unless there's user demand
  beyond exploration; the page is already information-dense.
