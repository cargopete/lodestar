export type RoadmapLayer = 'product' | 'protocol' | 'economics';
export type OfficialStatus = 'shipped' | 'in_progress' | 'planned' | 'experimental';
export type LodestarStatus = 'on_track' | 'delayed' | 'shipped' | 'uncertain';

export interface RoadmapLink {
  label: string;
  url: string;
}

export interface RoadmapItem {
  id: string;
  layer: RoadmapLayer;
  title: string;
  description: string;
  /** Expanded detail shown in the drawer */
  detail?: string;
  /** What this means specifically for indexers */
  indexerImpact?: string;
  /** What this means specifically for delegators */
  delegatorImpact?: string;
  quarterStart: string;
  quarterEnd?: string;
  officialStatus: OfficialStatus;
  /** Lodestar's read on actual progress — edit this field to update */
  lodestarStatus?: LodestarStatus;
  lodestarNote?: string;
  gipId?: string;
  links?: RoadmapLink[];
  tags?: string[];
}

export const ROADMAP_ITEMS: RoadmapItem[] = [

  // ─── PRODUCT LAYER ────────────────────────────────────────────────────────

  {
    id: 'amp-developer-preview',
    layer: 'product',
    title: 'Amp: Developer Preview',
    description: "The world's first blockchain-native SQL database. Amp transforms raw on-chain data into verifiable, queryable intelligence via SQL, REST, and GraphQL simultaneously.",
    detail: "Amp is Edge & Node's flagship enterprise product. Every data point carries cryptographic lineage — full auditability from chain event to API response. It claims 5.9× faster query performance than BigQuery on public datasets, 4,300× faster backfill, and 4M+ events/sec throughput. Launched with a $10,000 ETHGlobal Buenos Aires bounty programme in late 2025. SOC 2-aligned architecture targets institutional and compliance-sensitive clients. Currently centralised; the network-native version (Horizon Data Service) isn't due until Q4 2026.",
    indexerImpact: "Not yet applicable — Amp is centralised at this stage. Once the Horizon-Based Amp Data Service ships (Q4 2026), indexers will be able to serve Amp queries and earn fees from enterprise clients.",
    delegatorImpact: "Indirect exposure only until Q4 2026. When Amp moves onto the network, the enterprise fee stream from compliance-grade institutional clients could become one of the highest-revenue services on the protocol.",
    quarterStart: 'Q4 2025',
    officialStatus: 'shipped',
    lodestarStatus: 'shipped',
    links: [
      { label: 'Introducing Amp', url: 'https://thegraph.com/blog/introducing-amp/' },
      { label: 'Amp Product Page', url: 'https://thegraph.com/amp/' },
    ],
    tags: ['Amp'],
  },
  {
    id: 'tycho-private-mvp',
    layer: 'product',
    title: 'Tycho: Private MVP',
    description: 'Real-time DeFi liquidity data service providing unified DEX pool state, block-by-block delta updates, and swap simulation — without on-chain execution.',
    detail: "Tycho is built by PropellerHeads and runs on Substreams under the hood. It is live today on Ethereum, Base, and Unichain, currently off-protocol (paying StreamingFast directly). Private MVP / white-glove onboarding for professional trading firms is the Q2 2026 milestone. The public, self-service beta targets end of Q2 2026. Primary consumers are DeFi solvers, searchers, and market makers — high-frequency, price-insensitive users who need block-level granularity. GraphOps has independently deployed the full Tycho stack, demonstrating the indexer playbook.",
    indexerImpact: "High-opportunity new service. Once Tycho moves onto the network (Q3 2026), indexers running the Tycho stack earn fees from professional trading operations. GraphOps is already running it independently — early movers will have a significant head start.",
    delegatorImpact: "DeFi trading firms are high-volume, recurring payers. If Tycho on-network scales, this could be among the highest per-query revenue streams on the protocol.",
    quarterStart: 'Q2 2026',
    officialStatus: 'in_progress',
    lodestarStatus: 'on_track',
    lodestarNote: 'Live off-protocol today. GraphOps already running full stack. White-glove onboarding imminent.',
    links: [
      { label: 'Lodestar: Intro to Tycho', url: 'https://dev.lodestar-dashboard.com/blog/intro-to-tycho-data-service' },
      { label: 'The Graph Technical Roadmap', url: 'https://thegraph.com/blog/technical-roadmap/' },
    ],
    tags: ['Tycho'],
  },
  {
    id: 'tycho-public-beta',
    layer: 'product',
    title: 'Tycho: Public Beta Launch',
    description: 'Self-service public beta of Tycho data service on The Graph Network — open sign-up for DeFi protocols, solvers, and developers.',
    detail: "The public beta follows the private MVP / white-glove phase. It opens Tycho's block-level DEX liquidity data to any developer, not just vetted trading firms. This is the milestone that starts generating broader usage metrics and validates product-market fit before the Q3 2026 network integration.",
    indexerImpact: "Increased usage in the public beta phase validates demand before network integration, giving indexers conviction on whether to invest in Tycho infrastructure.",
    delegatorImpact: "Public beta query volumes will be the first signal of whether Tycho's fee potential is real. Worth monitoring closely.",
    quarterStart: 'Q3 2026',
    officialStatus: 'planned',
    tags: ['Tycho'],
  },
  {
    id: 'token-api-billing',
    layer: 'product',
    title: 'Token API: Beta Billing & API Compatibility',
    description: 'Production-ready REST/MCP API for token balances, transfer histories, OHLC pricing, whale tracking, and token metadata across 10+ chains. In production.',
    detail: "The Token API launched in late Q2 2025 as a direct replacement for SimpleHash's discontinued service, and is now in production across Ethereum, Arbitrum, BSC, Polygon, Optimism, Base, and more (10 networks total). Semiotic Labs shipped a Rust-based model in Q1 2026 achieving sub-millisecond latency per call. Fully MCP-integrated — queryable by Claude, Cursor, and ChatGPT without API keys via x402 payment standard. Agents can discover the schema autonomously. The billing integration and API compatibility milestone is effectively complete.",
    indexerImpact: "Currently operates largely off the decentralised network. As the Token API migrates into the network economic model, the query fee volume from 10+ chains translates directly into indexer fee earnings.",
    delegatorImpact: "Once fully on-network, the Token API's AI agent query volume could be substantial — agents making automated token lookups at high frequency.",
    quarterStart: 'Q2 2026',
    officialStatus: 'in_progress',
    lodestarStatus: 'shipped',
    lodestarNote: 'In production across 10 networks with sub-millisecond latency. Billing integration done.',
    links: [
      { label: 'Token API Beta Blog', url: 'https://thegraph.com/blog/token-api-the-graph/' },
      { label: 'Token API Product Page', url: 'https://thegraph.com/token-api/' },
    ],
    tags: ['Token API'],
  },
  {
    id: 'token-api-production',
    layer: 'product',
    title: 'Token API: Real-Time Pricing & Chain Expansion',
    description: 'Token API expanding to real-time DEX pricing with additional chain coverage and further latency improvements.',
    quarterStart: 'Q3 2026',
    officialStatus: 'planned',
    tags: ['Token API'],
  },
  {
    id: 'substreams-burn-base',
    layer: 'product',
    title: 'Substreams: Protocol Billing Integration',
    description: 'On-chain billing layer for Substreams — routing usage fees through GRT protocol economics including a burn component. Currently Substreams revenue flows off-chain.',
    detail: "Substreams revenue hit 6.08M GRT in Q4 2025 (4× QoQ growth) — the protocol's fastest growing product. But this revenue is currently paid off-chain directly to StreamingFast/gateway providers and does not flow through the on-chain GRT burn mechanism. The billing integration item is about fixing this: routing Substreams query fees through GraphTally and creating an on-chain burn. The full trust-minimised path requires the Substreams P2P Data Service MVP (Q2 2026) and GraphTally to be stable first.",
    indexerImpact: "Until Substreams billing is on-chain, the protocol's biggest growth product isn't benefiting indexers directly. Once it is, indexers running Substreams infrastructure earn from the fastest-growing fee stream in the protocol.",
    delegatorImpact: "The GRT burn component of on-chain Substreams billing directly benefits all GRT holders via reduced supply. 6M+ GRT/quarter through a burn mechanism is non-trivial at scale.",
    quarterStart: 'Q2 2026',
    officialStatus: 'in_progress',
    lodestarStatus: 'uncertain',
    lodestarNote: "Revenue is massive (6M GRT/Q4 2025) but on-chain billing hasn't been confirmed as shipped. Waiting on GraphTally P2P MVP.",
    links: [
      { label: 'StreamingFast Jan 2026 Update', url: 'https://forum.thegraph.com/t/streamingfast-update-january-2026/6838' },
      { label: 'GraphTally Blog', url: 'https://thegraph.com/blog/graph-tally-indexer-micropayments/' },
    ],
    tags: ['Substreams'],
  },
  {
    id: 'amp-sql-platform',
    layer: 'product',
    title: 'Amp: SQL Platform',
    description: "Experimental SQL query interface over Amp's verifiable raw blockchain data — enterprise-grade analytics directly on chain state.",
    quarterStart: 'Q3 2026',
    quarterEnd: 'Q4 2026',
    officialStatus: 'experimental',
    tags: ['Amp'],
  },

  // ─── PROTOCOL LAYER ───────────────────────────────────────────────────────

  {
    id: 'subgraphs-horizon-service',
    layer: 'protocol',
    title: 'Subgraphs: Horizon Protocol Migration',
    description: 'Migration of the Subgraph data service onto the Horizon protocol framework — formalising it as a registered service with unified staking, payments (GraphTally), and REO integration.',
    detail: "Horizon mainnet launched December 2025. GIPs 0066, 0068, and 0085 defined the Horizon mechanisms — all approved by the Graph Council. GIP-0086 (Rewards Manager & Subgraph Service Upgrade, filed March 6 2026) adds the final integration hooks: POIPresented event logging, freeze accumulators for denied subgraphs, and the REO oracle connection point. Critically, GIP-0086 adds the hooks but does NOT activate reward gating automatically — that requires a separate governance vote. As of March 2026, GIP-0086 is still in forum discussion, suggesting the full Q1 target has slipped slightly.",
    indexerImpact: "The most consequential near-term protocol change for indexers. It restructures rewards distribution, adds on-chain visibility into POI presentations, and sets up the gating point for REO eligibility. Running a high-quality service is about to have real protocol-level consequences.",
    delegatorImpact: "Services your chosen indexers run become formally secured within the protocol. The new framework also makes indexer quality more visible on-chain — better signal for delegation decisions.",
    quarterStart: 'Q2 2025',
    quarterEnd: 'Q3 2025',
    officialStatus: 'in_progress',
    lodestarStatus: 'delayed',
    lodestarNote: "Horizon launched Dec 2025 but GIP-0086 (Rewards Manager upgrade) still in forum as of March 2026. Reward gating not yet active.",
    links: [
      { label: 'Horizon Upgrade Live', url: 'https://thegraph.com/blog/horizon-upgrade-live/' },
      { label: 'Horizon Implementation Guide', url: 'https://thegraph.com/blog/horizon-implementation-guide/' },
      { label: 'GIP-0086 Forum Thread', url: 'https://forum.thegraph.com/t/gip-0086-rewards-manager-and-subgraph-service-upgrade/6868' },
    ],
    tags: ['Subgraphs', 'Horizon'],
  },
  {
    id: 'amp-horizon-service',
    layer: 'protocol',
    title: 'Amp: Horizon-Based Data Service',
    description: 'Amp data service launched on the Horizon protocol framework, testnet and mainnet — enabling indexers to serve Amp queries and earn protocol fees.',
    quarterStart: 'Q3 2025',
    quarterEnd: 'Q4 2025',
    officialStatus: 'shipped',
    lodestarStatus: 'shipped',
    tags: ['Amp', 'Horizon'],
  },
  {
    id: 'subgraphs-agentic',
    layer: 'protocol',
    title: 'Subgraphs: Agentic Service (x402 / MCP / A2A)',
    description: 'Subgraphs natively consumable by AI agents — x402 micropayments without API keys, MCP integration for Claude/Cursor/ChatGPT, and Agent-to-Agent protocol support.',
    detail: "Three components: (1) x402 protocol — agents autonomously pay per-query without API keys or human setup; (2) MCP (Model Context Protocol) — subgraphs are queryable through Claude, Cursor, and ChatGPT with automatic schema discovery, no configuration; (3) A2A (Agent-to-Agent) — agent workflows where one AI orchestrates another that queries The Graph. The Graph Foundation partnered with Agent0 on ERC-8004 canonical APIs and formally backed both x402 and ERC-8004 standards in February 2026. If The Graph becomes the default blockchain data layer for autonomous AI agents, query volumes could dwarf current human-driven usage.",
    indexerImpact: "AI agent workloads are high-frequency, low-latency, and continuous. If x402/MCP scales, the query volume uplift for well-positioned indexers could be significant.",
    delegatorImpact: "More query fee volume means better returns for delegators to high-performing indexers. The agentic economy is the next major demand driver for on-chain data.",
    quarterStart: 'Q1 2026',
    quarterEnd: 'Q2 2026',
    officialStatus: 'in_progress',
    lodestarStatus: 'on_track',
    lodestarNote: 'The Graph formally backed x402 and ERC-8004 in Feb 2026. MCP/A2A framework actively being built.',
    links: [
      { label: 'x402 & ERC-8004 Blog', url: 'https://thegraph.com/blog/understanding-x402-erc8004/' },
      { label: 'The Graph Technical Roadmap', url: 'https://thegraph.com/blog/technical-roadmap/' },
    ],
    tags: ['Subgraphs', 'AI Agents'],
  },
  {
    id: 'amp-verifiable-data',
    layer: 'protocol',
    title: 'Amp: Verifiable Raw Blockchain Data',
    description: "Protocol-level cryptographic verifiability for Amp's raw blockchain data — every data point has a proof chain back to the original block.",
    detail: "This is the mechanism that makes Amp's enterprise pitch credible: not just fast data, but provably correct data. Full data lineage from chain event to API response, enabling SOC 2-aligned audit trails. This spans Q4 2025 through Q4 2026 — the long tail reflects the difficulty of building cryptographic proofs for arbitrary on-chain data at Amp's claimed 4M+ events/sec throughput.",
    indexerImpact: "When the Horizon-based Amp service ships (Q4 2026), indexers serving verifiable data may command premium fees from compliance-sensitive enterprise clients.",
    delegatorImpact: "The verifiability feature is what differentiates Amp from commodity blockchain data providers and justifies enterprise price points.",
    quarterStart: 'Q4 2025',
    quarterEnd: 'Q4 2026',
    officialStatus: 'in_progress',
    tags: ['Amp'],
  },
  {
    id: 'substreams-p2p-spec',
    layer: 'protocol',
    title: 'Substreams: P2P Data Service on Horizon',
    description: 'Substreams as a Horizon-native data service — on-chain payments via GraphTally, staked indexers serving streaming data, Provider Selection Oracle routing consumers to best providers.',
    detail: "This is the mechanism that brings Substreams' 6M+ GRT/quarter revenue onto the protocol. Currently Substreams fees flow off-chain. The P2P Data Service spec defines the consumer-provider handshake, payment session streaming, RAV (Receipt Aggregation Voucher) loop, and underpayment protection. GraphOps confirmed in February 2026 they implemented the basic consumer-provider handshake and payment session stream — 'getting closer to a demo-ready MVP.' Q2 2026 target for MVP; Q3 2026 for Provider Selection Oracle and permissionless launch.",
    indexerImpact: "Direct revenue opportunity from Substreams. Indexers who invest in Substreams infrastructure (high-CPU, persistent state) would earn from the fastest-growing fee stream in the protocol once it's on-chain.",
    delegatorImpact: "Once Substreams fees flow through the protocol, delegators to Substreams-capable indexers benefit proportionally from what is currently 6M+ GRT/quarter off-chain.",
    quarterStart: 'Q2 2026',
    officialStatus: 'in_progress',
    lodestarStatus: 'on_track',
    lodestarNote: 'GraphOps confirmed basic handshake and payment session stream implemented in Feb 2026. Demo-ready MVP close.',
    links: [
      { label: 'GraphOps Feb 2026 Update', url: 'https://forum.thegraph.com/t/graphops-update-february-2026/6855' },
      { label: 'GraphTally Blog', url: 'https://thegraph.com/blog/graph-tally-indexer-micropayments/' },
    ],
    tags: ['Substreams', 'Horizon'],
  },
  {
    id: 'tycho-horizon-service',
    layer: 'protocol',
    title: 'Tycho: Horizon-Based Data Service',
    description: 'Tycho DeFi liquidity service moved onto The Graph Network — indexers serve processed DEX data, earn fees from DeFi trading firms via GraphTally.',
    detail: "Bringing Tycho onto the Horizon protocol means trading firms' payments route through GRT, staked indexers compete for query allocation, and the economic security of staked GRT backs the service. GraphOps is the leading candidate to run this as they've already independently deployed the full stack. Depends on Substreams P2P Data Service MVP (Q2) and GraphTally integration being stable.",
    indexerImpact: "Only a small set of indexers currently have the technical capacity to run Tycho stacks. Early movers (like GraphOps) will have disproportionate access to DeFi trading firm fees.",
    delegatorImpact: "DeFi solvers and market makers are high-volume, price-insensitive consumers with professional SLAs. This could be the highest per-query revenue service on the network if demand holds.",
    quarterStart: 'Q2 2026',
    officialStatus: 'experimental',
    tags: ['Tycho', 'Horizon'],
  },
  {
    id: 'substreams-p2p-mvp',
    layer: 'protocol',
    title: 'Substreams: Provider Selection Oracle',
    description: 'Algorithmic routing of Substreams consumers to the best available providers based on latency, uptime, and geographic proximity — enabling permissionless provider market.',
    quarterStart: 'Q3 2026',
    officialStatus: 'planned',
    tags: ['Substreams'],
  },
  {
    id: 'substreams-data-integrity',
    layer: 'protocol',
    title: 'Substreams: Data Integrity & Service Availability',
    description: 'Probabilistic challenge-response verification for Substreams data — enabling the network to detect misbehaving providers without re-executing every stream.',
    detail: "Without verification, consumers must trust Substreams providers blindly. With probabilistic challenge-response, misbehaving providers can be slashed — making Substreams staking economically meaningful rather than security theatre. This is technically harder than static query verification because Substreams data is a continuous stream. Q4 2026 is ambitious. A Substreams REO (analogous to the Subgraph REO) is also planned for Q4 2026 to gate issuance for Substreams providers.",
    indexerImpact: "High-quality Substreams providers benefit from a verification mechanism that exposes bad actors. Creates a meaningful quality signal for differentiation.",
    delegatorImpact: "Slashing risk for misbehaving Substreams providers increases incentive alignment. Worth monitoring once it ships.",
    quarterStart: 'Q3 2026',
    quarterEnd: 'Q4 2026',
    officialStatus: 'experimental',
    tags: ['Substreams'],
  },
  {
    id: 'json-rpc-service',
    layer: 'protocol',
    title: 'JSON-RPC: Experimental Data Service',
    description: 'Proposed data service bringing Ethereum JSON-RPC (standard node read interface) onto The Graph Network — monetising RPC infrastructure that many indexers already run.',
    detail: "JSON-RPC is one of the highest-volume blockchain data services. Indexers who already run Ethereum, Arbitrum, or other node infrastructure could earn protocol fees on queries they're already serving. The roadmap explicitly notes 'multiple implementation paths being validated' — this is early research, not a spec. No GIPs filed publicly. Competes with Alchemy, Infura, and Quicknode who operate at massive scale with thin margins. The economic model for on-chain RPC payments is unresolved.",
    indexerImpact: "Potentially significant for indexers already running node infrastructure. Zero new capital expenditure for existing node operators — just a new revenue stream on existing work.",
    delegatorImpact: "RPC is a massive market. If The Graph captures even a small share of the addressable market, the fee volumes would dwarf current subgraph query fees.",
    quarterStart: 'Q3 2026',
    officialStatus: 'experimental',
    lodestarStatus: 'uncertain',
    lodestarNote: 'Research only. No spec, no GIP. "Multiple implementation paths being validated" means this is genuinely open-ended.',
    tags: ['JSON-RPC'],
  },
  {
    id: 'subgraphs-amp-powered',
    layer: 'protocol',
    title: 'Subgraphs: Amp-Powered Verifiable Subgraphs',
    description: "Subgraphs backed by Amp's verifiable raw blockchain data — every subgraph result carries cryptographic lineage from Amp's audit-ready pipeline.",
    detail: "This bridges the enterprise Amp product with the developer-facing subgraph ecosystem. A subgraph built on Amp data would inherit Amp's SOC 2-aligned audit trail, making subgraph results compliance-grade rather than trust-based. Q4 2026 and depends on both the Amp SQL platform and Amp Horizon Data Service being stable first. No specification exists publicly.",
    indexerImpact: "May create a two-tier market: standard subgraphs vs. Amp-powered verifiable subgraphs. Indexers serving the latter may command premium fees from institutional clients.",
    quarterStart: 'Q3 2024',
    quarterEnd: 'Q4 2025',
    officialStatus: 'shipped',
    lodestarStatus: 'shipped',
    tags: ['Subgraphs', 'Amp'],
  },

  // ─── ECONOMICS LAYER ──────────────────────────────────────────────────────

  {
    id: 'grt-multi-chain',
    layer: 'economics',
    title: 'GRT: Multi-Chain Expansion via Chainlink CCIP',
    description: 'GRT bridged across multiple chains via Chainlink CCIP — enabling delegation, staking, and query fee payments natively on Ethereum, Arbitrum, Base, and Solana.',
    detail: "Phase 1 is bridging infrastructure for secure GRT transfers. Future phases add cross-chain staking and delegation. GRT is already on Arbitrum and Base (pre-CCIP). The Chainlink CCIP adoption was announced with Solana integration as a 2026 target. Cross-chain staking and delegation are described as contingent on Phase 1 bridging completing successfully first. The Q4 2025 roadmap item likely refers to groundwork, not full cross-chain delegation.",
    indexerImpact: "Cross-chain query fee payments mean developers on Base, Solana, or Ethereum mainnet can pay without bridging. Expands the addressable payer market.",
    delegatorImpact: "The biggest unlock is cross-chain delegation — if you can delegate natively on Base without bridging to Arbitrum One, participation UX improves dramatically and total delegated stake could increase.",
    quarterStart: 'Q2 2025',
    officialStatus: 'in_progress',
    lodestarStatus: 'uncertain',
    lodestarNote: 'Bridging groundwork done but full cross-chain delegation (the meaningful part) depends on Phase 1 completing. Solana is complex.',
    links: [
      { label: 'GRT Cross-Chain via CCIP', url: 'https://thegraph.com/blog/grt-cross-chain-access-via-chainlink-ccip/' },
    ],
    tags: ['GRT', 'Cross-chain'],
  },
  {
    id: 'grt-liquid-staking',
    layer: 'economics',
    title: 'GRT: Liquid Staking & Morpho Integration',
    description: 'Native liquid staking for GRT — a receipt token representing delegated GRT usable as collateral in DeFi (Morpho). Dissolves the 28-day unbonding lock.',
    detail: "Currently delegating GRT locks capital for 28 days on undelegation — a massive barrier to participation. Liquid staking issues a receipt token that can be used as collateral (e.g. borrow against your staked position on Morpho), making delegation competitive with liquid staking protocols like stETH. Testnet is Q2 2026; Morpho mainnet integration is Q4 2026. Regulatory complexity around liquid staking (especially for institutional custodians) is a potential blocker.",
    indexerImpact: "Higher total delegated stake means more capacity, more rewards distributed across the protocol ecosystem.",
    delegatorImpact: "Potentially game-changing. Eliminates the liquidity penalty of delegation. Delegators can access capital against staked positions without undelegating. Makes GRT staking significantly more attractive vs. liquid alternatives.",
    quarterStart: 'Q2 2026',
    quarterEnd: 'Q4 2026',
    officialStatus: 'planned',
    lodestarStatus: 'on_track',
    lodestarNote: 'Testnet Q2 2026. Morpho mainnet Q4 2026. This could be the single most impactful delegator feature of the year.',
    links: [
      { label: 'The Graph Technical Roadmap', url: 'https://thegraph.com/blog/technical-roadmap/' },
    ],
    tags: ['GRT', 'Staking', 'DeFi'],
  },
  {
    id: 'onchain-indexing-agreements',
    layer: 'economics',
    title: 'On-Chain Indexing Agreements (GIP-0087 / GIP-0088)',
    description: 'Direct payment contracts between payers (dApps, chains, ecosystem funds) and indexers — payers create offers with terms, indexers accept via smart contract, payment on POI.',
    detail: "GIP-0087 defines on-chain indexing agreements: payers create offers with terms; indexers accept via smart contract; payment occurs upon POI presentation. ~5% of protocol issuance is redirected to fund these agreements initially. GIP-0088 defines the issuance allocation mechanism alongside it. This is the public version of what the roadmap previously labelled as 'DRT' or 'DPh' — those terms are not found in any public documentation. Filed March 6 2026, currently in forum discussion. This is the most important new economic primitive in Horizon for indexers.",
    indexerImpact: "Transforms indexing from a passive issuance collection game into an active market. Well-positioned indexers can negotiate direct commercial relationships with chains and dApps, earning above-protocol rates for guaranteed service.",
    delegatorImpact: "Indexers with strong agreement portfolios will outperform pure issuance chasers. This increases the performance spread between high-quality and low-quality indexers, making indexer selection more impactful for delegators.",
    quarterStart: 'Q2 2026',
    officialStatus: 'in_progress',
    lodestarStatus: 'on_track',
    lodestarNote: 'GIP-0087 & 0088 filed March 2026. The most consequential new economic mechanism in Horizon.',
    gipId: 'GIP-0087',
    links: [
      { label: 'GIP-0087 & 0088 Forum Thread', url: 'https://forum.thegraph.com/t/on-chain-indexing-agreements-and-issuance-allocation-gip-0087-gip-0088/6869' },
    ],
    tags: ['Economics', 'Indexing Agreements'],
  },
  {
    id: 'subgraphs-reo-spec',
    layer: 'economics',
    title: 'REO: Reward Gating Enforcement (GIP-0079 / GIP-0086)',
    description: 'Final enforcement of the Rewards Eligibility Oracle — indexers failing quality checks (latency, response, data freshness) are denied protocol rewards.',
    detail: "GIP-0079 defines the oracle: off-chain nodes evaluate indexer performance over 28-day windows, an on-chain contract maintains an eligibility registry with 14-day windows. GIP-0086 (March 2026) adds the Rewards Manager integration hooks. Critically: GIP-0086 adds the hooks but does NOT activate reward gating — a separate governance vote is needed to connect the oracle. As of March 2026, GIP-0086 is still in forum discussion. The Lodestar REO page tracks current oracle-sourced eligibility for every indexer in real time.",
    indexerImpact: "Critical. Under current protocol, rewards flow regardless of actual service quality. REO enforcement means underperforming indexers get cut off from issuance. Indexers running marginal infrastructure purely for passive issuance will be hit hardest. High-quality, query-serving indexers benefit from reduced dilution.",
    delegatorImpact: "Delegating to an REO-ineligible indexer means zero issuance for your delegation during the exclusion period. Indexer selection just got significantly more consequential. Check REO status on every indexer page on Lodestar.",
    quarterStart: 'Q1 2026',
    officialStatus: 'in_progress',
    lodestarStatus: 'delayed',
    lodestarNote: "GIP-0086 still in forum as of March 2026. Reward gating activation requires a separate governance vote after 0086 passes. Timeline slipping from Q1.",
    gipId: 'GIP-0079',
    links: [
      { label: 'GIP-0079 Forum Thread', url: 'https://forum.thegraph.com/t/gip-0079-indexer-rewards-eligibility-oracle/6734' },
      { label: 'GIP-0086 Forum Thread', url: 'https://forum.thegraph.com/t/gip-0086-rewards-manager-and-subgraph-service-upgrade/6868' },
      { label: 'REO Contract on GitHub', url: 'https://github.com/graphprotocol/rewards-eligibility-oracle' },
    ],
    tags: ['REO', 'Economics'],
  },
  {
    id: 'substreams-reo',
    layer: 'economics',
    title: 'Substreams: Rewards Eligibility Oracle',
    description: 'REO extended to Substreams providers — quality metrics gate protocol issuance for Substreams indexers, analogous to the Subgraph REO.',
    detail: "Once Substreams is fully on-protocol (Q2-Q3 2026), the REO mechanism extends to Substreams providers. This means Substreams indexers must demonstrate quality service (uptime, latency, data correctness) to earn protocol issuance — just as subgraph indexers must. Substreams REO testnet is Q2 2026; mainnet is Q4 2026. No GIP filed yet.",
    indexerImpact: "Substreams indexers who invest in reliable infrastructure will earn; those running marginal setups will be excluded from issuance. Same dynamic as the Subgraph REO but for a newer, faster-growing revenue stream.",
    delegatorImpact: "Delegators to Substreams-focused indexers will want to track their REO eligibility once this ships.",
    quarterStart: 'Q2 2026',
    quarterEnd: 'Q4 2026',
    officialStatus: 'planned',
    tags: ['Substreams', 'REO', 'Economics'],
  },
  {
    id: 'network-first-chain-integration',
    layer: 'economics',
    title: 'Network-First Chain Integration Process',
    description: 'Updated chain onboarding: chains must demonstrate active subgraphs and sustained query volume to receive protocol-funded indexing rewards — dead chains get cut.',
    detail: "The updated Chain Integration Process (CIP) shifts from a bootstrapping model (any compatible chain gets rewards) to a demand-proven model (chains must show active usage). Chains that no longer qualify become accessible via Subgraph Studio but without protocol economics behind them. The GIP-0087 DIPs mechanism is the complementary tool: chains/ecosystems that want indexing coverage can now directly pay for it. The formal integration of DIPs into chain onboarding is Q2–Q3 2026.",
    indexerImpact: "Indexers staking on low-usage chains should audit their allocations. 'Orphan' chains still work technically but have no issuance. DIPs creates a market where chains pay directly for indexing — well-positioned indexers can negotiate commercial relationships with ecosystems wanting coverage.",
    delegatorImpact: "Indexers earning rewards on low-usage chains will see those rewards cut. Delegators to such indexers face reduced returns until those indexers reallocate to active chains.",
    quarterStart: 'Q2 2026',
    quarterEnd: 'Q3 2026',
    officialStatus: 'in_progress',
    lodestarStatus: 'on_track',
    lodestarNote: 'Updated CIP already live. DIPs (GIP-0087) integration into chain onboarding is Q2-Q3 2026.',
    links: [
      { label: 'Evolving Chain Integration', url: 'https://thegraph.com/blog/cip-update/' },
      { label: 'GIP-0087 Forum Thread', url: 'https://forum.thegraph.com/t/on-chain-indexing-agreements-and-issuance-allocation-gip-0087-gip-0088/6869' },
    ],
    tags: ['Chain Integration', 'Economics'],
  },
  {
    id: 'grt-cross-chain-staking',
    layer: 'economics',
    title: 'GRT: Cross-Chain Staking & Delegation',
    description: 'Full cross-chain GRT staking and delegation — participate in protocol economics natively on Ethereum, Base, or Solana without bridging to Arbitrum.',
    detail: "The longer-term vision for CCIP integration. Currently all staking and delegation happens on Arbitrum One — users must bridge GRT first. Cross-chain staking would allow a Base user to delegate directly from Base, with the protocol abstracting the bridge. This requires Phase 1 (GRT bridging) to be stable and battle-tested first. Solana integration is technically complex (non-EVM). Timeline unclear beyond 'contingent on Phase 1 success.'",
    indexerImpact: "Broader delegator base means more total delegated stake and more capacity.",
    delegatorImpact: "Dramatically lowers the UX barrier for new delegators. If you hold GRT on Coinbase/Base and can delegate without touching a bridge, participation rates could increase significantly.",
    quarterStart: 'Q3 2025',
    officialStatus: 'in_progress',
    lodestarStatus: 'uncertain',
    lodestarNote: 'Depends on CCIP Phase 1 (bridging) being stable. No confirmed timeline for full cross-chain delegation.',
    tags: ['GRT', 'Staking', 'Cross-chain'],
  },
];

export const LAYER_LABELS: Record<RoadmapLayer, string> = {
  product: 'Product Layer',
  protocol: 'Protocol Layer',
  economics: 'Economics Layer',
};

export const LAYER_DESCRIPTIONS: Record<RoadmapLayer, string> = {
  product: 'End-user data products and developer tooling built on The Graph Network.',
  protocol: 'Core protocol infrastructure, data service frameworks, and Horizon-native services.',
  economics: 'Token economics, incentive mechanisms, and cross-chain financial infrastructure.',
};

export const OFFICIAL_STATUS_LABEL: Record<OfficialStatus, string> = {
  shipped: 'Shipped',
  in_progress: 'In Progress',
  planned: 'Planned',
  experimental: 'Experimental',
};

export const LODESTAR_STATUS_LABEL: Record<LodestarStatus, string> = {
  on_track: 'On Track',
  delayed: 'Delayed',
  shipped: 'Shipped',
  uncertain: 'Uncertain',
};
