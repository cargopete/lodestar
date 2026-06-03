/**
 * Horizon Data Services catalogue — curated editorial dataset.
 *
 * This is research data, not live chain data. Provider counts are point-in-time
 * snapshots and contract addresses are sourced from repo configs / forum posts;
 * fields flagged `unverified` should be confirmed on a block explorer before
 * being presented as definitive. See `lastReviewed` for provenance.
 *
 * Maturity is expressed via `tier` (1 = production … 4 = local demo). The single
 * most decision-relevant field is `providerStatus` — surface it prominently.
 */

export const DATA_SERVICES_LAST_REVIEWED = '2026-05-31';

/** Whether a real, paid-query-serving provider set exists. The headline signal. */
export type ProviderStatus = 'active' | 'single-self-run' | 'none';

export type ServiceTier = 1 | 2 | 3 | 4;

export type ChainNetwork = 'arbitrum-one' | 'arbitrum-sepolia' | 'local-anvil';

export interface TierMeta {
  tier: ServiceTier;
  label: string;
  blurb: string;
}

export const TIERS: TierMeta[] = [
  {
    tier: 1,
    label: 'Production',
    blurb: 'Live on Arbitrum One and in active paid use.',
  },
  {
    tier: 2,
    label: 'Mainnet-deployed, unexercised',
    blurb: 'Contract live on Arbitrum One, but no completed paid-query loop yet.',
  },
  {
    tier: 3,
    label: 'Testnet / in development',
    blurb: 'Working code on a testnet or local devenv; mainnet not yet targeted.',
  },
  {
    tier: 4,
    label: 'Local reference / demo',
    blurb: 'Pedagogical scaffolds — exercise the payment lifecycle on a local chain.',
  },
];

export interface ServiceContract {
  label: string;
  address: string;
  network: ChainNetwork;
  /** Address could not be independently re-verified on a block explorer. */
  unverified?: boolean;
}

export interface ServiceLink {
  label: string;
  url: string;
}

export interface ServiceChain {
  /** Chain whose contracts hold provisions / settle payments. */
  payment: ChainNetwork;
  /** Human label for the payment chain. */
  paymentLabel: string;
  /** Chain whose data is served, when it differs from the payment chain. */
  dataLabel?: string;
  /** True when the payment contracts live on a production mainnet. */
  isMainnet: boolean;
}

export interface DataService {
  slug: string;
  name: string;
  /** GRC proposal number, where one exists. */
  grc?: string;
  /** Org / author that built it. */
  builtBy: string;
  /** Built by Lodestar (lodestar-team / cargopete). */
  homeTeam: boolean;
  /** One-line summary for the card. */
  tagline: string;
  /** Fuller prose for the drawer. */
  description: string;
  tier: ServiceTier;
  statusLabel: string;
  statusVariant: 'success' | 'warning' | 'default' | 'accent';
  stage: string;
  providerStatus: ProviderStatus;
  /** Caveat / detail behind the provider flag. */
  providerNote: string;
  chain: ServiceChain;
  /** Primary languages / runtimes. */
  stack: string[];
  links: ServiceLink[];
  contracts?: ServiceContract[];
  minProvision?: string;
  /** Steps to run a provider. */
  becomeProvider?: string[];
  /** Steps to consume / query. */
  consume?: string[];
  fees?: string;
  notable?: string;
}

