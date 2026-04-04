export type RoadmapLayer = 'product' | 'protocol' | 'economics';
export type OfficialStatus = 'shipped' | 'in_progress' | 'planned' | 'experimental';
export type CommunityStatus = 'on_track' | 'delayed' | 'shipped' | 'uncertain';

export interface RoadmapItem {
  id: string;
  layer: RoadmapLayer;
  title: string;
  description: string;
  quarterStart: string;  // e.g. 'Q4 2025'
  quarterEnd?: string;   // null = single quarter
  officialStatus: OfficialStatus;
  gipId?: string;
  forumUrl?: string;
  tags?: string[];
}

export const ROADMAP_ITEMS: RoadmapItem[] = [
  // ─── PRODUCT LAYER ────────────────────────────────────────────────────────

  {
    id: 'amp-developer-preview',
    layer: 'product',
    title: 'Amp: Developer Preview',
    description: 'Initial developer preview of Amp — The Graph\'s verifiable raw blockchain data service enabling direct access to any on-chain data.',
    quarterStart: 'Q4 2025',
    officialStatus: 'shipped',
    tags: ['Amp'],
  },
  {
    id: 'tycho-private-mvp',
    layer: 'product',
    title: 'Tycho: Private MVP',
    description: 'Private beta of Tycho, a new data service focused on decentralised financial data and DeFi protocol state.',
    quarterStart: 'Q2 2026',
    officialStatus: 'in_progress',
    tags: ['Tycho'],
  },
  {
    id: 'tycho-public-beta',
    layer: 'product',
    title: 'Tycho: Public Beta Launch',
    description: 'Public beta launch of Tycho data service on The Graph Network.',
    quarterStart: 'Q3 2026',
    officialStatus: 'planned',
    tags: ['Tycho'],
  },
  {
    id: 'token-api-billing',
    layer: 'product',
    title: 'Token API: Beta Billing & API Compatibility',
    description: 'Token API billing integration and API compatibility improvements entering beta.',
    quarterStart: 'Q2 2026',
    officialStatus: 'in_progress',
    tags: ['Token API'],
  },
  {
    id: 'substreams-burn-base',
    layer: 'product',
    title: 'Substreams: Burn & Base Implementation',
    description: 'Core billing (burn) mechanism and base implementation for Substreams as a paid data service.',
    quarterStart: 'Q2 2026',
    officialStatus: 'in_progress',
    tags: ['Substreams'],
  },
  {
    id: 'token-api-production',
    layer: 'product',
    title: 'Token API: Production-Grade Latency',
    description: 'Token API reaching production-grade latency and reliability targets.',
    quarterStart: 'Q3 2026',
    officialStatus: 'planned',
    tags: ['Token API'],
  },
  {
    id: 'amp-sql-platform',
    layer: 'product',
    title: 'Amp: SQL Platform',
    description: 'Experimental SQL query interface over Amp\'s verifiable raw blockchain data.',
    quarterStart: 'Q3 2026',
    quarterEnd: 'Q4 2026',
    officialStatus: 'experimental',
    tags: ['Amp'],
  },

  // ─── PROTOCOL LAYER ───────────────────────────────────────────────────────

  {
    id: 'subgraphs-horizon-service',
    layer: 'protocol',
    title: 'Subgraphs: Horizon-Based Subgraph Service',
    description: 'Migration of the Subgraph data service to the Horizon protocol framework (GIP-0057). Testnet and mainnet deployment.',
    quarterStart: 'Q2 2025',
    quarterEnd: 'Q3 2025',
    officialStatus: 'shipped',
    gipId: 'GIP-0057',
    tags: ['Subgraphs', 'Horizon'],
  },
  {
    id: 'amp-horizon-service',
    layer: 'protocol',
    title: 'Amp: Horizon-Based Data Service',
    description: 'Amp data service launched on the Horizon protocol framework, testnet and mainnet.',
    quarterStart: 'Q3 2025',
    quarterEnd: 'Q4 2025',
    officialStatus: 'shipped',
    tags: ['Amp', 'Horizon'],
  },
  {
    id: 'amp-verifiable-data',
    layer: 'protocol',
    title: 'Amp: Verifiable Raw Blockchain Data',
    description: 'Protocol-level verifiability for Amp\'s raw blockchain data service — enabling cryptographic proof of data correctness.',
    quarterStart: 'Q4 2025',
    quarterEnd: 'Q4 2026',
    officialStatus: 'in_progress',
    tags: ['Amp'],
  },
  {
    id: 'substreams-p2p-spec',
    layer: 'protocol',
    title: 'Substreams: Permissioned P2P Data Service Spec',
    description: 'Specification for Substreams as a permissioned peer-to-peer data service on The Graph Network.',
    quarterStart: 'Q2 2026',
    officialStatus: 'in_progress',
    tags: ['Substreams'],
  },
  {
    id: 'tycho-horizon-service',
    layer: 'protocol',
    title: 'Tycho: Horizon-Based Data Service',
    description: 'Experimental deployment of Tycho on the Horizon protocol. Testnet and mainnet.',
    quarterStart: 'Q2 2026',
    officialStatus: 'experimental',
    tags: ['Tycho', 'Horizon'],
  },
  {
    id: 'substreams-p2p-mvp',
    layer: 'protocol',
    title: 'Substreams: P2P Data Service MVP or Provider Selection Oracle',
    description: 'MVP implementation of Substreams as a permissioned P2P data service, or a provider selection oracle as an alternative path.',
    quarterStart: 'Q3 2026',
    officialStatus: 'planned',
    tags: ['Substreams'],
  },
  {
    id: 'substreams-data-integrity',
    layer: 'protocol',
    title: 'Substreams: Data Integrity & Service Availability',
    description: 'Experimental protocol mechanisms to enforce data integrity and service availability for Substreams providers.',
    quarterStart: 'Q3 2026',
    officialStatus: 'experimental',
    tags: ['Substreams'],
  },
  {
    id: 'json-rpc-service',
    layer: 'protocol',
    title: 'JSON-RPC: Experimental Data Service',
    description: 'Experimental JSON-RPC data service on The Graph Network, enabling node RPC as a monetised data service.',
    quarterStart: 'Q3 2026',
    officialStatus: 'experimental',
    tags: ['JSON-RPC'],
  },
  {
    id: 'subgraphs-agentic',
    layer: 'protocol',
    title: 'Subgraphs: Agentic Subgraph Service',
    description: 'Agentic subgraph service with ARG2 & ASA support — enabling AI agents to query subgraphs as a first-class use case.',
    quarterStart: 'Q1 2024',
    quarterEnd: 'Q1 2025',
    officialStatus: 'shipped',
    tags: ['Subgraphs'],
  },
  {
    id: 'subgraphs-amp-powered',
    layer: 'protocol',
    title: 'Subgraphs: Amp-Powered Subgraphs',
    description: 'Subgraphs backed by Amp\'s verifiable raw blockchain data — enabling verifiable subgraph results.',
    quarterStart: 'Q3 2024',
    quarterEnd: 'Q4 2025',
    officialStatus: 'shipped',
    tags: ['Subgraphs', 'Amp'],
  },

  // ─── ECONOMICS LAYER ──────────────────────────────────────────────────────

  {
    id: 'grt-multi-chain',
    layer: 'economics',
    title: 'GRT: Multi-Chain Expansion',
    description: 'GRT token availability on additional chains via Chainlink CCIP cross-chain interoperability protocol.',
    quarterStart: 'Q2 2025',
    officialStatus: 'shipped',
    tags: ['GRT', 'Cross-chain'],
  },
  {
    id: 'subgraphs-seo-token-revenue',
    layer: 'economics',
    title: 'Subgraphs: Subgraph SEO Token & Revenue',
    description: 'Signal-based economic optimisation (SEO) token model for subgraph curation and query fee revenue distribution.',
    quarterStart: 'Q3 2025',
    officialStatus: 'shipped',
    tags: ['Subgraphs', 'Economics'],
  },
  {
    id: 'grt-cross-chain-staking',
    layer: 'economics',
    title: 'GRT: Cross-Chain Liquid Staking',
    description: 'Cross-chain GRT liquid staking, enabling GRT holders on multiple chains to participate in network economics.',
    quarterStart: 'Q3 2025',
    officialStatus: 'shipped',
    tags: ['GRT', 'Staking'],
  },
  {
    id: 'drt-subgraph-service',
    layer: 'economics',
    title: 'DRT: DPh Subgraph Service',
    description: 'Data Request Token (DRT) integration with DPh subgraph service — economic model for data request incentivisation.',
    quarterStart: 'Q3 2025',
    officialStatus: 'shipped',
    tags: ['DRT'],
  },
  {
    id: 'substreams-seo-token',
    layer: 'economics',
    title: 'Substreams: SEO Token & Staking',
    description: 'Substreams SEO token and staking model, extending the economic framework to the Substreams data service.',
    quarterStart: 'Q3 2025',
    quarterEnd: 'Q4 2025',
    officialStatus: 'shipped',
    tags: ['Substreams', 'Economics'],
  },
  {
    id: 'subgraphs-reo-spec',
    layer: 'economics',
    title: 'Subgraphs: Final REO Specification',
    description: 'Final specification and enforcement of the Rewards Eligibility Oracle (REO) for subgraph indexers, including eligibility criteria and reward gating.',
    quarterStart: 'Q1 2026',
    officialStatus: 'in_progress',
    gipId: 'GIP-0079',
    forumUrl: 'https://forum.thegraph.com/t/gip-0079-indexer-rewards-eligibility-oracle/6734',
    tags: ['REO', 'Subgraphs', 'Economics'],
  },
  {
    id: 'subgraphs-chain-integration',
    layer: 'economics',
    title: 'Subgraphs: Network First Chain Integration Process',
    description: 'Formalised process for integrating new chains into The Graph Network via DPh, replacing the current informal process.',
    quarterStart: 'Q2 2026',
    quarterEnd: 'Q3 2026',
    officialStatus: 'planned',
    tags: ['Subgraphs'],
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

export const COMMUNITY_STATUS_LABEL: Record<CommunityStatus, string> = {
  on_track: 'On Track',
  delayed: 'Delayed',
  shipped: 'Shipped',
  uncertain: 'Uncertain',
};
