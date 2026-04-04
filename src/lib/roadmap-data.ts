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
    description: 'Edge & Node\'s blockchain-native SQL database. Transforms raw on-chain data into queryable intelligence via SQL, REST, and GraphQL. Developer preview shipped Q4 2025.',
    detail: "Amp is Edge & Node's flagship enterprise data product. According to their launch blog, it is positioned as a \"blockchain-native database\" with full data lineage — every data point is traceable back to the original chain event. The developer preview launched with a $10,000 bounty programme at ETHGlobal Buenos Aires (confirmed on the official blog). Performance figures cited by Edge & Node in their marketing (5.9× BigQuery, 4M+ events/sec) are their own claims — independently unverified. The SQL Platform and Horizon-based network service aren't on the roadmap until Q4 2026.",
    indexerImpact: "Not yet applicable — Amp is centralised at this stage. Per the official roadmap, the Horizon-Based Amp Data Service (enabling indexers to serve Amp queries and earn fees) isn't due until Q4 2026.",
    delegatorImpact: "No direct impact yet. If Amp moves onto the network in Q4 2026 as planned, enterprise query fee revenue would flow through the protocol.",
    quarterStart: 'Q4 2025',
    officialStatus: 'shipped',
    lodestarStatus: 'shipped',
    links: [
      { label: 'Introducing Amp (Edge & Node)', url: 'https://thegraph.com/blog/introducing-amp/' },
      { label: 'Amp Product Page', url: 'https://thegraph.com/amp/' },
    ],
    tags: ['Amp'],
  },

  {
    id: 'tycho-private-mvp',
    layer: 'product',
    title: 'Tycho: Private MVP',
    description: 'Real-time DeFi liquidity data service by PropellerHeads — unified DEX pool state, block-by-block deltas, and swap simulation. Built on Substreams, currently off-protocol.',
    detail: "Tycho is built by PropellerHeads and runs on Substreams. Per their public documentation and The Graph\'s technical roadmap blog, it provides real-time DEX pool state and block-level delta updates. It is live today on Ethereum, Base, and Unichain (per PropellerHeads\' own docs), but operates off-protocol — paying StreamingFast directly, not through GRT. GraphOps have independently deployed a full Tycho stack (confirmed in their February 2026 forum update). The private MVP / white-glove onboarding milestone is Q2 2026 per the official roadmap. Self-service public beta is targeted Q3 2026.",
    indexerImpact: "Potentially high-value once on-network. GraphOps\' February 2026 forum update confirms they are already running it independently, demonstrating a viable indexer playbook. Early movers will have an advantage when the Horizon service ships.",
    delegatorImpact: "DeFi trading firms (solvers, searchers) are high-frequency consumers. If Tycho scales on-network, it could be a meaningful fee stream — but this is still Q3 2026 at the earliest.",
    quarterStart: 'Q2 2026',
    officialStatus: 'in_progress',
    lodestarStatus: 'on_track',
    lodestarNote: 'Live off-protocol today. GraphOps running full stack per Feb 2026 forum update. On-network Horizon service still Q3 2026.',
    links: [
      { label: 'Lodestar: Intro to Tycho', url: 'https://dev.lodestar-dashboard.com/blog/intro-to-tycho-data-service' },
      { label: 'The Graph Technical Roadmap', url: 'https://thegraph.com/blog/technical-roadmap/' },
      { label: 'GraphOps Feb 2026 Update', url: 'https://forum.thegraph.com/t/graphops-update-february-2026/6855' },
    ],
    tags: ['Tycho'],
  },

  {
    id: 'tycho-public-beta',
    layer: 'product',
    title: 'Tycho: Public Beta Launch',
    description: 'Self-service public beta of Tycho DeFi data service — open access beyond the initial private/white-glove MVP phase.',
    quarterStart: 'Q3 2026',
    officialStatus: 'planned',
    tags: ['Tycho'],
  },

  {
    id: 'token-api-billing',
    layer: 'product',
    title: 'Token API: Beta Billing & API Compatibility',
    description: 'REST/MCP API for token balances, transfers, OHLC pricing, and metadata across multiple chains. In production. MCP-integrated for AI agent access.',
    detail: "The Token API launched in late 2025 (per The Graph\'s official blog) as a replacement for SimpleHash\'s discontinued service. The Graph\'s technical roadmap blog states it reached production across multiple chains by Q1 2026. Per the same roadmap blog, MCP (Model Context Protocol) integration enables Claude, Cursor, and ChatGPT to query it with automatic schema discovery. The x402 payment standard integration (no API keys for agents) is described in The Graph\'s x402/ERC-8004 blog post from February 2026. Semiotic Labs\' sub-millisecond latency work is cited in The Graph\'s roadmap blog — this is their claim, not independently benchmarked.",
    indexerImpact: "Currently operates largely off the decentralised network per public information. Migration path onto network economics not yet detailed publicly.",
    delegatorImpact: "If the Token API migrates fully onto the network, AI agent query volumes at high frequency could be a meaningful fee stream for indexers and by extension delegators.",
    quarterStart: 'Q2 2026',
    officialStatus: 'in_progress',
    lodestarStatus: 'shipped',
    lodestarNote: 'In production. Billing integration done per official roadmap blog. Network economics migration path not yet public.',
    links: [
      { label: 'Token API Launch Blog', url: 'https://thegraph.com/blog/token-api-the-graph/' },
      { label: 'Token API Product Page', url: 'https://thegraph.com/token-api/' },
      { label: 'x402 & ERC-8004 Blog', url: 'https://thegraph.com/blog/understanding-x402-erc8004/' },
    ],
    tags: ['Token API'],
  },

  {
    id: 'token-api-production',
    layer: 'product',
    title: 'Token API: Real-Time Pricing & Chain Expansion',
    description: 'Token API expanding to real-time DEX token pricing with additional chain coverage. Per the official roadmap, Q3 2026.',
    quarterStart: 'Q3 2026',
    officialStatus: 'planned',
    tags: ['Token API'],
  },

  {
    id: 'substreams-burn-base',
    layer: 'product',
    title: 'Substreams: Protocol Billing Integration',
    description: 'On-chain billing layer for Substreams — routing usage fees through GRT protocol economics. Currently the majority of Substreams revenue flows off-chain.',
    detail: "Per the Messari State of The Graph Q4 2025 report, Substreams revenue reached 6.08M GRT in Q4 2025 (4× QoQ growth). However, this revenue currently flows off-chain to StreamingFast/gateway providers and does not go through the on-chain GRT burn or indexer fee mechanism. The billing integration roadmap item refers to changing this. The full trust-minimised on-chain path depends on the Substreams P2P Data Service MVP (Q2 2026) and GraphTally being stable first — both confirmed as Q2 2026 targets in the official roadmap. Whether the Q4 2025 roadmap item for \"Burn & Base Implementation\" has actually shipped is not confirmed in any public update — the StreamingFast January 2026 forum post focuses entirely on performance features, not billing.",
    indexerImpact: "Until Substreams billing is on-chain, the protocol's fastest-growing product (per Messari) isn't benefiting indexers. Once it is, it becomes a direct fee stream.",
    delegatorImpact: "A GRT burn component on Substreams fees would reduce supply. At 6M+ GRT/quarter scale, this is economically meaningful if the on-chain billing actually ships.",
    quarterStart: 'Q2 2026',
    officialStatus: 'in_progress',
    lodestarStatus: 'uncertain',
    lodestarNote: "Revenue growing fast (Messari Q4 2025) but on-chain billing status is not confirmed in any public update. Marking uncertain until StreamingFast confirms.",
    links: [
      { label: 'StreamingFast Jan 2026 Forum Update', url: 'https://forum.thegraph.com/t/streamingfast-update-january-2026/6838' },
      { label: 'GraphTally Blog', url: 'https://thegraph.com/blog/graph-tally-indexer-micropayments/' },
    ],
    tags: ['Substreams'],
  },

  {
    id: 'amp-sql-platform',
    layer: 'product',
    title: 'Amp: SQL Platform',
    description: 'Experimental SQL query interface over Amp\'s verifiable raw blockchain data. Listed as experimental on the official roadmap, Q3–Q4 2026.',
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
    description: 'Migration of the Subgraph data service onto the Horizon framework — unified staking, GraphTally payments, and REO integration. Horizon launched December 2025; final contract upgrades in progress.',
    detail: "The Graph Foundation confirmed Horizon mainnet launched in December 2025 (official blog post). GIPs 0066, 0068, and 0085 — which define the Horizon staking framework, participant roles, and arbitration charter — were approved by the Graph Council (confirmed on the governance forum). GIP-0086 (Rewards Manager & Subgraph Service Upgrade) was filed March 6, 2026 and is still in forum discussion as of that date (publicly visible on forum.thegraph.com). GIP-0086 adds the REO oracle integration hooks but explicitly does not activate reward gating — that requires a separate governance vote after 0086 passes.",
    indexerImpact: "GIP-0086 restructures how rewards are tracked and adds on-chain visibility into POI presentations. Once it passes and reward gating is activated via governance, underperforming indexers will be denied issuance.",
    delegatorImpact: "Indexer quality will become more visible on-chain after GIP-0086. The services your chosen indexers run will be formally secured within the protocol.",
    quarterStart: 'Q2 2025',
    quarterEnd: 'Q1 2026',
    officialStatus: 'in_progress',
    lodestarStatus: 'delayed',
    lodestarNote: "Horizon live Dec 2025 (confirmed). GIP-0086 (final Rewards Manager upgrade) still in forum as of March 2026 — reward gating not yet active.",
    links: [
      { label: 'Horizon Upgrade Live Blog', url: 'https://thegraph.com/blog/horizon-upgrade-live/' },
      { label: 'GIP-0086 Forum Thread', url: 'https://forum.thegraph.com/t/gip-0086-rewards-manager-and-subgraph-service-upgrade/6868' },
    ],
    tags: ['Subgraphs', 'Horizon'],
  },

  {
    id: 'amp-horizon-service',
    layer: 'protocol',
    title: 'Amp: Horizon-Based Data Service',
    description: 'Amp data service on the Horizon protocol framework. Listed as shipped on the official roadmap (Q3–Q4 2025).',
    quarterStart: 'Q3 2025',
    quarterEnd: 'Q4 2025',
    officialStatus: 'shipped',
    lodestarStatus: 'shipped',
    links: [
      { label: 'Horizon Upgrade Live Blog', url: 'https://thegraph.com/blog/horizon-upgrade-live/' },
    ],
    tags: ['Amp', 'Horizon'],
  },

  {
    id: 'subgraphs-agentic',
    layer: 'protocol',
    title: 'Subgraphs: Agentic Service (x402 / MCP / A2A)',
    description: 'Subgraphs queryable by AI agents — x402 micropayments without API keys, MCP for Claude/Cursor/ChatGPT schema discovery, and Agent-to-Agent protocol support.',
    detail: "The Graph Foundation published a blog post in February 2026 formally backing the x402 payment standard and ERC-8004 (canonical APIs for agents), and partnered with Agent0 on ERC-8004 (all confirmed in that blog post). MCP (Model Context Protocol) integration enabling Claude, Cursor, and ChatGPT to query subgraphs is described in The Graph\'s technical roadmap blog. A2A (Agent-to-Agent) protocol support is also listed there. The exact implementation state — what is live vs. in development — isn\'t fully detailed in any public update beyond the February 2026 blog post.",
    indexerImpact: "Autonomous AI agent workloads could drive high-frequency query volume. If x402/MCP adoption grows, well-positioned indexers benefit from increased query fees.",
    delegatorImpact: "More query fee volume from agent workloads improves returns for delegators, proportional to how much their indexers serve these queries.",
    quarterStart: 'Q1 2026',
    quarterEnd: 'Q2 2026',
    officialStatus: 'in_progress',
    lodestarStatus: 'on_track',
    lodestarNote: 'x402 and ERC-8004 formally backed in Feb 2026 blog post. Implementation details not yet public beyond that.',
    links: [
      { label: 'x402 & ERC-8004 Blog (Feb 2026)', url: 'https://thegraph.com/blog/understanding-x402-erc8004/' },
      { label: 'The Graph Technical Roadmap', url: 'https://thegraph.com/blog/technical-roadmap/' },
    ],
    tags: ['Subgraphs', 'AI Agents'],
  },

  {
    id: 'amp-verifiable-data',
    layer: 'protocol',
    title: 'Amp: Verifiable Raw Blockchain Data',
    description: 'Protocol-level cryptographic verifiability for Amp data — data lineage traceable back to the original block. Listed on official roadmap Q4 2025 through Q4 2026.',
    detail: "Per The Graph\'s Amp launch blog, Amp is designed with full data lineage so every data point is traceable to its on-chain source. The \"verifiable\" component spanning to Q4 2026 on the official roadmap refers to the cryptographic proof layer that enables consumers to verify correctness without trusting the provider. The technical mechanism (ZK proofs, attestations, or otherwise) is not publicly specified beyond the launch blog\'s description of data lineage.",
    quarterStart: 'Q4 2025',
    quarterEnd: 'Q4 2026',
    officialStatus: 'in_progress',
    links: [
      { label: 'Introducing Amp', url: 'https://thegraph.com/blog/introducing-amp/' },
    ],
    tags: ['Amp'],
  },

  {
    id: 'substreams-p2p-spec',
    layer: 'protocol',
    title: 'Substreams: P2P Data Service on Horizon',
    description: 'Substreams as a Horizon-native data service — on-chain payments via GraphTally, staked indexers, Provider Selection Oracle. MVP targeted Q2 2026.',
    detail: "The Substreams P2P Data Service brings Substreams fees on-chain. Per GraphOps\' February 2026 forum update (publicly available), they implemented the basic consumer-provider handshake and payment session stream using GraphTally, describing themselves as \"getting closer to a demo-ready MVP.\" The spec defines a consumer-provider handshake, payment session streaming, and RAV (Receipt Aggregation Voucher) loop — terms confirmed in The Graph\'s GraphTally blog post. Q2 2026 is the official MVP target; Q3 2026 is the Provider Selection Oracle and permissionless launch target, both per the official roadmap.",
    indexerImpact: "Brings Substreams revenue onto the protocol. Indexers with Substreams infrastructure (high-CPU, persistent state) would earn from this fee stream once it's on-chain.",
    delegatorImpact: "Once Substreams fees flow through the protocol, delegators to Substreams-capable indexers benefit proportionally.",
    quarterStart: 'Q2 2026',
    officialStatus: 'in_progress',
    lodestarStatus: 'on_track',
    lodestarNote: 'GraphOps confirmed basic handshake and payment session stream implemented in Feb 2026 forum update. Demo-ready MVP close.',
    links: [
      { label: 'GraphOps Feb 2026 Forum Update', url: 'https://forum.thegraph.com/t/graphops-update-february-2026/6855' },
      { label: 'GraphTally Blog', url: 'https://thegraph.com/blog/graph-tally-indexer-micropayments/' },
    ],
    tags: ['Substreams', 'Horizon'],
  },

  {
    id: 'tycho-horizon-service',
    layer: 'protocol',
    title: 'Tycho: Horizon-Based Data Service',
    description: 'Tycho DeFi liquidity service on The Graph Network — indexers serve DEX data, earn fees via GraphTally. Listed as experimental on the official roadmap, Q2 2026.',
    detail: "Per the official roadmap, the Tycho Horizon-Based Data Service is experimental and targeted Q2 2026 for testnet. It depends on the Substreams P2P Data Service MVP (Q2 2026) and GraphTally being stable first — both per the same roadmap. GraphOps have independently deployed a full Tycho stack (per their Feb 2026 forum update), making them the most likely early provider once the protocol service is live.",
    indexerImpact: "Only a small set of indexers currently have the technical capacity for Tycho. GraphOps have the head start.",
    delegatorImpact: "DeFi trading firms are high-frequency, price-insensitive consumers if demand materialises. Not yet validated at protocol scale.",
    quarterStart: 'Q2 2026',
    officialStatus: 'experimental',
    links: [
      { label: 'The Graph Technical Roadmap', url: 'https://thegraph.com/blog/technical-roadmap/' },
      { label: 'GraphOps Feb 2026 Update', url: 'https://forum.thegraph.com/t/graphops-update-february-2026/6855' },
    ],
    tags: ['Tycho', 'Horizon'],
  },

  {
    id: 'substreams-p2p-mvp',
    layer: 'protocol',
    title: 'Substreams: Provider Selection Oracle',
    description: 'Algorithmic routing of Substreams consumers to providers based on performance metrics. Listed on the official roadmap as Q3 2026.',
    quarterStart: 'Q3 2026',
    officialStatus: 'planned',
    tags: ['Substreams'],
  },

  {
    id: 'substreams-data-integrity',
    layer: 'protocol',
    title: 'Substreams: Data Integrity & Service Availability',
    description: 'Protocol mechanisms to verify Substreams provider data correctness and service uptime. Listed as experimental on the official roadmap, Q3–Q4 2026.',
    detail: "Listed on the official roadmap as an experimental Q3–Q4 2026 item. No public specification or GIP exists as of April 2026. The roadmap description refers to data integrity verification and service availability enforcement — the specific mechanism (probabilistic challenges, attestations, or otherwise) has not been publicly detailed. A Substreams REO (analogous to the Subgraph REO) gating issuance for Substreams providers is also listed for Q4 2026, per the roadmap.",
    indexerImpact: "Once verification ships, misbehaving Substreams providers face slashing risk. Creates a meaningful quality signal for well-run providers.",
    quarterStart: 'Q3 2026',
    quarterEnd: 'Q4 2026',
    officialStatus: 'experimental',
    tags: ['Substreams'],
  },

  {
    id: 'json-rpc-service',
    layer: 'protocol',
    title: 'JSON-RPC: Experimental Data Service',
    description: 'Proposed service bringing Ethereum JSON-RPC onto The Graph Network. The official roadmap explicitly notes "multiple implementation paths being validated." Early research.',
    detail: "Listed on the official roadmap as Q3 2026 experimental. The roadmap explicitly states \"multiple implementation paths being validated\" — meaning no final specification exists. No GIPs have been filed publicly as of April 2026. JSON-RPC is one of the highest-volume blockchain data services (Alchemy, Infura, Quicknode dominate it), and many indexers already run node infrastructure. The economic model for on-chain RPC payments is unresolved. This is the least-defined item on the protocol roadmap.",
    indexerImpact: "If it ships, indexers already running nodes could earn protocol fees on existing infrastructure. But this is genuinely speculative — the roadmap itself flags multiple open paths.",
    delegatorImpact: "RPC is a large market. No meaningful impact until a specification is finalised and a GIP is filed.",
    quarterStart: 'Q3 2026',
    officialStatus: 'experimental',
    lodestarStatus: 'uncertain',
    lodestarNote: "Research only. The official roadmap itself flags multiple open implementation paths. No spec, no GIP.",
    tags: ['JSON-RPC'],
  },

  {
    id: 'subgraphs-amp-powered',
    layer: 'protocol',
    title: 'Subgraphs: Amp-Powered Verifiable Subgraphs',
    description: 'Subgraphs backed by Amp\'s verifiable data pipeline — subgraph results with cryptographic lineage from Amp. Listed on the official roadmap as shipped (Q3 2024–Q4 2025).',
    detail: "Listed on the official roadmap as shipped across Q3 2024–Q4 2025. The concept is subgraphs using Amp's verifiable raw blockchain data as their source — inheriting Amp's data lineage. No detailed public documentation or case study of a production Amp-powered subgraph has been found. Marking as shipped per the official roadmap designation, but the scope and maturity of what shipped is unclear.",
    quarterStart: 'Q3 2024',
    quarterEnd: 'Q4 2025',
    officialStatus: 'shipped',
    lodestarStatus: 'uncertain',
    lodestarNote: "Listed as shipped on official roadmap. No detailed public documentation found on what exactly shipped or how to build an Amp-powered subgraph today.",
    links: [
      { label: 'The Graph Roadmap', url: 'https://thegraph.com/roadmap/' },
    ],
    tags: ['Subgraphs', 'Amp'],
  },

  // ─── ECONOMICS LAYER ──────────────────────────────────────────────────────

  {
    id: 'grt-multi-chain',
    layer: 'economics',
    title: 'GRT: Multi-Chain Expansion via Chainlink CCIP',
    description: 'GRT bridged to additional chains via Chainlink CCIP. Announced formally; cross-chain delegation and staking are described as contingent on Phase 1 bridging completing.',
    detail: "The Graph Foundation published a blog post announcing adoption of Chainlink CCIP for GRT cross-chain transfers. GRT is already on Arbitrum One and Base (pre-CCIP, via existing bridges). The CCIP announcement described cross-chain staking and delegation as \"prospective, depending on successful rollout of initial bridging\" — meaning these are not committed yet. Solana integration was mentioned as a 2026 target in the same announcement. Cross-chain delegation (the feature that would meaningfully change delegator UX) has no confirmed timeline beyond \"contingent on Phase 1.\"",
    indexerImpact: "Cross-chain query fee payments would expand the addressable payer market. No confirmed timeline.",
    delegatorImpact: "Native delegation from Base or Ethereum mainnet without bridging would lower the UX barrier significantly. Still contingent on Phase 1 bridging — no confirmed timeline.",
    quarterStart: 'Q2 2025',
    officialStatus: 'in_progress',
    lodestarStatus: 'uncertain',
    lodestarNote: "CCIP adoption announced (blog confirmed). Cross-chain delegation explicitly contingent on Phase 1 — no confirmed timeline for the meaningful part.",
    links: [
      { label: 'GRT Cross-Chain via CCIP Blog', url: 'https://thegraph.com/blog/grt-cross-chain-access-via-chainlink-ccip/' },
    ],
    tags: ['GRT', 'Cross-chain'],
  },

  {
    id: 'grt-liquid-staking',
    layer: 'economics',
    title: 'GRT: Liquid Staking & DeFi Integration',
    description: 'Native liquid staking for GRT — a receipt token for delegated GRT usable in DeFi. Listed on the official roadmap with testnet Q2 2026 and mainnet Q4 2026.',
    detail: "Listed on The Graph\'s official technical roadmap blog with testnet targeted Q2 2026 and mainnet Q4 2026. The roadmap mentions DeFi integration (a Morpho partnership was referenced in the roadmap context). The core value proposition is dissolving the 28-day undelegation lock — delegators would receive a liquid receipt token usable as collateral. No GIP has been filed publicly as of April 2026, and no further implementation details are publicly available beyond the roadmap listing.",
    indexerImpact: "Higher total delegated stake from reduced lock-up friction means more capacity across the protocol.",
    delegatorImpact: "If it ships as described, this would be the single most impactful delegator feature in the roadmap — eliminating the 28-day unbonding period as a capital cost.",
    quarterStart: 'Q2 2026',
    quarterEnd: 'Q4 2026',
    officialStatus: 'planned',
    lodestarStatus: 'on_track',
    lodestarNote: "On roadmap with Q2 testnet / Q4 mainnet targets. No GIP filed yet. Watching for first public spec.",
    links: [
      { label: 'The Graph Technical Roadmap', url: 'https://thegraph.com/blog/technical-roadmap/' },
    ],
    tags: ['GRT', 'Staking', 'DeFi'],
  },

  {
    id: 'onchain-indexing-agreements',
    layer: 'economics',
    title: 'On-Chain Indexing Agreements (GIP-0087 / GIP-0088)',
    description: 'Direct payment contracts between payers (dApps, ecosystems) and indexers — payers create offers, indexers accept on-chain, payment released on POI. Filed March 2026.',
    detail: "GIP-0087 and GIP-0088 were filed March 6, 2026 (publicly visible on forum.thegraph.com). GIP-0087 defines on-chain indexing agreements: payers create offers with terms; indexers accept via smart contract; payment occurs upon POI presentation. GIP-0088 defines the issuance allocation mechanism alongside it — directing a portion of protocol issuance to fund these agreements. Both are in forum discussion as of April 2026. No vote has been held yet.",
    indexerImpact: "Transforms indexing economics — active market instead of passive issuance collection. High-quality indexers can negotiate commercial agreements with chains and dApps directly.",
    delegatorImpact: "Indexers with strong agreement portfolios will outperform pure issuance chasers. Indexer selection becomes more impactful for delegators as performance spreads widen.",
    quarterStart: 'Q2 2026',
    officialStatus: 'in_progress',
    lodestarStatus: 'on_track',
    lodestarNote: "GIPs filed March 2026, in forum discussion. No vote yet. The most consequential new economic primitive in Horizon for indexers.",
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
    description: 'Enforcement of the Rewards Eligibility Oracle — indexers failing quality checks are denied protocol issuance. GIP-0079 defines the oracle; GIP-0086 adds the Rewards Manager hooks.',
    detail: "GIP-0079 (filed October 2025, publicly on forum.thegraph.com) defines the REO: off-chain oracle nodes evaluate indexer performance over 28-day windows; an on-chain contract maintains an eligibility registry with 14-day renewal windows. GIP-0086 (filed March 6, 2026) adds the Rewards Manager integration point — POIPresented event logging and the oracle connection hook. Critically, GIP-0086 explicitly states it does NOT activate reward gating automatically; that requires a separate governance vote after 0086 passes. GIP-0086 was still in forum discussion as of March 2026.",
    indexerImpact: "Potentially the most consequential near-term change for indexers. Once reward gating is activated, indexers failing quality thresholds lose issuance. Passive issuance collection on low-quality infra ends.",
    delegatorImpact: "Delegating to an REO-ineligible indexer means zero issuance on that delegation during the exclusion period. Check REO status on every indexer page on Lodestar — it shows oracle-sourced eligibility in real time.",
    quarterStart: 'Q1 2026',
    officialStatus: 'in_progress',
    lodestarStatus: 'delayed',
    lodestarNote: "GIP-0086 (Rewards Manager hooks) still in forum discussion as of March 2026. Reward gating activation requires a separate governance vote after 0086 passes. Q1 target missed.",
    gipId: 'GIP-0079',
    links: [
      { label: 'GIP-0079 Forum Thread', url: 'https://forum.thegraph.com/t/gip-0079-indexer-rewards-eligibility-oracle/6734' },
      { label: 'GIP-0086 Forum Thread', url: 'https://forum.thegraph.com/t/gip-0086-rewards-manager-and-subgraph-service-upgrade/6868' },
      { label: 'REO Contract (GitHub)', url: 'https://github.com/graphprotocol/rewards-eligibility-oracle' },
    ],
    tags: ['REO', 'Economics'],
  },

  {
    id: 'substreams-reo',
    layer: 'economics',
    title: 'Substreams: Rewards Eligibility Oracle',
    description: 'REO mechanism extended to Substreams providers — quality metrics gate protocol issuance for Substreams indexers. Listed on official roadmap Q2–Q4 2026.',
    detail: "Per the official roadmap, a Substreams REO (analogous to the Subgraph REO / GIP-0079) is planned with testnet Q2 2026 and mainnet Q4 2026. No GIP has been filed publicly for this as of April 2026. The mechanism would require Substreams providers to meet quality thresholds (uptime, latency, data correctness) to earn protocol issuance — the same model as the Subgraph REO.",
    indexerImpact: "Substreams indexers who invest in reliable infrastructure will earn; those running marginal setups will be excluded from issuance. No GIP yet, so details are not fixed.",
    delegatorImpact: "Once live, delegators to Substreams-focused indexers should track their REO eligibility the same way they track subgraph REO status today.",
    quarterStart: 'Q2 2026',
    quarterEnd: 'Q4 2026',
    officialStatus: 'planned',
    tags: ['Substreams', 'REO', 'Economics'],
  },

  {
    id: 'network-first-chain-integration',
    layer: 'economics',
    title: 'Network-First Chain Integration Process',
    description: 'Updated chain onboarding requiring demonstrated query demand before protocol-funded rewards. Chains without active usage lose issuance. GIP-0087 DIPs integration Q2–Q3 2026.',
    detail: "The Graph Foundation published an updated Chain Integration Process (CIP) blog post describing the shift from a bootstrapping model (any compatible chain gets rewards) to a demand-proven model (chains must show active subgraphs and sustained query volume). The update was presented as already in effect (no specific effective date in the blog post). The GIP-0087 DIPs mechanism is the complementary tool: chains/ecosystems that want indexing coverage can now directly pay for it via on-chain agreements rather than relying solely on protocol issuance. The formal integration of DIPs into chain onboarding is Q2–Q3 2026 per the roadmap.",
    indexerImpact: "Indexers staking on low-usage chains should audit their allocations. 'Orphan' chains still work technically but earn no issuance. DIPs (GIP-0087) creates a direct payment path for chains that want coverage.",
    delegatorImpact: "Indexers earning rewards on low-usage chains will see those rewards cut. Delegators to such indexers face reduced returns until those indexers reallocate.",
    quarterStart: 'Q2 2026',
    quarterEnd: 'Q3 2026',
    officialStatus: 'in_progress',
    lodestarStatus: 'on_track',
    lodestarNote: "Updated CIP already live per official blog. DIPs (GIP-0087) integration into chain onboarding is Q2–Q3 2026.",
    links: [
      { label: 'Updated Chain Integration Blog', url: 'https://thegraph.com/blog/cip-update/' },
      { label: 'GIP-0087 Forum Thread', url: 'https://forum.thegraph.com/t/on-chain-indexing-agreements-and-issuance-allocation-gip-0087-gip-0088/6869' },
    ],
    tags: ['Chain Integration', 'Economics'],
  },

  {
    id: 'grt-cross-chain-staking',
    layer: 'economics',
    title: 'GRT: Cross-Chain Staking & Delegation',
    description: 'Full cross-chain staking and delegation — participate in protocol economics natively on multiple chains without bridging to Arbitrum. Contingent on CCIP Phase 1.',
    detail: "Per The Graph Foundation\'s CCIP announcement blog, cross-chain staking and delegation are described as \"prospective, depending on successful rollout of initial bridging\" — meaning no committed timeline beyond the CCIP Phase 1 dependency. This is a longer-horizon item beyond the current roadmap. Not listed with a specific quarter target on the official 2026 roadmap, which ends Q4 2026.",
    indexerImpact: "Broader delegator base means more total delegated stake and more capacity. No committed timeline.",
    delegatorImpact: "If you hold GRT on Base or Ethereum mainnet and can delegate without bridging, participation UX improves significantly. No confirmed date.",
    quarterStart: 'Q3 2025',
    officialStatus: 'planned',
    lodestarStatus: 'uncertain',
    lodestarNote: "Explicitly contingent on CCIP Phase 1 per official announcement. No committed timeline.",
    links: [
      { label: 'GRT Cross-Chain via CCIP Blog', url: 'https://thegraph.com/blog/grt-cross-chain-access-via-chainlink-ccip/' },
    ],
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