export const DATA_SERVICES: DataService[] = [
  {
    slug: 'subgraph-service',
    name: 'Subgraph Service',
    grc: 'GIP-0068',
    builtBy: 'graphprotocol',
    homeTeam: false,
    tagline: 'The first and only widely-used data service — subgraph indexing and GraphQL query-serving.',
    description:
      'The production implementation of subgraph indexing on Horizon. Indexers index subgraph deployments and serve GraphQL queries; consumers query via The Graph gateway. The only data service with real slashing (allocation-based POI dispute proofs).',
    tier: 1,
    statusLabel: 'Live · Production',
    statusVariant: 'success',
    stage: 'Production',
    providerStatus: 'active',
    providerNote:
      '99 Indexers held allocated stake and 65 were actively serving queries as of end-Q3 2025 (Messari State of The Graph Q3 2025, point-in-time).',
    chain: { payment: 'arbitrum-one', paymentLabel: 'Arbitrum One', isMainnet: true },
    stack: ['Solidity', 'Rust', 'TypeScript'],
    links: [
      { label: 'Repo', url: 'https://github.com/graphprotocol/contracts' },
      { label: 'Docs', url: 'https://thegraph.com/docs/en/graph-horizon/overview/' },
      { label: 'Indexing docs', url: 'https://thegraph.com/docs/en/indexing/overview/' },
    ],
    contracts: [
      {
        label: 'SubgraphService (proxy)',
        address: '0xb2Bb92d0DE618878E438b55D5846cfecD9301105',
        network: 'arbitrum-one',
        unverified: true,
      },
      {
        label: 'GraphTallyCollector',
        address: '0x8f69F5C07477Ac46FBc491B1E6D91E2bb0111A9e',
        network: 'arbitrum-one',
      },
    ],
    minProvision: '100,000 GRT',
    becomeProvider: [
      'Stake ≥100,000 GRT in the core staking contract.',
      'Provision stake to the SubgraphService via HorizonStaking.provision().',
      'Register directly with the SubgraphService (no separate ServiceRegistry).',
      'Open allocations against subgraph deployments.',
      'Submit POIs periodically — stale POIs (>28d maxPOIStaleness) can be force-closed by anyone. Run graph-node, indexer-service-rs, indexer-tap-agent, indexer-agent.',
    ],
    consume: [
      'Create an API key in Subgraph Studio.',
      'Send GraphQL to the gateway: https://gateway-arbitrum.network.thegraph.com/api/[api-key]/subgraphs/id/<ID>.',
      '100K free queries/month, then $4 per 100K. Gateway pays indexers via GraphTally (TAP v2) receipts.',
    ],
    fees: 'Protocol tax + data service cut; stake-to-fees ratio applies on collection.',
    notable:
      'Only data service with real slashing (POI dispute proofs). Subgraph indexing predates Horizon (Sunrise migration); on Horizon it has been live ~6 months as of May 2026.',
  },
  {
    slug: 'dispatch',
    name: 'Dispatch',
    grc: 'GRC-005',
    builtBy: 'cargopete',
    homeTeam: true,
    tagline: 'Decentralized JSON-RPC / dRPC data service — stake, register a chain, get paid per request.',
    description:
      'A decentralized JSON-RPC data service. Indexers stake GRT, register to serve specific chains, and get paid per request via GraphTally. The canonical reference for Lodestar\'s "How to Build a Horizon Data Service" guide.',
    tier: 2,
    statusLabel: 'Live · unexercised',
    statusVariant: 'warning',
    stage: 'Production-ready / deployed',
    providerStatus: 'none',
    providerNote:
      'Contract live on Arbitrum One, but no active providers. collect() reaches chain yet has never settled GRT — no consumer has funded escrow. No completed paid-query loop on mainnet.',
    chain: { payment: 'arbitrum-one', paymentLabel: 'Arbitrum One', dataLabel: '10 chains supported', isMainnet: true },
    stack: ['TypeScript', 'Rust', 'Solidity'],
    links: [
      { label: 'Repo', url: 'https://github.com/cargopete/dispatch' },
      { label: 'GRC-005', url: 'https://forum.thegraph.com/t/grc-005-dispatch-an-experimental-json-rpc-data-service-on-horizon/6913' },
    ],
    contracts: [
      {
        label: 'RPCDataService',
        address: '0x7101d5c1a5c89c3647f5118da118e56c023ba0b9',
        network: 'arbitrum-one',
      },
    ],
    minProvision: '555 GRT',
    becomeProvider: [
      'Stake ≥555 GRT, provision with ≥14-day thawing.',
      'Run dispatch-service pointing at an Ethereum node.',
      'Register via the indexer-agent npm package or directly (register → startService per (chainId, tier)).',
    ],
    consume: [
      'Trustless consumer-sdk (npm): discovers providers via subgraph, signs TAP receipts per request.',
      'Or via dispatch-gateway (QoS-scored selection, quorum).',
      'Endpoint: POST /rpc/{chain_id} with a signed TAP-Receipt header.',
    ],
    fees: 'Data service cut 2% (1% burn + 1% retained).',
    notable:
      'Three verification tiers (Tier 1 Merkle/EIP-1186 fraud-proof slashing implemented, Tier 2 quorum, Tier 3 reputation). Serves Ethereum, Arbitrum, Optimism, Base, Polygon, BNB, Avalanche, zkSync Era, Linea, Scroll.',
  },
  {
    slug: 'seahorn',
    name: 'Seahorn',
    grc: 'GRC-008',
    builtBy: 'lodestar-team',
    homeTeam: true,
    tagline: 'A Solana structured-data service — the "missing third lane" alongside Subgraphs and Substreams.',
    description:
      'Indexes Solana program activity (Pump.fun, Raydium CLMM, Jupiter v6) into typed, fork-correct, queryable entities served over a PostgREST REST API, gating access via TAP v2 micropayments.',
    tier: 2,
    statusLabel: 'Live contract · pipeline TODO',
    statusVariant: 'warning',
    stage: 'Deployed/proven contract; off-chain pipeline not running end-to-end',
    providerStatus: 'none',
    providerNote:
      'Lodestar is registered on-chain as a provider, but the live Yellowstone→Postgres→PostgREST pipeline and the first paid query on mainnet are both TODO.',
    chain: { payment: 'arbitrum-one', paymentLabel: 'Arbitrum One', dataLabel: 'Solana mainnet data', isMainnet: true },
    stack: ['Rust', 'Solidity'],
    links: [
      { label: 'Repo', url: 'https://github.com/lodestar-team/seahorn' },
      { label: 'GRC-008', url: 'https://forum.thegraph.com/t/grc-008-seahorn-a-solana-structured-data-service-on-horizon/6950' },
    ],
    contracts: [
      {
        label: 'SolanaDataService (proxy)',
        address: '0xdDE3F913cb6D1332Bc018Eb63647020a87dD7B37',
        network: 'arbitrum-one',
      },
    ],
    minProvision: '555 GRT',
    becomeProvider: [
      'HorizonStaking.provision(addr, 0xdDE3F913…, 555e18, maxVerifierCut, thawingPeriod).',
      'SolanaDataService.register(addr, abi.encode(endpoint, geoHash, paymentsDestination)).',
      'Owner adds programs to allowlist; startService per program.',
      'Run the stack: Yellowstone → seahorn → Postgres → PostgREST → seahorn-gateway.',
    ],
    consume: [
      'PostgREST REST queries, e.g. GET /buys?commitment_status=eq.FINAL&order=slot.desc&limit=100.',
      'Each request carries a signed TAP-Receipt header.',
    ],
    fees: '1% burn + 1% data service cut per collect().',
    notable:
      'Experimental, community-led — explicitly not endorsed by Graph Foundation or Edge & Node. Axum 0.8 gateway, UUPS proxy, 37 contract tests.',
  },
  {
    slug: 'substreams-data-service',
    name: 'Substreams Data Service',
    builtBy: 'graphprotocol',
    homeTeam: false,
    tagline: 'Payment infrastructure for Substreams — the "second data service being built on the network".',
    description:
      'A Go implementation of the payment infrastructure for the Substreams Data Service. Uses a sidecar/session model (persistent bidirectional gRPC payment session) rather than per-HTTP-request receipts.',
    tier: 3,
    statusLabel: 'In dev · MVP',
    statusVariant: 'default',
    stage: 'MVP / pre-launch',
    providerStatus: 'none',
    providerNote: 'None on mainnet — development stage. Core payment loop works end-to-end in a local Anvil devenv.',
    chain: { payment: 'arbitrum-one', paymentLabel: 'Arbitrum One (target)', dataLabel: 'Anvil devenv today', isMainnet: false },
    stack: ['Go', 'Solidity'],
    links: [
      { label: 'Repo', url: 'https://github.com/graphprotocol/substreams-data-service' },
    ],
    becomeProvider: [
      'Run the Provider Gateway (sds provider gateway) alongside substreams-tier1.',
      'Provision the data service (minimum can be 0 in devenv); register the service provider.',
      'Firehose provider plugins (sds:// URI scheme) feed authoritative usage metering.',
    ],
    consume: [
      'Run the Consumer Sidecar (sds consumer sidecar) alongside a Substreams client.',
      'Point the standard substreams CLI at the sidecar ingress (e.g. localhost:9002).',
      'The sidecar handles payment session init and EIP-712 RAV signing in request headers.',
    ],
    notable:
      'Components: Consumer Sidecar, Provider Gateway, Horizon package (EIP-712 RAV/Receipt), Oracle-backed provider discovery. Go 1.25+, PostgreSQL 18, Redis. Owned by the graphprotocol org.',
  },
  {
    slug: 'sdsce',
    name: 'Substreams Data Service — Community Edition (SDSCE)',
    builtBy: 'lodestar-team',
    homeTeam: true,
    tagline: 'A community edition of the Substreams Data Service — live on Arbitrum One, with a fixed 1% burn.',
    description:
      'A community-maintained payment layer for Substreams on Horizon: a consumer sidecar signs EIP-712 RAVs over a persistent payment session, a provider gateway meters usage authoritatively from the Firehose plugin path, and an on-chain SubstreamsDataService settles via GraphTally. Forked from the graphprotocol MVP and hardened to a live, upgradeable mainnet contract.',
    tier: 3,
    statusLabel: 'Live contract · needs providers',
    statusVariant: 'warning',
    stage: 'Deployed on Arbitrum One; no hosted provider gateway yet',
    providerStatus: 'none',
    providerNote:
      'Contract live on Arbitrum One — proven end-to-end on a mainnet fork (provision → register → collect → burn) plus a full streaming → metered-RAV → collect run. No provider gateway is hosted yet, so no completed paid stream on mainnet. Unaudited (internal review only); owner is currently an EOA.',
    chain: { payment: 'arbitrum-one', paymentLabel: 'Arbitrum One', dataLabel: 'Substreams (firecore)', isMainnet: true },
    stack: ['Go', 'Solidity'],
    links: [
      { label: 'Repo', url: 'https://github.com/lodestar-team/SDSCE' },
      { label: 'Announcement', url: 'https://www.lodestar-dashboard.com/blog/substreams-data-service-community-edition' },
      { label: 'Deployment runbook', url: 'https://github.com/lodestar-team/SDSCE/blob/main/docs/arb-one-deployment-runbook.md' },
    ],
    contracts: [
      {
        label: 'SubstreamsDataService (proxy)',
        address: '0x1c3e9cca124ad19b9ed3c202d2e6cd106944640c',
        network: 'arbitrum-one',
      },
      {
        label: 'GraphTallyCollector',
        address: '0x8f69F5C07477Ac46FBc491B1E6D91E2bb0111A9e',
        network: 'arbitrum-one',
      },
    ],
    minProvision: '0 GRT (soft launch)',
    becomeProvider: [
      'HorizonStaking: stake, then provision(addr, 0x1c3e9cca…, tokens, maxVerifierCut, thawingPeriod) toward the SubstreamsDataService proxy.',
      'SubstreamsDataService.register(addr, abi.encode(paymentsDestination)).',
      'Run the stack: firecore (Substreams data plane, sds:// plugins) + sds provider gateway + Postgres.',
      'Run sds provider operator collect-daemon to auto-collect RAVs (the 1% cut is burned).',
    ],
    consume: [
      'Fund escrow (sds consumer funding deposit) and authorize a signer (sds consumer signer authorize).',
      'Run sds consumer sidecar at the provider endpoint; point substreams run … -e localhost:9002 --plaintext at it.',
      'EIP-712 RAVs are signed in request headers over a persistent bidirectional payment session.',
    ],
    fees: 'Fixed 1% data-service cut, burned (0% retained by the deployer).',
    notable:
      'Experimental, community-led — explicitly not affiliated with the Graph Foundation or Edge & Node. UUPS-upgradeable (Ownable2Step), ERC1967 proxy. Distinct from the official Substreams Data Service. Unaudited; not yet usable end-to-end (no live provider).',
  },
  {
    slug: 'mainline-firehose',
    name: 'Mainline (Firehose)',
    grc: 'GRC-006',
    builtBy: 'PaulieB14 · GRC by cargopete',
    homeTeam: false,
    tagline: 'A decentralized Firehose data service — raw, fork-aware, cursor-resumable block streams over gRPC.',
    description:
      'Reference implementation for GRC-006 "Mainline". Positioned as the decentralized substrate beneath Substreams / Subgraphs / Tycho / Token API / Dispatch. Wraps streamingfast/firehose-core unchanged.',
    tier: 3,
    statusLabel: 'Testnet · Phase 0',
    statusVariant: 'default',
    stage: 'Reference impl / Phase 0 deployment',
    providerStatus: 'none',
    providerNote: 'None — deploy/operator rollout pending. 8/8 on-chain verification checks passing on testnet; 99 workspace tests pass.',
    chain: { payment: 'arbitrum-sepolia', paymentLabel: 'Arbitrum Sepolia', dataLabel: 'Ethereum mainnet blocks', isMainnet: false },
    stack: ['Solidity', 'Rust', 'TypeScript'],
    links: [
      { label: 'Repo', url: 'https://github.com/PaulieB14/firehose-data-service' },
      { label: 'GRC-006', url: 'https://forum.thegraph.com/t/grc-006-mainline-a-firehose-data-service-on-horizon/6920' },
    ],
    contracts: [
      {
        label: 'FirehoseDataService',
        address: '0xD9242fa6Eed1aBFD649C7ee868B1eD37DAb98c77',
        network: 'arbitrum-sepolia',
      },
    ],
    becomeProvider: [
      'Stake GRT, provision to FirehoseDataService, register chains served.',
      'Get paid per streamed gigabyte and per Fetch request via GraphTally.',
      'Operational rollout / one-operator step still pending per the Phase-0 runbook.',
    ],
    consume: [
      'gRPC consumer using the mainline-sdk (Rust or TypeScript).',
      'TAP receipt rides in the x-tap-receipt gRPC metadata header (118 bytes).',
      'MainlineAttestation (201 bytes) verifies responses.',
    ],
    notable:
      'Reuses HorizonStaking, GraphTallyCollector, PaymentsEscrow unchanged. Intended to be transferred to graphprotocol/ when ready. GPL-2.0-or-later.',
  },
  {
    slug: 'compass',
    name: 'Compass',
    grc: 'GRC-007',
    builtBy: 'lodestar-team',
    homeTeam: true,
    tagline: 'A decentralized Subgraph-MCP gateway — every subgraph becomes a pay-per-call MCP tool for AI agents.',
    description:
      'Turns every subgraph an indexer serves into a discoverable, pay-per-call Model Context Protocol (MCP) tool, settled in GRT via TAP v2 or in USDC via x402. Any MCP-speaking AI agent (Claude, Cursor, OpenAI Agents, Eliza) can query subgraphs for under a cent each.',
    tier: 3,
    statusLabel: 'Testnet · pre-launch',
    statusVariant: 'default',
    stage: 'Active dev / testnet',
    providerStatus: 'none',
    providerNote: 'None (testnet). Weeks 1–6 complete: gateway fully functional. Remaining: compass-cli (week 7), launch (week 8).',
    chain: { payment: 'arbitrum-sepolia', paymentLabel: 'Arbitrum Sepolia', dataLabel: 'USDC rail on Base', isMainnet: false },
    stack: ['Solidity', 'JavaScript', 'TypeScript', 'Rust'],
    links: [
      { label: 'Repo', url: 'https://github.com/lodestar-team/compass' },
      { label: 'GRC-007', url: 'https://forum.thegraph.com/t/grc-007-compass-a-decentralised-subgraph-mcp-gateway-on-horizon/6949' },
    ],
    becomeProvider: [
      'Provision GRT to MCPDataService.sol.',
      'Run compass-gateway (lightweight Rust sidecar) connected to an existing graph-node.',
      'List subgraphs in compass.toml (each becomes one MCP tool); collect GRT by submitting signed RAVs.',
    ],
    consume: [
      'Point any MCP Streamable HTTP client at the gateway.',
      'tools/list (no payment) and tools/call (TAP receipt or x402 X-Payment required).',
      'No payment header returns HTTP 402 with an x402 spec; pay USDC on Base via x-payment header.',
    ],
    fees: 'Dual-rail: GRT/TAP primary + USDC/x402 secondary (Coinbase Bazaar auto-listing).',
    notable:
      'MCPDataService.sol is ~60 lines of delta from Dispatch\'s RPCDataService.sol. Third community-built Horizon data service alongside Dispatch and Mainline.',
  },
  {
    slug: 'camp-data-service',
    name: 'camp-data-service',
    builtBy: 'lodestar-team',
    homeTeam: true,
    tagline: 'Monetizes a self-hosted camp instance — pay per request in GRT for decoded Arbitrum One data.',
    description:
      'Puts a TAP/GraphTally payment layer in front of camp (a free REST API for decoded Arbitrum One data backed by an Amp node). "The ThinkPad running ampd becomes an indexer on Horizon, and anyone who wants decoded Arbitrum One data pays in GRT to query it."',
    tier: 3,
    statusLabel: 'Testnet · functional',
    statusVariant: 'default',
    stage: 'Active dev / testnet',
    providerStatus: 'none',
    providerNote: 'None (testnet experiment). Gateway, contract, RAV aggregation, and hourly on-chain collection are implemented and tested. Not audited.',
    chain: {
      payment: 'arbitrum-sepolia',
      paymentLabel: 'Arbitrum Sepolia (payments)',
      dataLabel: 'Real Arbitrum One mainnet data',
      isMainnet: false,
    },
    stack: ['Rust', 'Solidity', 'TypeScript'],
    links: [
      { label: 'Repo', url: 'https://github.com/lodestar-team/camp-data-service' },
      { label: 'camp REST API', url: 'https://github.com/lodestar-team/camp' },
    ],
    contracts: [
      { label: 'HorizonStaking (testnet)', address: '0xFf2Ee30de92F276018642A59Fb7Be95b3F9088Af', network: 'arbitrum-sepolia' },
      { label: 'GraphTallyCollector (testnet)', address: '0xacC71844EF6beEF70106ABe6E51013189A1f3738', network: 'arbitrum-sepolia' },
    ],
    minProvision: '555 GRT',
    becomeProvider: [
      'HorizonStaking.provision(addr, CampDataService, ≥555e18, maxVerifierCut, thawingPeriod).',
      'CampDataService.register(addr, abi.encode(endpoint, geoHash, paymentsDestination)).',
      'startService per tier (BASIC=0, DECODED=1, SQL=2 — a provider can serve all three).',
      'Serve queries: receipts → RAVs every 60s → collect() hourly. Requires a running camp instance + camp-gateway.',
    ],
    consume: [
      'Fund a PaymentsEscrow account (GRT.approve → PaymentsEscrow.depositTo(provider, amount)).',
      'Send each REST request with a signed EIP-712 TAP-Receipt header (value = CUs × base price, 4e12 GRT wei/CU).',
      'Tiered endpoints: BASIC (1 CU), STANDARD (5 CU), AGGREGATE (10 CU), SQL (20 CU).',
    ],
    notable:
      'Payment contracts on Sepolia but the data served is real Arbitrum One mainnet data — real data paid for with testnet GRT. No graph-node needed — proxies to Amp directly. TAP aggregation built into camp-gateway (no indexer-tap-agent).',
  },
  {
    slug: 'vince-data-service',
    name: 'Vince Data Service',
    builtBy: 'lodestar-team · cargopete',
    homeTeam: true,
    tagline: 'A whimsical-but-functional service "for locating individuals named Vince, worldwide".',
    description:
      'Demonstrates the full data-service lifecycle: it compiles, deploys, and moves GRT. Inspired by the Josh Fight and a Graph Discord joke. "The Vinces are not real. The payments are."',
    tier: 4,
    statusLabel: 'Local demo',
    statusVariant: 'default',
    stage: 'Proof-of-concept',
    providerStatus: 'none',
    providerNote: 'None (local Anvil demo). Compiles, deploys, moves GRT, registers a provider and two active regions. 1 commit.',
    chain: { payment: 'local-anvil', paymentLabel: 'Local Anvil', isMainnet: false },
    stack: ['Solidity'],
    links: [
      { label: 'Repo', url: 'https://github.com/lodestar-team/vince-data-service' },
      { label: 'Lodestar guide', url: 'https://www.lodestar-dashboard.com/blog/how-to-build-a-horizon-data-service' },
    ],
    becomeProvider: [
      'Deploy via script/Deploy.s.sol (full Horizon stack + VinceDataService + provider registration + two regions + escrow funding).',
      'Providers activate coverage for geographic regions (geohash) at one of three tiers (SIGHTING, CONFIRMED, WORLDWIDE) via startService.',
    ],
    consume: [
      'Local cast call / cast send against the deployed contract (registeredProviders, getRegions, startService, stopService).',
      'Each successful collect() increments totalVincesLocated.',
    ],
    notable:
      'slash() deliberately reverts ("Vince is a lover, not a fighter"). totalVincesLocated counts each GRT wei of fees as one Vince located. Companion to hello-data-service.',
  },
  {
    slug: 'hello-data-service',
    name: 'Hello Data Service',
    builtBy: 'lodestar-team · cargopete',
    homeTeam: true,
    tagline: 'A minimal (~120-line) working Horizon data service reference — the simplest of the set.',
    description:
      'A starting point/reference for building your own service. Pure on-chain contract with no off-chain serving component — a payment-lifecycle reference, not a data-serving endpoint.',
    tier: 4,
    statusLabel: 'Local reference',
    statusVariant: 'default',
    stage: 'Template / educational',
    providerStatus: 'none',
    providerNote: 'None (local reference). Compiles, deploys locally, runs the complete provider-registration and escrow-funding sequence. 2 commits.',
    chain: { payment: 'local-anvil', paymentLabel: 'Local Anvil', isMainnet: false },
    stack: ['Solidity'],
    links: [
      { label: 'Repo', url: 'https://github.com/lodestar-team/hello-data-service' },
      { label: 'Lodestar guide', url: 'https://www.lodestar-dashboard.com/blog/how-to-build-a-horizon-data-service' },
    ],
    becomeProvider: [
      'script/Deploy.s.sol deploys in four phases: Horizon stack → HelloDataService → provider provisions stake + registers → gateway authorizes signing key + funds escrow.',
      'register accepts a greeting string and optional paymentsDestination.',
    ],
    consume: [
      'Local cast calls against the deployed contract; no live query surface.',
      'The contract is a payment-lifecycle reference, not a data endpoint.',
    ],
    notable:
      'Documents practical gotchas (import paths, remappings, via_ir = true, deregister not in IDataService). slash() reverts. Apache-2.0.',
  },
];

export interface CatalogueStats {
  total: number;
  mainnetLive: number;
  activeProviders: number;
  selfRunProviders: number;
  homeTeam: number;
}

/** Derive headline stats from the dataset so the summary strip never drifts. */
export function catalogueStats(services: DataService[] = DATA_SERVICES): CatalogueStats {
  return {
    total: services.length,
    mainnetLive: services.filter((s) => s.chain.isMainnet).length,
    activeProviders: services.filter((s) => s.providerStatus === 'active').length,
    selfRunProviders: services.filter((s) => s.providerStatus === 'single-self-run').length,
    homeTeam: services.filter((s) => s.homeTeam).length,
  };
}

const EXPLORER_BASE: Record<ChainNetwork, string | null> = {
  'arbitrum-one': 'https://arbiscan.io/address/',
  'arbitrum-sepolia': 'https://sepolia.arbiscan.io/address/',
  'local-anvil': null,
};

/** Block-explorer URL for a contract, or null for local chains. */
export function explorerUrl(contract: ServiceContract): string | null {
  const base = EXPLORER_BASE[contract.network];
  return base ? base + contract.address : null;
}
