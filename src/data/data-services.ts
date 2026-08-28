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

export const DATA_SERVICES_LAST_REVIEWED = '2026-08-17';

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
    tier: 1,
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
    blurb: 'Pedagogical scaffolds for exercising the payment lifecycle on a local chain.',
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
  /** Built by Lodestar (nightswatchhq / cargopete). */
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
  /** Interactive playground — live sample query, example code, prerequisites. */
  playground?: PlaygroundConfig;
}

/** Interactive "try it" config for a live, queryable service. */
export interface PlaygroundConfig {
  /** Public endpoint shown to the user. */
  endpoint: string;
  /** Whether the dashboard can run a live sample query (false = code-only, e.g. gRPC). */
  runnable: boolean;
  /** Human label for the sample query, e.g. "eth_blockNumber on Arbitrum One". */
  sampleLabel: string;
  /** What must be true before a real consumer (not this demo) can query. */
  prerequisites: string[];
  /** Language tag for the example snippet. */
  exampleLang: string;
  /** Copy-pasteable example of how to call the service for real. */
  exampleCode: string;
  /** Optional note rendered under the runner (e.g. why it's code-only). */
  note?: string;
}

export const DATA_SERVICES: DataService[] = [
  {
    slug: 'subgraph-service',
    name: 'Subgraph Service',
    grc: 'GIP-0068',
    builtBy: 'graphprotocol',
    homeTeam: false,
    tagline: 'The first and only widely-used data service: subgraph indexing and GraphQL query-serving.',
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
      'Submit POIs periodically. Stale POIs (>28d maxPOIStaleness) can be force-closed by anyone. Run graph-node, indexer-service-rs, indexer-tap-agent, indexer-agent.',
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
    tagline: 'Decentralized JSON-RPC / dRPC data service: stake, register a chain, get paid per request.',
    description:
      'A decentralized JSON-RPC data service. Indexers stake GRT, register to serve specific chains, and get paid per request via GraphTally. The canonical reference for Lodestar\'s "How to Build a Horizon Data Service" guide.',
    tier: 1,
    // Corrected 2026-08-28. Every endpoint advertised on-chain was tested and none answer:
    // rpc.cargopete.com fails the TLS handshake (its reverse-proxy entry was removed from the
    // Caddyfile on 2026-07-20 and no gateway process runs on that box at all), and both of the
    // second provider's Railway endpoints return "Application not found". The contract is still
    // live and both providers are still registered on-chain — which is exactly the problem, since
    // the registry advertises endpoints that do not answer. Saying "Live · Production" here while
    // inviting people to try a dead endpoint is the one thing this catalogue must never do.
    statusLabel: 'Contract live · endpoints down',
    statusVariant: 'warning',
    stage: 'Deployed, not currently serving',
    providerStatus: 'single-self-run',
    providerNote:
      'The RPCDataService contract is live on Arbitrum One and two providers are registered, but as of 2026-08-28 no advertised endpoint answers: rpc.cargopete.com fails its TLS handshake and both Railway endpoints return "Application not found". On-chain collect was proven historically (18.44 GRT settled). Restoring a serving endpoint is the open item.',
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
    playground: {
      endpoint: 'https://rpc.cargopete.com/rpc/42161',
      runnable: true,
      sampleLabel: 'eth_blockNumber via the Dispatch gateway (Arbitrum One)',
      prerequisites: [
        'For this demo the Lodestar gateway pays on your behalf, so nothing is required.',
        'To integrate your own app: deposit GRT into PaymentsEscrow keyed to (you, GraphTallyCollector, provider), then either run the dispatch-proxy locally or use @lodestar-dispatch/consumer-sdk, which signs a TAP receipt per request.',
        'The gateway path (shown here) needs only an X-Consumer-Address header. The gateway holds the escrow and signs receipts for you.',
      ],
      exampleLang: 'bash',
      exampleCode: `# Via the gateway (it pays + signs receipts for you, just identify yourself):
curl -s https://rpc.cargopete.com/rpc/42161 \\
  -H 'content-type: application/json' \\
  -H 'X-Consumer-Address: 0xYourAddress' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'

# Trustless path (your own escrow + receipts):
npm i @lodestar-dispatch/consumer-sdk`,
    },
  },
  {
    slug: 'seahorn',
    name: 'Seahorn',
    grc: 'GRC-008',
    builtBy: 'nightswatchhq',
    homeTeam: true,
    tagline: 'A Solana structured-data service: the "missing third lane" alongside Subgraphs and Substreams.',
    description:
      'Indexes Solana program activity (Pump.fun, Raydium CLMM, Jupiter v6) into typed, fork-correct, queryable entities served over a PostgREST REST API, gating access via TAP v2 micropayments.',
    tier: 1,
    // Corrected 2026-08-28, in the sweep that followed the Dispatch outage.
    // seahorn.89.167.109.4.sslip.io does not answer: the hostname resolves to the Helsinki box,
    // which has no vhost for it and no seahorn process, container, unit or directory. It is absent
    // from the other host too. SolanaDataService (0xdDE3F913…) still holds code on Arbitrum One,
    // so the contract is live and the serving endpoint is gone — a different sentence, and the
    // honest one.
    statusLabel: 'Contract live · endpoint down',
    statusVariant: 'warning',
    stage: 'Deployed on Arbitrum One; serving endpoint not currently up',
    providerStatus: 'single-self-run',
    providerNote:
      'SolanaDataService is deployed on Arbitrum One, but as of 2026-08-28 the advertised endpoint (seahorn.89.167.109.4.sslip.io) does not answer, and no seahorn service is running on either host. Single self-run provider; unaudited. Restoring a serving endpoint is the open item.',
    chain: { payment: 'arbitrum-one', paymentLabel: 'Arbitrum One', dataLabel: 'Solana mainnet data', isMainnet: true },
    stack: ['Rust', 'Solidity'],
    links: [
      { label: 'Repo', url: 'https://github.com/nightswatchhq/seahorn' },
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
      'Experimental and community-led; explicitly not endorsed by Graph Foundation or Edge & Node. Axum 0.8 gateway, UUPS proxy, 37 contract tests.',
    playground: {
      endpoint: 'https://seahorn.89.167.109.4.sslip.io/buys?limit=3',
      runnable: true,
      sampleLabel: 'Latest Pump.fun buys: live Solana, indexed via Yellowstone',
      prerequisites: [
        'Sign an EIP-712 TAP v2 receipt (GraphTallyCollector domain, chainId 42161) and pass it as the TAP-Receipt header on every request.',
        'For on-chain settlement the payer must fund PaymentsEscrow keyed to (payer, GraphTallyCollector, provider 0xCfBB…5C5b) and authorise the signing key on GraphTallyCollector.',
        'This demo signs an ephemeral receipt server-side so you can try it with no wallet.',
      ],
      exampleLang: 'bash',
      exampleCode: `# Each query carries a signed EIP-712 TAP receipt in the TAP-Receipt header:
curl -s 'https://seahorn.89.167.109.4.sslip.io/buys?limit=3&order=slot.desc' \\
  -H "TAP-Receipt: $RECEIPT_JSON"

# Build $RECEIPT_JSON by EIP-712 signing this struct (viem):
# domain  = { name:'GraphTallyCollector', version:'1', chainId:42161,
#             verifyingContract:'0x8f69F5C07477Ac46FBc491B1E6D91E2bb0111A9e' }
# Receipt = { data_service:'0xdDE3F913…7B37', service_provider:'0xCfBB…5C5b',
#             timestamp_ns, nonce, value, metadata:<payer 20 bytes> }`,
    },
  },
  {
    slug: 'substreams-data-service',
    name: 'Substreams Data Service',
    builtBy: 'graphprotocol',
    homeTeam: false,
    tagline: 'Payment infrastructure for Substreams, the "second data service being built on the network".',
    description:
      'A Go implementation of the payment infrastructure for the Substreams Data Service. Uses a sidecar/session model (persistent bidirectional gRPC payment session) rather than per-HTTP-request receipts.',
    tier: 3,
    statusLabel: 'In dev · MVP',
    statusVariant: 'default',
    stage: 'MVP / pre-launch',
    providerStatus: 'none',
    providerNote: 'None on mainnet; still at development stage. Core payment loop works end-to-end in a local Anvil devenv.',
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
    name: 'Substreams Data Service: Community Edition (SDSCE)',
    builtBy: 'nightswatchhq',
    homeTeam: true,
    tagline: 'A community edition of the Substreams Data Service, live on Arbitrum One with a fixed 1% burn.',
    description:
      'A community-maintained payment layer for Substreams on Horizon: a consumer sidecar signs EIP-712 RAVs over a persistent payment session, a provider gateway meters usage authoritatively from the Firehose plugin path, and an on-chain SubstreamsDataService settles via GraphTally. Forked from the graphprotocol MVP and hardened to a live, upgradeable mainnet contract.',
    tier: 1,
    statusLabel: 'Live · Production',
    statusVariant: 'success',
    stage: 'Live: self-run provider streaming substreams + on-chain collect',
    providerStatus: 'single-self-run',
    providerNote:
      'Live: streaming + paid loop proven (streaming → metered-RAV → on-chain collect, real GRT settled, ~2% burned). Currently on a clock-demo substrate to avoid upstream firehose cost; real Arbitrum via Pinax firehose runs on demand. Single self-run provider; unaudited.',
    chain: { payment: 'arbitrum-one', paymentLabel: 'Arbitrum One', dataLabel: 'Substreams (firecore)', isMainnet: true },
    stack: ['Go', 'Solidity'],
    links: [
      { label: 'Repo', url: 'https://github.com/nightswatchhq/SDSCE' },
      { label: 'Announcement', url: 'https://www.lodestar-dashboard.com/blog/substreams-data-service-community-edition' },
      { label: 'Deployment runbook', url: 'https://github.com/nightswatchhq/SDSCE/blob/main/docs/arb-one-deployment-runbook.md' },
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
      'Experimental and community-led; explicitly not affiliated with the Graph Foundation or Edge & Node. UUPS-upgradeable (Ownable2Step), ERC1967 proxy. Distinct from the official Substreams Data Service. Unaudited; not yet usable end-to-end (no live provider).',
    playground: {
      endpoint: 'substreams.89.167.109.4.sslip.io/sample → gRPC via consumer sidecar',
      runnable: true,
      sampleLabel: 'Stream common map_clocks via the sidecar (clock-demo substrate)',
      note: 'Substreams is server-streaming gRPC, so a browser cannot speak it directly. "Run" calls a shim that streams a few blocks through the consumer sidecar. Currently a clock-demo substrate (zero upstream cost); a real Pinax-backed firehose can be enabled on demand.',
      prerequisites: [
        'Deposit GRT into PaymentsEscrow for the provider and authorise your signer on GraphTallyCollector.',
        'Run the consumer sidecar locally (sds consumer sidecar). It signs RAVs and proxies the stream.',
        'Point the substreams CLI at the sidecar endpoint.',
      ],
      exampleLang: 'bash',
      exampleCode: `# 1. fund escrow + authorise signer (once)
sds consumer funding deposit --receiver-address <PROVIDER> --amount "1 GRT" ...
sds consumer signer authorize --signer-address <SIGNER> ...

# 2. run the sidecar (signs RAVs, proxies the gRPC stream)
sds consumer sidecar --grpc-listen-addr :9002 --provider-control-plane-endpoint <PROVIDER_URL> ...

# 3. stream a package through it
substreams run common@v0.1.0 map_clocks -e localhost:9002 --plaintext -s 0 -t +20`,
    },
  },
  {
    slug: 'fhsce',
    name: 'File Hosting Service: Community Edition (FHSCE)',
    builtBy: 'nightswatchhq',
    homeTeam: true,
    tagline: 'A community edition of the File Hosting Service: chunked, IPFS-verified file sharing, brought onto Horizon with TAP v2.',
    description:
      'Forked from graphops/file-hosting-service: a trust-minimised, peer-to-peer marketplace for sharing chunked, SHA2-256-verified file data (Firehose flatfiles, subgraph snapshots, arbitrary datasets) addressed by an IPFS manifest. The upstream data plane is excellent but its payment layer was legacy Scalar TAP and never finished. FHSCE keeps the data plane and replaces payments with a Horizon-native, UUPS-upgradeable FileHostingDataService and a TAP v2 (GraphTally) gateway built on the new horizon-core crate. Providers register and startService per IPFS manifest CID; consumers pay per request via signed TAP receipts redeemed as RAVs.',
    tier: 3,
    statusLabel: 'In dev · mainnet-ready',
    statusVariant: 'default',
    stage: 'Contract fork-verified against real Arbitrum One Horizon; gateway built on horizon-core; deploy pending',
    providerStatus: 'none',
    providerNote:
      'Not yet on mainnet. Contract complete (39 Foundry tests, UUPS upgrade-preserves-state) and deploy fork-verified against the real Arbitrum One Controller + GraphTallyCollector. fhsce-gateway built on horizon-core; off-chain TAP loop e2e-tested (receipt → verify → persist → proxy, replay/expiry rejected). Awaiting mainnet broadcast + a self-run provider serving real Arbitrum firehose flatfiles.',
    chain: { payment: 'arbitrum-one', paymentLabel: 'Arbitrum One (target)', dataLabel: 'Firehose flatfiles (.dbin)', isMainnet: false },
    stack: ['Rust', 'Solidity'],
    links: [
      { label: 'Repo (FHSCE)', url: 'https://github.com/nightswatchhq/FHSCE' },
      { label: 'horizon-core', url: 'https://github.com/nightswatchhq/horizon-core' },
      { label: 'Upstream (graphops)', url: 'https://github.com/graphops/file-hosting-service' },
    ],
    minProvision: '0 GRT (soft launch)',
    becomeProvider: [
      'HorizonStaking: stake, then provision(addr, FileHostingDataService, tokens, maxVerifierCut, thawingPeriod≥14d).',
      'FileHostingDataService.register(addr, abi.encode(endpoint, geoHash, paymentsDestination)).',
      'Owner allowlists the IPFS manifest CID (addManifest); startService per manifest hosted.',
      'Run the stack: file-service (chunked-file data plane) + fhsce-gateway (TAP v2, built on horizon-core) + Postgres; collect() hourly.',
    ],
    consume: [
      'Fund PaymentsEscrow for the provider and authorise a signer on GraphTallyCollector.',
      'Sign an EIP-712 TAP v2 receipt (GraphTallyCollector domain, chainId 42161) per request; pass it in the TAP-Receipt header.',
      'Download chunks over HTTP (range requests supported); each chunk is SHA2-256-verifiable against the IPFS manifest.',
    ],
    fees: 'Fixed 1% data-service cut, burned (0% retained), matching SDSCE under Community Edition policy.',
    notable:
      'First consumer of horizon-core (nightswatchhq\'s reusable Horizon payment plumbing: TAP v2 validation, RAV aggregation, on-chain collection, persistence, generic TAP-gated proxy). Experimental and community-led; not affiliated with the Graph Foundation, Edge & Node, or GraphOps. Unaudited. Distinct from the upstream graphops File Hosting Service.',
  },
  {
    slug: 'nuthatch-data-service',
    name: 'Nuthatch Data Service',
    builtBy: 'nightswatchhq',
    homeTeam: true,
    tagline: 'Reproducible Nuthatch indexed datasets, identified and sold by NID rather than a vague promise of SQL.',
    description:
      'A Horizon proxy service for self-hosted Nuthatch nests. A provider advertises a specific (NID, QueryMode, endpoint) offering on-chain, then a narrow Rust gateway validates TAP receipts before forwarding to Nuthatch. The normal product is author-sanctioned named queries; arbitrary SQL is an explicit, separately advertised mode.',
    tier: 2,
    statusLabel: 'Mainnet self-run beta',
    statusVariant: 'accent',
    stage: 'A registered provider serves the Horizon nest through a hardened public TAP gateway. One mainnet TAP receipt and signed RAV have completed the collect() settlement path; consumer signing is currently allowlisted for the beta.',
    providerStatus: 'single-self-run',
    providerNote:
      'Provider 0x02526499Ae2879A94090267017C3816f733825Bb serves the Horizon nest in NAMED mode at https://nuthatchds.89.167.109.4.sslip.io. Discovery is public; paid requests presently require an allowlisted, GraphTally-authorized signer. The service provision floor is 0 GRT; Horizon Staking itself still requires every provision to be non-zero.',
    chain: {
      payment: 'arbitrum-one',
      paymentLabel: 'Arbitrum One',
      dataLabel: 'Nuthatch nests, initially Horizon activity',
      isMainnet: true,
    },
    stack: ['Rust', 'Solidity', 'DuckDB', 'Postgres'],
    links: [
      { label: 'Repo', url: 'https://github.com/nightswatchhq/nuthatch-ds' },
      { label: 'First nest: horizon-nest', url: 'https://github.com/nightswatchhq/horizon-nest' },
      { label: 'Nuthatch', url: 'https://github.com/nightswatchhq/nuthatch' },
    ],
    contracts: [
      {
        label: 'NuthatchDataService (proxy)',
        address: '0x647D1Fd14AF2DE3947522B74F1de5B99d317c10A',
        network: 'arbitrum-one',
      },
      {
        label: 'GraphTallyCollector',
        address: '0x8f69F5C07477Ac46FBc491B1E6D91E2bb0111A9e',
        network: 'arbitrum-one',
      },
    ],
    minProvision: '0 GRT service floor; Horizon Staking requires a non-zero provider provision',
    becomeProvider: [
      'Provision any non-zero amount in HorizonStaking to the NuthatchDataService proxy (14-day thawing minimum).',
      'register(provider, abi.encode(endpoint, geoHash, paymentsDestination)), then startService(provider, abi.encode(nid, QueryMode.NAMED, endpoint)).',
      'Run Nuthatch privately with the nest query allowlist mounted, Postgres for receipt persistence, and nuthatch-gateway pointed at that Nuthatch runtime.',
    ],
    consume: [
      'Discover one offered NID through free GET /v1/nests/:nid/schema and /queries routes.',
      'Use GET /v1/nests/:nid/q/:query with a signed EIP-712 TAP-Receipt. Named queries cost 1 CU; tables cost 2 CU; SQL costs 20 CU and is available only from an SQL offering.',
      'The first self-run beta offering is https://nuthatchds.89.167.109.4.sslip.io for NID 36d3c71446a56cdb5b90536d3f5f77351b1d92efcca94bc2fd41b1c368e69410. Contact the provider to arrange an authorised signer.',
    ],
    fees: '1% burned + 1% retained by the data service on collection.',
    notable:
      'The NID is the discovery primitive: two indexers offering the same NID claim to serve the same reproducible authored dataset. Gateway tests cover NID routing, the named-query default, SQL rejection, receipt gating, and unsafe upstream-path rejection. Slashing deliberately reverts because there is no on-chain dispute mechanism yet.',
  },
  {
    slug: 'mainline-firehose',
    name: 'Mainline (Firehose)',
    grc: 'GRC-006',
    builtBy: 'PaulieB14 · GRC by cargopete',
    homeTeam: false,
    tagline: 'A decentralized Firehose data service: raw, fork-aware, cursor-resumable block streams over gRPC.',
    description:
      'Reference implementation for GRC-006 "Mainline". Positioned as the decentralized substrate beneath Substreams / Subgraphs / Tycho / Token API / Dispatch. Wraps streamingfast/firehose-core unchanged.',
    tier: 1,
    statusLabel: 'Live · Production',
    statusVariant: 'success',
    stage: 'Live on Arbitrum One, serving Ethereum mainnet firehose',
    providerStatus: 'single-self-run',
    providerNote: 'Live: FirehoseDataService deployed to Arbitrum One; a self-run operator serves REAL Ethereum mainnet firehose (proxied from Pinax), each block EIP-712 attested + TAP-gated, verified end-to-end by the SDK consumer. Single self-run provider; unaudited.',
    chain: { payment: 'arbitrum-one', paymentLabel: 'Arbitrum One', dataLabel: 'Ethereum mainnet blocks', isMainnet: true },
    stack: ['Solidity', 'Rust', 'TypeScript'],
    links: [
      { label: 'Repo', url: 'https://github.com/PaulieB14/firehose-data-service' },
      { label: 'GRC-006', url: 'https://forum.thegraph.com/t/grc-006-mainline-a-firehose-data-service-on-horizon/6920' },
    ],
    contracts: [
      { label: 'FirehoseDataService', address: '0x12C722149804a8C1Bb5924374e675956315B4456', network: 'arbitrum-one' },
      { label: 'GraphTallyCollector', address: '0x8f69F5C07477Ac46FBc491B1E6D91E2bb0111A9e', network: 'arbitrum-one' },
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
    playground: {
      endpoint: 'mainline.89.167.109.4.sslip.io (gRPC firehose)',
      runnable: true,
      sampleLabel: 'Stream real Ethereum mainnet firehose blocks (attested)',
      prerequisites: [
        'Sign an EIP-712 TAP v2 receipt and pass it in the x-tap-receipt gRPC metadata (118 bytes).',
        'For settlement, the payer funds PaymentsEscrow for the provider and authorises the signer on GraphTallyCollector.',
        'Verify each MainlineAttestation (201 bytes) against the operator signing address from the network subgraph.',
        'This demo signs an ephemeral receipt server-side, streams a few blocks, and verifies their attestations.',
      ],
      exampleLang: 'bash',
      exampleCode: `# gRPC consumer (mainline-sdk, Rust/TS). TAP receipt rides in x-tap-receipt metadata:
cargo run --example stream_blocks -- \\
  --operator https://<operator-endpoint> \\
  --fds-address 0x12C722149804a8C1Bb5924374e675956315B4456 \\
  --operator-address 0x<operator-signing-address>
# each Stream.Blocks response carries raw fork-aware firehose data + a
# verifiable MainlineAttestation (chain_id|block_num|block_hash|state_root|payload_hash|sig).`,
    },
  },
  {
    slug: 'wsaas',
    name: 'WSaaS (WebSocket)',
    builtBy: 'nightswatchhq',
    homeTeam: true,
    tagline: 'A WebSocket data service: pre-parsed transfers, swaps and exchange events over one connection, billed per message.',
    description:
      'A Horizon data service that streams pre-parsed transfers / swaps / exchange events over a single WebSocket, gated by TAP v2 and settled on-chain. It sits in front of an upstream Pinax WebSocket feed: a consumer opens a WS with a signed TAP receipt, and the gateway relays every pre-parsed message back, billing per message.',
    tier: 1,
    statusLabel: 'Live \u00b7 Production',
    statusVariant: 'success',
    stage: 'Live on Arbitrum One \u2014 WebSocket relay over a Pinax feed',
    providerStatus: 'single-self-run',
    providerNote:
      'Live: WebSocketDataService deployed to Arbitrum One; a self-run provider relays pre-parsed transfers/swaps from an upstream Pinax WebSocket, TAP-gated (receipt in the ?receipt= query). Single self-run provider; unaudited.',
    chain: { payment: 'arbitrum-one', paymentLabel: 'Arbitrum One', dataLabel: 'Multi-chain pre-parsed events', isMainnet: true },
    stack: ['Rust', 'Solidity'],
    links: [
      { label: 'Repo', url: 'https://github.com/nightswatchhq/wsaas' },
      { label: 'Pinax WebSockets', url: 'https://pinax.network/products/websockets' },
    ],
    contracts: [
      { label: 'WebSocketDataService', address: '0x9e1eB4c907b6b8e92830e036B9Fc64E5ae5278Bd', network: 'arbitrum-one' },
      { label: 'GraphTallyCollector', address: '0x8f69F5C07477Ac46FBc491B1E6D91E2bb0111A9e', network: 'arbitrum-one' },
    ],
    minProvision: '0 GRT (self-run)',
    becomeProvider: [
      'Stake + provision GRT to WebSocketDataService, register, startService.',
      'Run ws-gateway pointed at an upstream WebSocket feed (e.g. Pinax) with your JWT.',
      'Get paid per message via GraphTally; collect() hourly.',
    ],
    consume: [
      'Open wss://<gateway>/ws/{chain}/{topic}?receipt=<url-encoded EIP-712 TAP receipt>.',
      'No receipt -> 400/402. Messages are pre-parsed transfers/swaps relayed from upstream.',
    ],
    fees: 'Per-message (Pinax beta reference: $0.00005/msg); ~2% data-service cut on collect.',
    playground: {
      endpoint: 'wss://ws.89.167.109.4.sslip.io/ws/{chain}/{topic}',
      runnable: false,
      sampleLabel: 'Stream pre-parsed events over WebSocket (transfers / swaps)',
      note: 'WebSocket + a signed TAP receipt \u2014 open it from a WS client, not a plain browser fetch.',
      prerequisites: [
        'Sign an EIP-712 TAP v2 receipt and url-encode it into the ?receipt= query parameter.',
        'For settlement, the payer funds PaymentsEscrow for the provider and authorises the signer on GraphTallyCollector.',
        'Billing is per relayed message (heartbeats/protocol frames are free).',
      ],
      exampleLang: 'bash',
      exampleCode: `# sign an EIP-712 TAP receipt (GraphTallyCollector domain), url-encode it, then:
wscat -c "wss://ws.89.167.109.4.sslip.io/ws/solana/swaps?receipt=$RECEIPT_JSON"
# or /ws/eth/erc20_transfers, /ws/eth/swaps, /ws/solana/spl_transfer ... messages are pre-parsed events relayed from Pinax.`,
    },
  },
  {
    slug: 'compass',
    name: 'Compass',
    grc: 'GRC-007',
    builtBy: 'nightswatchhq',
    homeTeam: true,
    tagline: 'A decentralized Subgraph-MCP gateway, turning every subgraph into a pay-per-call MCP tool for AI agents.',
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
      { label: 'Repo', url: 'https://github.com/nightswatchhq/compass' },
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
    builtBy: 'nightswatchhq',
    homeTeam: true,
    tagline: 'Monetizes a self-hosted camp instance: pay per request in GRT for decoded Arbitrum One data.',
    description:
      'Puts a TAP/GraphTally payment layer in front of camp (a free REST API for decoded Arbitrum One data backed by an Amp node). "The ThinkPad running ampd becomes an indexer on Horizon, and anyone who wants decoded Arbitrum One data pays in GRT to query it."',
    tier: 1,
    // Corrected 2026-08-28. camp.89.167.109.4.sslip.io does not answer, and no camp service
    // exists on either host. CampDataService (0x8ED61266…) still holds code on Arbitrum One.
    statusLabel: 'Contract live · endpoint down',
    statusVariant: 'warning',
    stage: 'Deployed on Arbitrum One; serving endpoint not currently up',
    providerStatus: 'single-self-run',
    providerNote: 'CampDataService is deployed on Arbitrum One, but as of 2026-08-28 the advertised endpoint (camp.89.167.109.4.sslip.io) does not answer, and no camp service is running on either host. Single self-run provider; unaudited. Restoring a serving endpoint is the open item.',
    chain: {
      payment: 'arbitrum-one',
      paymentLabel: 'Arbitrum One',
      dataLabel: 'Real Arbitrum One mainnet data',
      isMainnet: true,
    },
    stack: ['Rust', 'Solidity', 'TypeScript'],
    links: [
      { label: 'Repo', url: 'https://github.com/nightswatchhq/camp-data-service' },
      { label: 'camp REST API', url: 'https://github.com/nightswatchhq/camp' },
    ],
    contracts: [
      { label: 'CampDataService (proxy)', address: '0x8ED612666ad1853AdB050f4c4c54082decA605b8', network: 'arbitrum-one' },
      { label: 'GraphTallyCollector', address: '0x8f69F5C07477Ac46FBc491B1E6D91E2bb0111A9e', network: 'arbitrum-one' },

    ],
    minProvision: '555 GRT',
    becomeProvider: [
      'HorizonStaking.provision(addr, CampDataService, ≥555e18, maxVerifierCut, thawingPeriod).',
      'CampDataService.register(addr, abi.encode(endpoint, geoHash, paymentsDestination)).',
      'startService per tier (BASIC=0, DECODED=1, SQL=2; a provider can serve all three).',
      'Serve queries: receipts → RAVs every 60s → collect() hourly. Requires a running camp instance + camp-gateway.',
    ],
    consume: [
      'Fund a PaymentsEscrow account (GRT.approve → PaymentsEscrow.depositTo(provider, amount)).',
      'Send each REST request with a signed EIP-712 TAP-Receipt header (value = CUs × base price, 4e12 GRT wei/CU).',
      'Tiered endpoints: BASIC (1 CU), STANDARD (5 CU), AGGREGATE (10 CU), SQL (20 CU).',
    ],
    notable:
      'Payment contracts on Sepolia but the data served is real Arbitrum One mainnet data, so it is real data paid for with testnet GRT. No graph-node needed; it proxies to Amp directly. TAP aggregation built into camp-gateway (no indexer-tap-agent).',
    playground: {
      endpoint: 'https://camp.89.167.109.4.sslip.io/v1/status',
      runnable: true,
      sampleLabel: 'Arbitrum One indexing status from the Amp-backed camp node',
      prerequisites: [
        'Sign an EIP-712 TAP v2 receipt (GraphTallyCollector domain, chainId 42161) and pass it as the TAP-Receipt header.',
        'For on-chain settlement the payer funds PaymentsEscrow keyed to the provider (0xCfBB…5C5b) and authorises the signing key on GraphTallyCollector.',
        'This demo signs an ephemeral receipt server-side so you can try it with no wallet.',
      ],
      exampleLang: 'bash',
      exampleCode: `# Free REST endpoints proxied to a self-hosted Amp node, gated by a TAP receipt:
curl -s 'https://camp.89.167.109.4.sslip.io/v1/status' \\
  -H "TAP-Receipt: $RECEIPT_JSON"
curl -s 'https://camp.89.167.109.4.sslip.io/v1/transfers?token=0xaf88…&limit=10' \\
  -H "TAP-Receipt: $RECEIPT_JSON"

# $RECEIPT_JSON = EIP-712 signed Receipt under the GraphTallyCollector domain,
# with data_service = 0x8ED612666ad1853AdB050f4c4c54082decA605b8.`,
    },
  },
  {
    slug: 'hermit',
    name: 'Hermit DS',
    builtBy: 'lodestone (nightswatchhq)',
    homeTeam: true,
    tagline: 'The inverse analytics service: it indexes wallets that have gone quiet and fires wake alerts when dormant ones stir.',
    description:
      'The inverse of every analytics service on the network: instead of activity, Hermit indexes absence. Sophisticated dormancy detection (whales idle 18+ months, DAOs where quorum has been unreachable for N proposals, LPs who have missed K rebalance cycles), and it serves "wake alerts" the moment a dormant wallet moves. Consumers: MEV bots hunting stale approvals, security teams watching for compromised custody waking up, on-chain historians. Notable for being generated end-to-end by lodestone from a single paragraph of spec.',
    tier: 3,
    statusLabel: 'Scaffold · built by lodestone',
    statusVariant: 'accent',
    stage: 'Generated by lodestone from a one-paragraph spec; builds, tests, and runs locally',
    providerStatus: 'none',
    providerNote:
      'Not deployed. Generated entirely by lodestone with no hand-written code: the contract + 7/7 passing Foundry tests, a Substrate→Handler→Sink indexer that runs, and a horizon-core payment gateway that serves /health + /ready and TAP-gates requests (402 without a receipt), all verified locally. The dormancy-detection data plane is the generated mock, awaiting real detection logic.',
    chain: { payment: 'arbitrum-sepolia', paymentLabel: 'Arbitrum Sepolia (target)', dataLabel: 'Dormancy signal (concept)', isMainnet: false },
    stack: ['Rust', 'Solidity'],
    links: [
      { label: 'Repo', url: 'https://github.com/nightswatchhq/hermit-ds' },
      { label: 'Built with lodestone', url: 'https://github.com/nightswatchhq/lodestone' },
      { label: 'How it was built', url: 'https://www.lodestar-dashboard.com/blog/build-data-services-with-lodestone' },
    ],
    minProvision: '555 GRT',
    becomeProvider: [
      'Generated lifecycle: HorizonStaking.provision → HermitDataService.register(addr, abi.encode(endpoint, geoHash, paymentsDestination)).',
      'startService per tier: DORMANCY (0), WAKE_ALERTS (1), COHORTS (2).',
      'Run the stack: the dormancy indexer (Substrate→Handler→Sink) → Postgres → hermit-gateway (horizon-core, per-endpoint pricing).',
    ],
    consume: [
      'Query current dormancy status/scores, or subscribe to wake alerts, with a signed EIP-712 TAP-Receipt header.',
      'Pipeline archetype: the gateway fronts the query layer over the indexer\'s Postgres sink.',
    ],
    fees: '1% burn + 1% data-service cut per collect(); optional per-endpoint compute-unit pricing.',
    notable:
      'lodestone\'s proof-of-concept: a deliberately funky spec ("we watch people who aren\'t doing anything and tell you when they start") turned into a building, payment-gated Horizon data service with zero hand-written code. The inverted-query shape is exactly why nobody indexes it, and why it is useful.',
  },
  {
    slug: 'vince-data-service',
    name: 'Vince Data Service',
    builtBy: 'nightswatchhq · cargopete',
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
      { label: 'Repo', url: 'https://github.com/nightswatchhq/vince-data-service' },
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
    builtBy: 'nightswatchhq · cargopete',
    homeTeam: true,
    tagline: 'A minimal (~120-line) working Horizon data service reference, the simplest of the set.',
    description:
      'A starting point/reference for building your own service. Pure on-chain contract with no off-chain serving component: a payment-lifecycle reference, not a data-serving endpoint.',
    tier: 4,
    statusLabel: 'Local reference',
    statusVariant: 'default',
    stage: 'Template / educational',
    providerStatus: 'none',
    providerNote: 'None (local reference). Compiles, deploys locally, runs the complete provider-registration and escrow-funding sequence. 2 commits.',
    chain: { payment: 'local-anvil', paymentLabel: 'Local Anvil', isMainnet: false },
    stack: ['Solidity'],
    links: [
      { label: 'Repo', url: 'https://github.com/nightswatchhq/hello-data-service' },
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
