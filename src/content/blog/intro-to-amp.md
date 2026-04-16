---
title: "Intro to Amp: The Graph's Blockchain-Native Database"
date: "2026-03-28"
author: "cargopete"
tags: ["amp", "edge-and-node", "data-services", "enterprise", "horizon"]
excerpt: "Edge & Node built a blockchain-native database that turns smart contract events into SQL tables automatically. Here's what Amp is, how it works, and what it means for The Graph ecosystem."
---

Blockchain data is a mess. Smart contract events are encoded, fragmented across chains, and require custom indexing infrastructure to transform into anything useful. Developers spend months building bespoke ETL pipelines. Enterprises face an even harder problem: no existing tool meets compliance, auditability, and multi-chain requirements simultaneously.

The Graph solved part of this with subgraphs — open APIs that index blockchain data for dapps. But subgraphs are built for dapp developers writing GraphQL, not enterprise analysts writing SQL or regulated institutions filing SARs.

**Amp fills this gap.** Built by Edge & Node (the core development team behind The Graph Protocol), Amp is a blockchain-native database that transforms raw on-chain data into structured, verifiable, SQL-queryable datasets. Deploy a contract, emit events, query them with SQL. No backend. No indexers. No configuration.

## Two editions, two audiences

Amp ships in two distinct flavours.

**Amp for Developers** provides a local-first experience. It auto-generates schemas from smart contract ABIs, integrates with Foundry and Hardhat, and includes Amp Studio — a web-based query interface. There's a hosted playground at `playground.amp.thegraph.com` if you want to try it without installing anything.

**Amp for Enterprise** targets regulated banks, stablecoin issuers, and large financial institutions. On-premises, cloud, or hybrid deployment with full data sovereignty. Integration with custody platforms and screening tools. Designed for GENIUS Act compliance, SAR filings, and AML/sanctions screening.

## How it works under the hood

The core is written in **Rust** (81% of the codebase) with TypeScript for developer tooling. The data stack:

- **Apache DataFusion** — verifiable query transformations
- **Apache Arrow** — in-memory columnar data processing
- **Parquet** — storage format optimised for analytical workloads

The main daemon (`ampd`) exposes two interfaces: a **JSON Lines over HTTP server** (port 1603) for simple SQL queries via curl, and an **Arrow Flight (gRPC) server** for high-performance columnar streaming. Metadata lives in PostgreSQL. Configuration is TOML-based.

The data model revolves around **datasets** — collections of SQL tables derived from blockchain data. Raw tables map one-to-one with blockchain primitives (blocks, transactions, logs, contract events). Derived tables provide pre-computed joins and transformations, like materialised views. Configuration uses TypeScript:

```typescript
// amp.config.ts
import { defineDataset, eventTables } from '@edgeandnode/amp';

export default defineDataset({
  tables: eventTables(abi),
});
```

### Cryptographic provenance

This is the enterprise selling point. Every dataset preserves verifiable lineage back to its on-chain source through Merkle Patricia Trie reconstruction, verifying root commitments against block headers. The `ampctl verify` CLI lets you extract data with cryptographic proof that it hasn't been tampered with.

Amp also handles chain reorganisations natively — it tracks block hashes and parent hashes, invalidates data from orphaned blocks, and resumes from confirmed checkpoints.

### Performance claims

Edge & Node reports:

- **5.9x faster** than BigQuery's public datasets
- **100x faster data freshness** (1 second vs 101 seconds)
- **4,350x faster backfills** than traditional RPC endpoints
- Throughput exceeding **4 million events per second**

These are self-reported numbers. But the underlying stack — Rust, Arrow, Parquet, DataFusion — is the same stack that powers some of the fastest analytical databases in the industry, so the claims are at least architecturally plausible.

## Query interfaces and integrations

Amp supports **SQL, REST, GraphQL, Arrow Flight/Flight SQL, and JSON Lines over HTTP**. Client SDKs exist for:

- **TypeScript** (`@edgeandnode/amp` on npm)
- **Python** (`amp-python` with Arrow Flight client and Jupyter notebook support)
- **Rust**

There's also an **MCP server** (`amp-mcp`) for integration with AI assistants like Claude Desktop — query blockchain data through natural language.

Enterprise integrations target **Power BI, Snowflake, Datadog, Splunk, and Grafana**. Supported chains currently include Ethereum, Arbitrum, Base, and Base Sepolia. Solana is actively in development.

