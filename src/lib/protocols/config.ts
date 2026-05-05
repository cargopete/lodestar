export type SchemaType =
  | 'messari-dex'
  | 'messari-lending'
  | 'messari-staking'
  | 'messari-yield'
  | 'uniswap-v2'
  | 'uniswap-v3'
  | 'etherfi-native'
  | 'polymarket';

export type ProtocolCategory =
  | 'DEX'
  | 'Lending'
  | 'Liquid Staking'
  | 'Yield Aggregator'
  | 'Prediction Markets';

export interface ProtocolConfig {
  slug: string;
  name: string;
  category: ProtocolCategory;
  description: string;
  subgraphId: string;
  schemaType: SchemaType;
  website: string;
  chains: string[];
  color: string;
  /** Known upstream data quality issue — surfaced as a notice on the detail page. */
  knownIssues?: string;
}

export const PROTOCOLS: ProtocolConfig[] = [
  {
    slug: 'uniswap-v3',
    name: 'Uniswap V3',
    category: 'DEX',
    description: 'The leading decentralised exchange on Ethereum, enabling permissionless token swaps with concentrated liquidity positions.',
    subgraphId: '5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV',
    schemaType: 'uniswap-v3',
    website: 'https://uniswap.org',
    chains: ['Ethereum'],
    color: '#FF007A',
  },
  {
    slug: 'uniswap-v2',
    name: 'Uniswap V2',
    category: 'DEX',
    description: 'The original constant-product AMM that proved permissionless token swaps at scale on Ethereum. Flat 0.30% fee, still the deepest liquidity venue for many long-tail ERC-20 pairs.',
    subgraphId: 'GmSczqdCDZ3hJeYY9JphwsADn5rePUzUKm8EZcVuhRAm',
    schemaType: 'uniswap-v2',
    website: 'https://uniswap.org',
    chains: ['Ethereum'],
    color: '#FF6699',
  },
  {
    slug: 'uniswap-v3-polygon',
    name: 'Uniswap V3 (Polygon)',
    category: 'DEX',
    description: 'Uniswap V3 deployment on Polygon. Established L2 venue with deep MATIC and stablecoin liquidity, queried via the same v3 schema as the mainnet deployment.',
    subgraphId: '3hCPRGf4z88VC5rsBKU5AA9FBBq5nF3jbKJG7VZCbhjm',
    schemaType: 'uniswap-v3',
    website: 'https://app.uniswap.org',
    chains: ['Polygon'],
    color: '#8247E5',
  },
  {
    slug: 'aave-v3',
    name: 'Aave V3',
    category: 'Lending',
    description: 'Decentralised non-custodial liquidity protocol where users supply assets to earn yield and borrow against collateral. This dashboard tracks the Ethereum mainnet deployment.',
    subgraphId: 'JCNWRypm7FYwV8fx5HhzZPSFaMxgkPuw4TnR3Gpi81zk',
    schemaType: 'messari-lending',
    website: 'https://aave.com',
    chains: ['Ethereum'],
    color: '#B6509E',
  },
  {
    slug: 'aave-v3-arbitrum',
    name: 'Aave V3 (Arbitrum)',
    category: 'Lending',
    description: 'Aave V3 on Arbitrum One. Major L2 lending venue with deep ARB ecosystem assets, separate liquidity from the Ethereum deployment.',
    subgraphId: '4xyasjQeREe7PxnF6wVdobZvCw5mhoHZq3T7guRpuNPf',
    schemaType: 'messari-lending',
    website: 'https://app.aave.com',
    chains: ['Arbitrum'],
    color: '#28A0F0',
  },
  {
    slug: 'compound-v3',
    name: 'Compound V3',
    category: 'Lending',
    description: 'Open-source interest rate protocol allowing users to supply collateral and borrow the base asset.',
    subgraphId: 'AwoxEZbiWLvv6e3QdvdMZw4WDURdGbvPfHmZRc8Dpfz9',
    schemaType: 'messari-lending',
    website: 'https://compound.finance',
    chains: ['Ethereum'],
    color: '#00D395',
  },
  {
    slug: 'makerdao',
    name: 'MakerDAO',
    category: 'Lending',
    description: 'Decentralised CDP-based lending protocol behind DAI, the longest-running on-chain stablecoin issuance system. Users lock collateral to mint DAI against it.',
    subgraphId: '8sE6rTNkPhzZXZC6c8UQy2ghFTu5PPdGauwUBm4t7HZ1',
    schemaType: 'messari-lending',
    website: 'https://makerdao.com',
    chains: ['Ethereum'],
    color: '#1AAB9B',
  },
  {
    slug: 'morpho-blue',
    name: 'Morpho Blue',
    category: 'Lending',
    description: 'Permissionless lending primitive: each market is a single isolated pair of collateral and loan assets, with risk parameters set by curators rather than governance.',
    subgraphId: '8Lz789DP5VKLXumTMTgygjU2xtuzx8AhbaacgN5PYCAs',
    schemaType: 'messari-lending',
    website: 'https://morpho.org',
    chains: ['Ethereum'],
    color: '#2470FF',
    knownIssues: 'The upstream subgraph writes $0 to dailyProtocolSideRevenueUSD across all snapshots despite a non-zero cumulative figure. Daily fee charts show no data until this is fixed upstream.',
  },
  {
    slug: 'spark-lend',
    name: 'Spark Lend',
    category: 'Lending',
    description: 'Aave V3 fork operated by the Sky / MakerDAO ecosystem on Ethereum mainnet, with sDAI yield routing baked into the supply side. The largest Spark deployment by TVL.',
    subgraphId: 'GbKdmBe4ycCYCQLQSjqGg6UHYoYfbyJyq5WrG35pv1si',
    schemaType: 'messari-lending',
    website: 'https://spark.fi',
    chains: ['Ethereum'],
    color: '#E07A52',
  },
  {
    slug: 'spark-lend-gnosis',
    name: 'Spark Lend (Gnosis)',
    category: 'Lending',
    description: 'Spark Lend on Gnosis Chain, the Aave V3 fork operated by the Sky / MakerDAO ecosystem and integrated with sDAI yield routing.',
    subgraphId: 'Bw4RH37UbbGEhHo4FaWwT1dn9QJzm1XSZCyK1cbr6ZKM',
    schemaType: 'messari-lending',
    website: 'https://spark.fi',
    chains: ['Gnosis'],
    color: '#F58A65',
  },
  {
    slug: 'lido',
    name: 'Lido',
    category: 'Liquid Staking',
    description: 'Largest liquid staking protocol on Ethereum, issuing stETH against pooled validator stake and dominating the LST market.',
    subgraphId: 'F7qb71hWab6SuRL5sf6LQLTpNahmqMsBnnweYHzLGUyG',
    schemaType: 'messari-staking',
    website: 'https://lido.fi',
    chains: ['Ethereum'],
    color: '#00A3FF',
  },
  {
    slug: 'aerodrome',
    name: 'Aerodrome',
    category: 'DEX',
    description: 'Largest DEX on Base by TVL and volume. ve(3,3) AMM combining stable, volatile, and concentrated-liquidity (Slipstream) pools, with veAERO emissions directing liquidity.',
    subgraphId: 'GENunSHWLBXm59mBSgPzQ8metBEp9YDfdqwFr91Av1UM',
    schemaType: 'uniswap-v3',
    website: 'https://aerodrome.finance',
    chains: ['Base'],
    color: '#1A33FF',
  },
  {
    slug: 'pancakeswap-v3',
    name: 'PancakeSwap V3',
    category: 'DEX',
    description: 'Largest DEX on BNB Chain, with V3 also deployed to Ethereum. Concentrated-liquidity AMM forked from Uniswap V3 with multi-tier fees. This entry tracks the Ethereum mainnet deployment.',
    subgraphId: 'JAGXF8B14mpB8QGKnwhKTs5JxsQZBJQvbDGFcWwL7gbm',
    schemaType: 'messari-dex',
    website: 'https://pancakeswap.finance',
    chains: ['Ethereum'],
    color: '#D1884F',
  },
  {
    slug: 'ether-fi',
    name: 'ether.fi',
    category: 'Liquid Staking',
    description: 'Liquid restaking protocol on Ethereum issuing eETH (rebasing) and weETH (wrapped). Stakers earn validator rewards plus EigenLayer restaking yield. Largest LRT by TVL.',
    subgraphId: 'AEsX7AeqTD9bpFFaHwmCZbEXaHWsmzekoPKKuJUGQiQA',
    schemaType: 'etherfi-native',
    website: 'https://ether.fi',
    chains: ['Ethereum'],
    color: '#A0FFE6',
  },
  {
    slug: 'yearn-v2',
    name: 'Yearn V2',
    category: 'Yield Aggregator',
    description: 'Long-running yield optimisation protocol that routes deposits across vault strategies to maximise returns. The Ethereum mainnet V2 deployment, original automated yield primitive in DeFi.',
    subgraphId: 'FDLuaz69DbMADuBjJDEcLnTuPnjhZqNbFVrkNiBLGkEg',
    schemaType: 'messari-yield',
    website: 'https://yearn.fi',
    chains: ['Ethereum'],
    color: '#0657F9',
  },
  {
    slug: 'polymarket',
    name: 'Polymarket',
    category: 'Prediction Markets',
    description: 'Largest decentralised prediction-market venue. CLOB-style orderbook on Polygon settling outcome shares against USDC collateral, with over a billion trades on $100B+ of lifetime notional.',
    // The Polymarket-team deployments are pinned by IPFS hash on the gateway,
    // not registered Subgraph IDs. The fetcher routes polymarket schemaType
    // queries to the deployment endpoint.
    subgraphId: 'QmVGA9vvNZtEquVzDpw8wnTFDxVjB6mavTRMTrKuUBhi4t',
    schemaType: 'polymarket',
    website: 'https://polymarket.com',
    chains: ['Polygon'],
    color: '#2D9CDB',
    knownIssues: 'Headline TVL is total cumulative open interest (USDC locked into outstanding outcome tokens) and includes residual "dead money" from resolved markets where losing-side tokens were never burned. 30d windows are not currently computed for Polymarket as the orderbook subgraph has no daily aggregate entity; the directory shows lifetime totals instead.',
  },
];

// Deployment IPFS hashes for Polymarket subgraphs that aren't registered as
// network Subgraphs but are exposed via the gateway's /deployments/id/ path.
// Maintained by the Polymarket team (per github.com/Polymarket/polymarket-subgraph
// and PaulieB14/graph-polymarket-mcp).
export const POLYMARKET_OI_DEPLOYMENT = 'QmbT2MmS2VGbGihiTUmWk6GMc2QYqoT9ZhiupUicYMWt6H';
export const POLYMARKET_MAIN_DEPLOYMENT = 'QmdyCguLEisTtQFveEkvMhTH7UzjyhnrF9kpvhYeG4QX8a';
export const POLYMARKET_RESOLUTION_DEPLOYMENT = 'QmZnnrHWCB1Mb8dxxXDxfComjNdaGyRC66W8derjn3XDPg';

export function getProtocol(slug: string): ProtocolConfig | undefined {
  return PROTOCOLS.find(p => p.slug === slug);
}
