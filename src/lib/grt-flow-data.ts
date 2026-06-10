/**
 * Static reference data for the GRT Issuance & Flow page.
 * Distilled from The Graph's contracts docs, GIPs, and the Graph Explorer network dashboard.
 * Live figures come from the graph-network-arbitrum subgraph (see /api/grt-flow);
 * this module holds the slow-moving canonical reference material only.
 */

export const GENESIS_SUPPLY = 10_000_000_000; // 10B GRT minted at genesis on Ethereum mainnet (2020-12-14)

// External-source circulating supply (Graph Explorer / aggregators), against which the commonly
// cited ~2.77% issuance rate is computed. The network subgraph's totalSupply is a different,
// L2-scoped (net mint−burn) basis — see the CAVEATS and the issuance-rate note on the page.
export const CIRCULATING_SUPPLY_APPROX = 11_500_000_000;

export interface ContractRow {
  name: string;
  address: string;
  note?: string;
}

export interface ContractGroup {
  chain: string;
  subtitle: string;
  explorerBase: string; // address page base, append the address
  contracts: ContractRow[];
}

export const CONTRACT_GROUPS: ContractGroup[] = [
  {
    chain: 'Arbitrum One',
    subtitle: 'Principal deployment — 100% of indexing-reward issuance since 28 Jun 2024',
    explorerBase: 'https://arbiscan.io/address/',
    contracts: [
      { name: 'L2GraphToken (proxy)', address: '0x9623063377AD1B27544C965cCd7342f7EA7e88C7', note: 'impl 0xaffcb9…b28df' },
      { name: 'RewardsManager', address: '0x971B9d3d0Ae3ECa029CAB5eA1fB0F72c85e6a525', note: 'mints indexing rewards' },
      { name: 'L2Staking / HorizonStaking', address: '0x00669A4CF01450B64E8A2A20E9b1FCB71E61eF03' },
      { name: 'L2Curation', address: '0x22d78fb4bc72e191C765807f8891B5e1785C8014' },
      { name: 'EpochManager', address: '0x5A843145c43d328B9bB7a4401d94918f131bB281' },
      { name: 'L2GNS', address: '0xec9A7fb6CbC2E41926127929c2dcE6e9c5D33Bec' },
      { name: 'DisputeManager', address: '0x0Ab2B043138352413Bb02e67E626a70320E3BD46' },
      { name: 'L2GraphTokenGateway', address: '0x65E1a5e8946e7E87d9774f5288f41c30a99fD302', note: 'mints/burns on bridge' },
      { name: 'Controller', address: '0x0a8491544221dd212964fbb96487467291b2C97e' },
    ],
  },
  {
    chain: 'Ethereum Mainnet (L1)',
    subtitle: 'Deprecated for rewards (Dec 2024) — still holds GRT; bridge & escrow remain live',
    explorerBase: 'https://etherscan.io/address/',
    contracts: [
      { name: 'GraphToken', address: '0xc944E90C64B2c07662A292be6244BDf05Cda44a7', note: 'genesis 10B, verified 2020-12-14' },
      { name: 'RewardsManager', address: '0x9Ac758AB77733b4150A901ebd659cbF8cB93ED66' },
      { name: 'L1Staking', address: '0xF55041E37E12cD407ad00CE2910B8269B01263b9' },
      { name: 'Curation', address: '0x8FE00a685Bcb3B2cc296ff6FfEaB10acA4CE1538' },
      { name: 'BridgeEscrow', address: '0x36aFF7001294daE4C2ED4fDEfC478a00De77F090', note: 'locks L1 GRT backing L2' },
      { name: 'L1GraphTokenGateway', address: '0x01cDC91B0A9bA741903aA3699BF4CE31d6C5cC06', note: 'minter, bounded by L2 mint allowance' },
    ],
  },
  {
    chain: 'Horizon (Arbitrum One)',
    subtitle: 'Mainnet-live 2 Dec 2025 — relocates allocations & payments; issuance formula unchanged',
    explorerBase: 'https://arbiscan.io/address/',
    contracts: [
      { name: 'HorizonStaking', address: '0x00669A4CF01450B64E8A2A20E9b1FCB71E61eF03', note: 'L2Staking upgraded/renamed' },
      { name: 'SubgraphService', address: '0xb2Bb92d0DE618878E438b55D5846cfecD9301105', note: 'first data service' },
      { name: 'GraphTallyCollector', address: '0x8f69F5C07477Ac46FBc491B1E6D91E2be0111A9e', note: 'TAPv2 verifier — name-verify on Arbiscan' },
      { name: 'PaymentsEscrow', address: '0x8f477709eF277d4A880801D01A140a9CF88bA0d3', note: 'TAP escrow — name-verify on Arbiscan' },
    ],
  },
];

