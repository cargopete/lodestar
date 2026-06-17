---
title: "State of The Graph — H1 2026"
date: "2026-06-17"
author: "cargopete"
tags: ["the-graph", "grt", "horizon", "substreams", "analysis", "messari", "tokenomics", "governance"]
category: "Analysis"
excerpt: "An independent narrative update covering Q4 2025 through H1 2026, picking up where Messari's State of The Graph Q4 2025 left off. Network fundamentals held near multi-year highs while GRT printed a new all-time low — and the only question that matters now is whether new data-service fees can grow faster than issuance."
---

*An independent narrative update covering Q4 2025 through H1 2026 (Q1 and Q2 2026), picking up where Messari's State of The Graph Q4 2025 (published February 12, 2026) left off. Published on the Lodestar analytics dashboard blog.*

> **Editorial note on data:** Messari has not published a State of The Graph report for Q1 2026 or Q2 2026 (other chains received Q1 2026 reports in May 2026; The Graph did not). As a result, the precise, audited quarterly figures that normally anchor this series — query volume, demand-side fees, active subgraphs, Substreams revenue, indexing rewards — do **not** yet exist for H1 2026. Where exact H1 2026 quarterly numbers are unavailable, we say so explicitly and substitute live on-chain proxy data (from The Graph's Explorer, retrieved June 17, 2026) and primary-source disclosures (core-team forum updates, governance votes, official blogs). All Q2 2026 commentary is preliminary, as the quarter only just closed.

## Key Insights

- **The defining feature of H1 2026 is the divergence between protocol fundamentals and token price.** Network usage, staking participation, and active subgraphs held at or near multi-year highs, while GRT printed a new all-time low of roughly $0.0228 in February 2026 and traded in the low-$0.02s for most of the half. The market has shifted to a "show me fee growth" posture.
- **The Horizon transition moved from architecture to execution.** After Horizon went live December 11, 2025, H1 2026 was about wiring the economic layer on top of it: the Rewards Eligibility Oracle (REO) contract was deployed to Arbitrum One in March 2026, and the Graph Council approved all four GIPs underpinning Indexing Payments (DIPs) in April 2026 — clearing the final governance hurdle before mainnet.
- **The Graph published its 2026 Technical Roadmap (February 17, 2026), reframing the protocol as a six-product, multi-service data platform** spanning Subgraphs, a Blockchain JSON-RPC service, Substreams, Token API, Tycho, and Amp — organized across Protocol, Product, and Economic layers.
- **Institutional signal strengthened on the product side but weakened on the capital side.** The DTCC "Great Collateral Experiment" used Subgraphs as its data layer (detailed in a March 12, 2026 Graph blog), with DTCC crediting The Graph with cutting data-integration time "from years to weeks, and sometimes days," and Edge & Node began running a validator on the Canton Network. But Grayscale trimmed GRT in its Decentralized AI Fund on April 7, 2026, rotating capital toward Bittensor — and Coinbase delisted GRT perpetual futures in March 2026.
- **Substreams remained the bright spot in revenue mix.** After a record Q4 2025 (6.08 million GRT, up more than 4x QoQ), streaming-first data services continued to be the most credible near-term path to fee growth that could eventually offset issuance-driven sell pressure.

## Network Usage & Demand

Heading into 2026, The Graph's usage trend was one of moderation from peak, not collapse. Total quarterly queries fell to **4.97 billion in Q4 2025, down 8.9% QoQ** from 5.46 billion in Q3 — the second consecutive quarterly decline after the all-time high of 6.49 billion in Q2 2025. Demand remained heavily concentrated on Layer 2s, with **Base leading all chains at roughly 1.23 billion queries (up 11.0% QoQ)** and Arbitrum posting the strongest growth among major networks.

**No audited Q1 2026 or Q2 2026 query-volume figure has been published.** A "11.6 billion queries" figure that circulated widely in price-prediction coverage during H1 2026 is a *trailing-six-month* total (roughly H2 2025), not a Q1 2026 quarterly number, and should not be read as such. The Graph's live Explorer displays a trailing six-month query total in the high single-digit billions as of mid-June 2026, broadly consistent with the network holding its post-peak baseline rather than re-accelerating sharply.

On the demand-side revenue front, Q4 2025 produced a confusing but instructive split. Per Messari's State of The Graph Q4 2025: "Query fees measured in GRT increased 60.3% QoQ to 1.9 million GRT … However, when denominated in USD, query fees declined 8.7% QoQ to $98.7K" — as the GRT price slid and micropayment tooling (GraphTally) drove per-query costs lower. That GRT-up/USD-down pattern — usage and token-denominated fees growing while dollar revenue shrinks — is the structural story of The Graph's monetization under a falling token price, and it carried into H1 2026.

## Subgraphs

Active subgraphs reached a new all-time high of **15,539 at the end of Q4 2025, up 3.0% QoQ** from 15,087 — the seventh consecutive quarter of expansion. The caveat was creation velocity: developers launched just **458 new subgraphs in Q4 2025, down 67.7% QoQ** from 1,419, the lowest quarterly creation since Q4 2024. The installed base kept growing even as the rate of new deployment slowed sharply.

**No published end-of-Q1 2026 or Q2 2026 active-subgraph count exists.** The Graph's 2026 roadmap reframes the Subgraphs product around two priorities for the year: better economics for small-to-medium teams (via REO and DIPs) and AI-native access — Subgraph MCP, agent-to-agent (A2A) integrations, and x402-compliant gateways that let AI agents query and pay per-request without API keys. On the migration front, the **Upgrade Indexer's allocations were migrated to Horizon in March 2026**, a meaningful back-end milestone in completing the protocol's transition.

## Supply Side — Indexers & Delegators

Indexer participation was stable through Q4 2025: **99 indexers with allocated stake** (unchanged for a second consecutive quarter), and **query-serving indexers recovered to 70, up 7.7% QoQ** from 65. Critically, **staked GRT increased for the first time in three quarters**, with both indexer self-stake and delegated stake recovering — a tentative sign of renewed operator and delegator confidence despite the price environment.

As no Q1/Q2 2026 quarterly supply-side report has been published, the best current read comes from The Graph's live Explorer (Arbitrum One, retrieved June 17, 2026), which should be treated as a current-state snapshot rather than a quarter-end figure:

- **Total indexers: 86**
- **Indexer total stake: ~676.8 million GRT** (cumulative indexer rewards ~338.6 million GRT; cumulative claimed query fees ~13.9 million GRT)
- **Delegators: ~167,823**, with **~1.3 billion GRT delegated**
- **Curators: 1,264**, with **~9.1 million GRT in signal**

Indexing rewards continue to be funded by protocol issuance. The Explorer reports **annual token issuance of ~317.3 million GRT at a ~2.76% issuance rate** as of mid-June 2026 — modest by crypto standards, but on a circulating base above 10.8 billion tokens it still represents persistent structural sell pressure when newly minted rewards are liquidated. **No clean Q1 2026 quarterly indexing-rewards total (in GRT or USD) has been published**; for reference, recent historical quarters ran roughly 76–78 million GRT per quarter.

## Financial Performance

The financial narrative of H1 2026 is unambiguous: a deep, persistent drawdown. GRT **ended Q4 2025 at roughly $0.03, down 58.8% QoQ**, and the slide continued into the new year. GRT printed a **new all-time low around $0.0228 in February 2026** (some trackers place the cycle low marginally lower at roughly $0.0231 in late March 2026 — the discrepancy reflects differing exchange-aggregation methodologies, but the takeaway is the same: GRT bottomed in Q1 2026 at a fresh ATL).

Through Q2 2026, the token traded in a depressed band: roughly **$0.025–$0.028 in April**, near $0.026 in early May, then back toward $0.020 with an intra-quarter low near $0.0185 in June. Circulating market cap spent the half in the low-to-mid hundreds of millions of dollars — roughly $215–290 million depending on the date — against a circulating supply that rose past 10.8 billion GRT on continued issuance.

Two market-structure events compounded the weakness:

- **Coinbase delisted GRT perpetual futures.** Coinbase Markets announced on March 3, 2026 the suspension of GRT-PERP and 24 other contracts on Coinbase Advanced and Coinbase International Exchange, effective around 13:00 UTC on March 16, 2026; open positions were automatically settled at the average index price over the 60 minutes prior to the trading halt, with the final funding rate set to zero. GRT spot trading on Coinbase was unaffected, but the loss of a futures venue reduced liquidity and removed a hedging instrument in already-thin markets.
- **Grayscale rebalanced its Decentralized AI Fund on April 7, 2026, cutting GRT to 4.15%** and rotating most of the freed capital into Bittensor (TAO), whose weight rose from 31.35% to 43.06% to become the fund's largest single holding (NEAR sat at 24.43% and Filecoin at 9.86% after the rebalance). The move signaled a tactical institutional rotation from data-indexing toward decentralized-compute narratives, and GRT sold off on the news.

The honest framing for H1 2026: GRT's economic model requires fee volume to grow fast enough to outpace issuance-driven selling. That inflection had not arrived by the close of Q2 2026.

## Substreams & Other Data Services

Substreams was the standout revenue story heading into 2026. Per Messari's State of The Graph Q4 2025, "StreamingFast generated 9.9 million GRT (approximately $569k) in cumulative annual revenue through Substreams and Firehose. Q4 2025 represented a breakout period, with revenue increasing more than 4x quarter-over-quarter" — with quarterly Substreams revenue reaching a record **6.08 million GRT** as streaming-first pipelines gained adoption across DeFi, analytics, DePIN/AI infrastructure, and institutional users. **No Q1 2026 Substreams revenue figure has been published**, but the product sits at the center of The Graph's expansion thesis: Token API and Tycho are both built on Substreams infrastructure, and 2026 roadmap priorities for Substreams center on broader execution-client support, lower latency, and eventual integration into the protocol via Horizon.

The broader product suite advanced on multiple fronts in H1 2026:

- **Token API** — pre-indexed token balances, transfers, prices, and NFT metadata — was targeted for production-grade latency across 10+ chains in Q1 2026 (it had launched on TRON in November 2025).
- **Tycho**, a Substreams-built service for real-time DEX liquidity and pricing aimed at trading systems and solvers, was slated for a private MVP in Q1 and a public beta in Q2 2026.
- **Amp**, Edge & Node's verifiable, SQL-native blockchain database for regulated/enterprise workloads, remained in developer preview through H1, with its full SQL platform targeted for Q4 2026. graph-node v0.42.0 shipped Amp-powered subgraphs and an experimental SQL query interface within GraphQL.

## Protocol Developments

H1 2026 was, in effect, the build-out of Horizon's economic layer. The headline items:

- **Rewards Eligibility Oracle (REO):** Formalized as GIP-0079, the production REO contract was **deployed to Arbitrum One in March 2026**, alongside a newly written off-chain oracle node that replaces a prior BigQuery pipeline with direct consumption of gateway query data via Kafka. As of the April/May core-team updates, REO was in testing with activation pending completion of its audit and a governance vote. REO ties indexing-reward eligibility to delivered service quality rather than passive stake — a direct response to the issuance-vs-value-delivery critique.
- **Indexing Payments (DIPs):** The **Graph Council approved all four underpinning GIPs in April 2026** — GIP-0076 (Issuance Allocator Contract), GIP-0086 (Rewards Manager and Subgraph Service Upgrade), GIP-0087 (On-Chain Indexing Agreements), and GIP-0088 (Issuance Allocator Deployment and Indexing Payments Configuration) — clearing the final governance hurdle before mainnet deployment. DIPs give consumers and chains a flexible way to compensate indexers directly, and the work is explicitly on the path to bringing Amp onto the network as a decentralized data service.
- **x402 payments:** Gateway v27.6.0 (April 2026) added x402 support for Subgraph queries at the HTTP layer, with x402 activated in Subgraph Gateways around mid-May 2026 — enabling pay-per-request query payments (including by AI agents) in USDC without API keys.
- **Infrastructure:** graph-node shipped v0.42.0 and v0.43.0 in H1 2026, adding per-chain RPC configuration, automatic RPC provider failover, log querying via the GraphQL endpoint, and the Amp/SQL features above. Work also began on a decentralized Studio UI that would let developers publish subgraphs directly to the network, bypassing the Upgrade Indexer.
- **Cross-chain GRT:** Following the late-2025 Chainlink CCIP integration, GRT is bridged to Arbitrum, Base, and Avalanche, with Solana bridging/cross-chain staking planned for 2026. A Liquid Staking Initiative aimed at making delegation accessible to centralized-exchange custodians remained in progress.

## Ecosystem & Governance

Governance activity in H1 2026 was dominated by the DIPs/REO/issuance-allocation votes described above — arguably the most consequential cluster of GIPs since Horizon itself, because they convert Horizon's architecture into live economic mechanics.

On the institutional and enterprise front, the period featured heavy outbound presence: Edge & Node and Foundation colleagues represented The Graph at the Digital Assets Summit (DAS) NYC, Merge São Paulo, Google Next, and Money 20/20 Bangkok, and **Edge & Node announced it is running a validator on the Canton Network**, expanding its footprint in institutional DLT. The DTCC "Great Collateral Experiment" — in which Subgraphs served as the queryable data layer for a blockchain-based repo/collateral settlement pilot — was detailed in a March 12, 2026 Graph blog and reinforced the enterprise data-infrastructure narrative. Regulatory tailwinds were noted as the Digital Asset Market CLARITY Act advanced through the U.S. Senate Banking Committee in mid-May 2026.

One outstanding item: the 2026 Technical Roadmap was billed as the first of a two-part series, with a **second blog promised to detail the Graph Foundation's strategic priorities and ecosystem initiatives.** As of mid-June 2026, that follow-up had not been prominently published — a gap worth watching, since it is meant to articulate the funding, grants, and go-to-market strategy that will determine whether the technical roadmap actually converts to demand.

## Recommendations & What to Watch

For analysts, builders, and token-holders tracking The Graph through the back half of 2026, the decision-relevant question is narrow: **will new data-service fees grow faster than issuance?** Stage your conclusions against these concrete benchmarks:

1. **Near-term (next published quarterly data):** Look for the first Substreams + Token API revenue print that scales into the **millions of dollars**, not hundreds of thousands. Q4 2025's record 6.08 million GRT in Substreams revenue was meaningful in token terms but small in USD; a sustained dollar step-change is the single most important fundamental signal. Until that appears, treat GRT as a fundamentals-strong, market-doubted infrastructure asset rather than a turnaround.
2. **Protocol activation:** Confirm that **DIPs and REO actually activate on mainnet** (both were pending audit/governance at end of H1) and that REO measurably redirects issuance toward value-delivering indexers. Activation converts governance theater into real economic alignment; continued delay is a yellow flag.
3. **Enterprise conversion:** Watch for an **Amp- or DTCC-style enterprise engagement converting from pilot to recurring on-chain fees.** Institutional pilots have generated narrative but not yet measurable protocol revenue; a signed, fee-generating deal would be the strongest possible rebuttal to Grayscale's capital rotation.
4. **Foundation strategy:** The **promised second roadmap blog** on Foundation strategic priorities and grants is overdue and should be read closely when it lands — it governs whether technical capability gets a demand-generation engine behind it.
5. **Market-structure floor:** With Coinbase perps gone and Grayscale trimmed, GRT liquidity and institutional sponsorship are thinner. A re-listing on a major derivatives venue or a new fund inclusion would mark improving sponsorship; further delistings or trims would confirm the rotation thesis.

**What would change the call:** Benchmarks (1) and (2) landing together would justify upgrading GRT from "show me" to a constructive fundamental view. Their continued absence through 2026, against steady ~2.8% issuance, would validate the bear case that usage growth is real but economically insufficient.

## Caveats

- **No Messari (or equivalent audited) State of The Graph report exists for Q1 2026 or Q2 2026.** Every precise quarterly figure cited here for queries, demand-side fees, active subgraphs, Substreams revenue, and indexing rewards belongs to **Q4 2025 or earlier**. H1 2026 quantitative gaps are flagged in-text and should not be inferred.
- **Live Explorer figures (86 indexers, ~676.8M GRT indexer stake, ~1.3B GRT delegated, ~167,823 delegators, ~317.3M GRT annual issuance) are current-state snapshots as of June 17, 2026** — they reflect a post-Q1/into-Q2 2026 state, not a clean quarter-end value, and are not directly comparable to Messari's quarter-end methodology.
- **Q2 2026 is preliminary.** The quarter only just closed; protocol milestones (e.g., DIPs/REO mainnet activation, Tycho public beta) were "imminent" or "in testing" per the latest core-team updates rather than confirmed complete.
- **Price and market-cap figures vary by source** due to different exchange-aggregation methods; ranges are given where trackers disagree (e.g., the Feb 2026 ATL near $0.0228 vs. a late-March print near $0.0231).
- **Roadmap items are targets, not realized results.** Several "Q1 2026" deliverables (Horizon-based Subgraph Service mainnet, Token API production latency, Tycho MVP) are scheduled milestones; this report distinguishes confirmed shipments (REO contract deployment, DIPs GIP approvals, x402 gateway support, graph-node releases) from planned items.
- **The recurring "11.6 billion queries" stat in third-party coverage is a trailing two-quarter figure, not a single quarter**, and is excluded from quarterly comparisons here.