## Where Amp fits in The Graph ecosystem

Under the **Horizon** upgrade (GIP-0066), The Graph transformed from a subgraph-centric protocol into a modular platform for multiple data services. Six services now operate within the protocol:

- **Subgraphs** — custom indexing APIs (the original)
- **Substreams** — high-performance data streaming
- **Token API** — pre-indexed token data
- **Tycho** — real-time DEX liquidity tracking
- **Amp** — enterprise blockchain-native database
- **JSON-RPC Data Service** — core read/write functionality

Amp is complementary to subgraphs, not a replacement. Subgraphs serve dapp developers through GraphQL. Amp targets data analysts, enterprise teams, and regulated institutions who work in SQL.

**The critical economic link:** Amp utilises The Graph Network behind the scenes, paying indexers in GRT. Edge & Node CEO Rodrigo Coelho described it as functioning "like a content delivery network for data." More Amp queries means more fees, more token burns, and more incentive to stake GRT. The 2026 technical roadmap explicitly identifies Amp as a key growth driver.

## Development status

The GitHub repository (`edgeandnode/amp`) shows **1,398+ commits, 26 contributors, and 16 releases** as of early 2026. The project is licensed under **BUSL-1.1** (Business Source License) — converts to open source after a time-delayed period, consistent with the Red Hat model Coelho described.

Recent development highlights:

- **November 2025:** Beta shipped with open-source release; showcased at EthGlobal Buenos Aires
- **December 2025:** Initial plans for Amp on The Graph Network discussed at Indexer Office Hours
- **January 2026:** `ampctl verify` CLI completed; Kubernetes cluster set up for Solana indexing tests
- **February 2026:** Admin API for create/delete/truncate operations; backup and restore workflows

SOC 2 Type II and ISO 27001 certifications are in progress — table stakes for enterprise adoption by regulated institutions.

## What's next

**Solana support** is the most imminent expansion. An extractor is nearly complete with a dedicated Kubernetes cluster already running tests.

**Q4 2026** is the target for Amp's SQL platform and Horizon-based data service launch on the decentralised network. That would mean Amp queries are served and verified by The Graph's decentralised indexer set — not just Edge & Node's infrastructure.

Edge & Node has also been positioning for the **agentic economy** — AI agents and autonomous applications consuming verified on-chain data. The MCP server integration and a companion product called **Ampersend** (agent payment management built on Coinbase's x402 protocol) point in this direction.

## Why this matters

**For The Graph:** Amp is the enterprise beachhead. If regulated finance adopts it, that's an entirely new class of query volume flowing through the network.

**For indexers:** Q4 2026 decentralised launch means a new revenue stream — serving SQL queries to institutions that pay real money for data infrastructure.

**For developers:** Auto-generated schemas from ABIs and local-first tooling mean you can go from contract deployment to queryable data in minutes, not months.

**For the broader ecosystem:** Cryptographic provenance for blockchain data is genuinely novel. No traditional database does this. If Amp delivers on verifiability at scale, it sets a new standard for what "trustworthy data" means in finance.

## Getting started

Amp is in beta with waitlist-based access. To explore:

- **Playground:** Try queries at `playground.amp.thegraph.com`
- **SDK:** `@edgeandnode/amp` on npm (v0.0.51)
- **Python:** `amp-python` with Arrow Flight support
- **Docs:** Check the Edge & Node developer documentation

## FAQ

**How does Amp compare to Dune or Flipside?**
Dune and Flipside are analytics platforms — hosted dashboards with community queries. Amp is infrastructure. You deploy it yourself (or use the hosted version), own your data, and get cryptographic provenance. Different layer of the stack.

**Does Amp replace subgraphs?**
No. Subgraphs serve dapp frontends with GraphQL. Amp serves analysts and institutions with SQL. They're complementary — and both pay indexers through The Graph Network.

**What about The Graph's existing SQL support?**
The Graph has been exploring SQL through various initiatives. Amp is Edge & Node's specific take — a purpose-built database rather than a query layer on top of existing infrastructure.

**Is the data really verifiable?**
Yes, through Merkle Patricia Trie reconstruction against block headers. The `ampctl verify` command provides cryptographic proof of data integrity. This is the feature that makes enterprise compliance teams take it seriously.

**When can indexers start serving Amp queries?**
The target is Q4 2026 for decentralised network integration. Until then, Edge & Node operates the infrastructure directly.