export interface TimelineEntry {
  date: string;
  title: string;
  detail: string;
}

export const L2_TIMELINE: TimelineEntry[] = [
  { date: 'Dec 2020', title: 'Mainnet launch', detail: '10B GRT genesis on Ethereum; ~3% compounding issuance via RewardsManager.' },
  { date: 'Jun 2022', title: 'Migration announced', detail: 'Graph Day: full migration to Arbitrum One announced (GIP-0031 bridge).' },
  { date: 'GIP-0037', title: 'Linear L2 issuance', detail: 'issuanceRate replaced by linear issuancePerBlock; native L2 minting + L2 Mint Allowance protection.' },
  { date: 'Sep 2023', title: '50% rewards on L2', detail: 'GIP-0052 staged the L2 reward share 5% → 25% → 50%.' },
  { date: '28 Jun 2024', title: '100% rewards on L2', detail: 'L1 issuancePerBlock reduced to zero; all indexing rewards now issued on Arbitrum.' },
  { date: 'Dec 2024', title: 'L1 deprecated', detail: 'GIP-0067 completed: mainnet protocol deprecated (not destroyed — token & bridge persist).' },
  { date: '2 Dec 2025', title: 'Horizon live', detail: 'GIP-0066 on Arbitrum mainnet: HorizonStaking, SubgraphService, generalized payments layer.' },
];

export interface RatePoint {
  period: string;
  rate: number; // annualized issuance %
  note?: string;
}

export const ISSUANCE_RATE_HISTORY: RatePoint[] = [
  { period: 'Q4 2024', rate: 2.76 },
  { period: 'Q1 2025', rate: 2.84 },
  { period: 'Q2 2025', rate: 1.05, note: 'outlier window (measurement, not a parameter change)' },
  { period: 'Q3 2025', rate: 2.79 },
  { period: 'Q4 2025', rate: 2.77 },
];

export interface GipRow {
  id: string;
  title: string;
}

export const KEY_GIPS: GipRow[] = [
  { id: 'GIP-0031', title: 'Arbitrum GRT bridge (lock-and-mint, BridgeEscrow)' },
  { id: 'GIP-0037', title: 'L2 linear rewards + L2 Mint Allowance' },
  { id: 'GIP-0040', title: 'Protocol deployment to Arbitrum One' },
  { id: 'GIP-0052', title: 'Staged L2 reward share 5% → 100%' },
  { id: 'GIP-0067', title: 'Deprecation of the L1 protocol' },
  { id: 'GIP-0066', title: 'Graph Horizon' },
  { id: 'GIP-0070', title: 'Horizon-era issuance/curation redesign' },
  { id: 'GIP-0087/0088', title: 'On-chain indexing agreements + Issuance Allocator' },
];

export const CAVEATS: string[] = [
  '“Total supply” is reported inconsistently across sources: retail aggregators show circulating supply (~10.8B), the Graph Explorer shows on-chain token supply (~11.47B), and “minted” (~15.1B) is gross cumulative issuance including the 10B genesis.',
  'On the Arbitrum subgraph, gross Minted/Burned are dominated by bridge flows (every L2 deposit mints, every withdrawal burns) — they are NOT a clean issuance/burn measure. Cumulative indexing rewards and the per-block issuance rate are the honest issuance figures.',
  'Realized burn has historically run well below the ~1%/yr design target, because query-fee and curation activity were low relative to issuance — so net inflation tracks close to gross issuance.',
  'A complete supply trace must still read L1 totalSupply and the BridgeEscrow balance: the L1 protocol is deprecated, not destroyed.',
  'If GIP-0070/0087/0088 ship an Issuance Allocator distributing issuance beyond indexing rewards, that contract becomes a new emission node. GIP-0070 expects >99% of issuance to remain in Indexing Rewards initially.',
];
