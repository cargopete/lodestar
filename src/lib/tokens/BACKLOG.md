# Tokens Detail Page — Deferred Enhancements

Captured 2026-05-07. Sized roughly; "lift" is engineering effort, not value.

## Higher lift (multi-hour)

### Lending-market cross-section (Aave / Compound / Morpho)
- For tokens accepted as collateral, surface "supplied: $X / borrowed: $Y
  / utilization Z%" on the detail page. Differentiated vs CoinGecko/CMC
  because they don't have indexer access.
- We have the `mcp__graph-aave` and `mcp__graph-lending` subgraph queries
  at our disposal. New file `src/lib/tokens/lending.ts` that aggregates
  supply/borrow snapshots per token contract.

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
- Remaining items below are real builds. Skip unless there's user demand
  beyond exploration; the page is already information-dense.
