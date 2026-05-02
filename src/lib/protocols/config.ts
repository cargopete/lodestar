export type SchemaType = 'messari-dex' | 'messari-lending' | 'uniswap-v3';
export type ProtocolCategory = 'DEX' | 'Lending';

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
    slug: 'aave-v3',
    name: 'Aave V3',
    category: 'Lending',
    description: 'Decentralised non-custodial liquidity protocol where users supply assets to earn yield and borrow against collateral.',
    subgraphId: 'JCNWRypm7FYwV8fx5HhzZPSFaMxgkPuw4TnR3Gpi81zk',
    schemaType: 'messari-lending',
    website: 'https://aave.com',
    chains: ['Ethereum', 'Polygon', 'Avalanche', 'Arbitrum', 'Optimism'],
    color: '#B6509E',
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
];

export function getProtocol(slug: string): ProtocolConfig | undefined {
  return PROTOCOLS.find(p => p.slug === slug);
}
