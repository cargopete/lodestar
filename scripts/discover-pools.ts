#!/usr/bin/env tsx
/**
 * One-shot discovery script that turns a list of token contracts + metadata
 * into ready-to-paste seed entries. Queries the Uniswap V3 mainnet subgraph
 * for each token's `whitelistPools` ordered by TVL and picks the best
 * WETH-paired or USDC-paired pool.
 *
 * Run with:  GRAPH_API_KEY=<key> tsx scripts/discover-pools.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Load .env manually (no dotenv dep). Naive parser handles KEY=value lines.
try {
  const env = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

const SG_ID = '5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV';

interface Candidate {
  contract: string;
  symbol: string;
  iconSlug?: string;
  website: string;
  tags: string[];
  altContracts?: Record<string, string>;
}

const CANDIDATES: Candidate[] = [
  // === Stablecoins ===
  { contract: '0xdac17f958d2ee523a2206206994597c13d831ec7', symbol: 'USDT', iconSlug: 'usdt', website: 'https://tether.to', tags: ['Stablecoin'], altContracts: { arbitrum: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', polygon: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f' } },
  { contract: '0x6b175474e89094c44da98b954eedeac495271d0f', symbol: 'DAI', iconSlug: 'dai', website: 'https://makerdao.com', tags: ['Stablecoin'], altContracts: { arbitrum: '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1', polygon: '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063' } },
  { contract: '0x853d955acef822db058eb8505911ed77f175b99e', symbol: 'FRAX', iconSlug: 'frax', website: 'https://frax.finance', tags: ['Stablecoin'] },
  { contract: '0xc5f0f7b66764f6ec8c8dff7ba683102295e16409', symbol: 'FDUSD', iconSlug: 'fdusd', website: 'https://firstdigitallabs.com', tags: ['Stablecoin'] },
  { contract: '0x6c3ea9036406852006290770bedfcaba0e23a0e8', symbol: 'PYUSD', iconSlug: 'pyusd', website: 'https://www.paypal.com/pyusd', tags: ['Stablecoin'] },
  { contract: '0x5f98805a4e8be255a32880fdec7f6728c6568ba0', symbol: 'LUSD', iconSlug: 'lusd', website: 'https://www.liquity.org', tags: ['Stablecoin'] },
  { contract: '0xf17e65822b568b3903685a7c9f496cf7656cc6c2', symbol: 'GHO', iconSlug: 'gho', website: 'https://gho.aave.com', tags: ['Stablecoin'] },
  { contract: '0xf939e0a03fb07f59a73314e73794be0e57ac1b4e', symbol: 'crvUSD', iconSlug: 'crvusd', website: 'https://crvusd.curve.fi', tags: ['Stablecoin'] },
  { contract: '0x4d224452801aced8b2f0aebe155379bb5d594381', symbol: 'APE', iconSlug: 'ape', website: 'https://apecoin.com', tags: ['Governance'] },

  // === Liquid (re)staking ===
  { contract: '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0', symbol: 'wstETH', iconSlug: 'wsteth', website: 'https://lido.fi', tags: ['LST'], altContracts: { arbitrum: '0x5979d7b546e38e414f7e9822514be443a4800529', base: '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452', polygon: '0x03b54a6e9a984069379fae1a4fc4dbae93b3bccd' } },
  { contract: '0xae78736cd615f374d3085123a210448e74fc6393', symbol: 'rETH', iconSlug: 'reth', website: 'https://www.rocketpool.net', tags: ['LST'], altContracts: { arbitrum: '0xec70dcb4a1efa46b8f2d97c310c9c4790ba5ffa8', base: '0xb6fe221fe9eef5aba221c348ba20a1bf5e73624c' } },
  { contract: '0xbe9895146f7af43049ca1c1ae358b0541ea49704', symbol: 'cbETH', iconSlug: 'cbeth', website: 'https://www.coinbase.com/cbeth', tags: ['LST'], altContracts: { base: '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22' } },
  { contract: '0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee', symbol: 'weETH', iconSlug: 'weeth', website: 'https://www.ether.fi', tags: ['LST'], altContracts: { arbitrum: '0x35751007a407ca6feffe80b3cb397736d2cf4dbe', base: '0x04c0599ae5a44757c0af6f9ec3b93da8976c150a' } },
  { contract: '0xbf5495efe5db9ce00f80364c8b423567e58d2110', symbol: 'ezETH', iconSlug: 'ezeth', website: 'https://www.renzoprotocol.com', tags: ['LST'] },
  { contract: '0xac3e018457b222d93114458476f3e3416abbe38f', symbol: 'sfrxETH', iconSlug: 'sfrxeth', website: 'https://frax.finance', tags: ['LST'] },

  // === DEX / DeFi protocols ===
  { contract: '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2', symbol: 'SUSHI', iconSlug: 'sushi', website: 'https://www.sushi.com', tags: ['DEX', 'Governance'] },
  { contract: '0x111111111117dc0aa78b770fa6a738034120c302', symbol: '1INCH', iconSlug: '1inch', website: 'https://1inch.io', tags: ['DEX', 'Governance'] },
  { contract: '0xba100000625a3754423978a60c9317c58a424e3d', symbol: 'BAL', iconSlug: 'bal', website: 'https://balancer.fi', tags: ['DEX', 'Governance'] },
  { contract: '0x808507121b80c02388fad14726482e061b8da827', symbol: 'PENDLE', iconSlug: 'pendle', website: 'https://www.pendle.finance', tags: ['DeFi'] },
  // GMX is Arbitrum-native (no mainnet ERC-20), drop here.
  { contract: '0xd33526068d116ce69f19a9ee46f0bd304f21a51f', symbol: 'RPL', iconSlug: 'rpl', website: 'https://www.rocketpool.net', tags: ['LST', 'Governance'] },
  { contract: '0x3432b6a60d23ca0dfca7761b7ab56459d9c964d0', symbol: 'FXS', iconSlug: 'fxs', website: 'https://frax.finance', tags: ['DEX', 'Governance'] },
  { contract: '0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f', symbol: 'SNX', iconSlug: 'snx', website: 'https://synthetix.io', tags: ['DeFi', 'Governance'] },
  { contract: '0x92d6c1e31e14520e676a687f0a93788b716beff5', symbol: 'DYDX', iconSlug: 'dydx', website: 'https://dydx.exchange', tags: ['DEX', 'Governance'] },
  { contract: '0x57e114b691db790c35207b2e685d4a43181e6061', symbol: 'ENA', iconSlug: 'ena', website: 'https://ethena.fi', tags: ['Stablecoin', 'Governance'] },
  { contract: '0xfe18be6b3bd88a2d2a7f928d00292e7a9963cfc6', symbol: 'sUSDe', iconSlug: 'susde', website: 'https://ethena.fi', tags: ['Stablecoin'] },

  // === Layer-2 / infra tokens ===
  { contract: '0xb50721bcf8d664c30412cfbc6cf7a15145234ad1', symbol: 'ARB', iconSlug: 'arb', website: 'https://arbitrum.foundation', tags: ['Infrastructure', 'Governance'], altContracts: { arbitrum: '0x912ce59144191c1204e64559fe8253a0e49e6548' } },
  { contract: '0x4200000000000000000000000000000000000042', symbol: 'OP', iconSlug: 'op', website: 'https://optimism.io', tags: ['Infrastructure', 'Governance'] },
  { contract: '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0', symbol: 'MATIC', iconSlug: 'matic', website: 'https://polygon.technology', tags: ['Infrastructure'] },
  { contract: '0xaf5191b0de278c7286d6c7cc6ab6bb8a73ba2cd6', symbol: 'STG', iconSlug: 'stg', website: 'https://stargate.finance', tags: ['DEX', 'Governance'] },

  // === Memecoins ===
  { contract: '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce', symbol: 'SHIB', iconSlug: 'shib', website: 'https://shibatoken.com', tags: ['Memecoin'] },
  { contract: '0xcf0c122c6b73ff809c693db761e7baebe62b6a2e', symbol: 'FLOKI', iconSlug: 'floki', website: 'https://www.floki.com', tags: ['Memecoin'] },

  // === Gaming/metaverse ===
  { contract: '0x3845badade8e6dff049820680d1f14bd3903a5d0', symbol: 'SAND', iconSlug: 'sand', website: 'https://www.sandbox.game', tags: ['Memecoin'] },
  { contract: '0x0f5d2fb29fb7d3cfee444a200298f468908cc942', symbol: 'MANA', iconSlug: 'mana', website: 'https://decentraland.org', tags: ['Memecoin'] },
  { contract: '0xbb0e17ef65f82ab018d8edd776e8dd940327b28b', symbol: 'AXS', iconSlug: 'axs', website: 'https://axieinfinity.com', tags: ['Memecoin', 'Governance'] },
  { contract: '0xf57e7e7c23978c3caec3c3548e3d615c346e79ff', symbol: 'IMX', iconSlug: 'imx', website: 'https://www.immutable.com', tags: ['Infrastructure'] },

  // === Misc ===
  { contract: '0x0d8775f648430679a709e98d2b0cb6250d2887ef', symbol: 'BAT', iconSlug: 'bat', website: 'https://basicattentiontoken.org', tags: ['Governance'] },
  { contract: '0x6810e776880c02933d47db1b9fc05908e5386b96', symbol: 'GNO', iconSlug: 'gno', website: 'https://www.gnosis.io', tags: ['Infrastructure', 'Governance'] },
  { contract: '0x5afe3855358e112b5647b952709e6165e1c1eeee', symbol: 'SAFE', iconSlug: 'safe', website: 'https://safe.global', tags: ['Infrastructure', 'Governance'] },
  { contract: '0x163f8c2467924be0ae7b5347228cabf260318753', symbol: 'WLD', iconSlug: 'wld', website: 'https://worldcoin.org', tags: ['Identity'] },
  { contract: '0xfe0c30065b384f05761f15d0cc899d4f9f9cc0eb', symbol: 'ETHFI', iconSlug: 'ethfi', website: 'https://www.ether.fi', tags: ['LST', 'Governance'] },
];

interface PoolHit {
  poolId: string;
  feeTier: string;
  counterparty: string;
  counterpartySymbol: string;
  tvl: number;
}

async function discover(): Promise<void> {
  const apiKey = process.env.GRAPH_API_KEY;
  if (!apiKey) throw new Error('GRAPH_API_KEY not set');
  const url = `https://gateway-arbitrum.network.thegraph.com/api/${apiKey}/subgraphs/id/${SG_ID}`;

  // Batched query: ask for whitelistPools per token in one round trip.
  const ids = CANDIDATES.map((c) => c.contract.toLowerCase());
  const query = `{
    tokens(where: { id_in: ${JSON.stringify(ids)} }) {
      id
      symbol
      whitelistPools(first: 8, orderBy: totalValueLockedUSD, orderDirection: desc) {
        id
        feeTier
        totalValueLockedUSD
        token0 { id symbol }
        token1 { id symbol }
      }
    }
  }`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  interface SubgraphPool {
    id: string;
    feeTier: string;
    totalValueLockedUSD: string;
    token0: { id: string; symbol: string };
    token1: { id: string; symbol: string };
  }
  interface SubgraphToken {
    id: string;
    symbol: string;
    whitelistPools: SubgraphPool[];
  }
  const json: { data?: { tokens?: SubgraphToken[] }; errors?: unknown } = await res.json();
  if (json.errors) {
    console.error('GraphQL errors:', JSON.stringify(json.errors, null, 2));
    return;
  }
  const tokens = json.data?.tokens ?? [];
  const byId = new Map<string, SubgraphToken>();
  for (const t of tokens) byId.set(String(t.id).toLowerCase(), t);

  const out: string[] = [];
  for (const c of CANDIDATES) {
    const lower = c.contract.toLowerCase();
    const t = byId.get(lower);
    if (!t) {
      console.warn(`[skip] ${c.symbol}: not whitelisted in Uniswap V3 mainnet`);
      continue;
    }
    // Find the highest-TVL pool whose other side is WETH or USDC.
    let best: PoolHit | undefined;
    for (const p of t.whitelistPools) {
      const other = p.token0.id.toLowerCase() === lower ? p.token1 : p.token0;
      const otherId = String(other.id).toLowerCase();
      if (otherId === WETH || otherId === USDC) {
        const tvl = Number(p.totalValueLockedUSD ?? 0);
        if (!best || tvl > best.tvl) {
          best = { poolId: String(p.id).toLowerCase(), feeTier: p.feeTier, counterparty: otherId, counterpartySymbol: other.symbol, tvl };
        }
      }
    }
    if (!best) {
      console.warn(`[skip] ${c.symbol}: no WETH/USDC-paired pool in whitelist`);
      continue;
    }
    const inverse = lower > best.counterparty;
    const quote = best.counterparty === USDC ? 'usd' : 'eth';
    const altLine = c.altContracts && Object.keys(c.altContracts).length
      ? `    altContracts: ${JSON.stringify(c.altContracts).replace(/"([^"]+)":/g, '$1:')},\n`
      : '';
    const tagLine = `    tags: [${c.tags.map((t) => `'${t}'`).join(', ')}],\n`;
    const iconLine = c.iconSlug ? `    iconSlug: '${c.iconSlug}',\n` : '';
    out.push(`  {
    contract: '${lower}',
    symbol: '${c.symbol}',
    chain: 'mainnet',
    pool: {
      // Uniswap V3 ${c.symbol}/${best.counterpartySymbol} ${(Number(best.feeTier) / 10000).toFixed(2)}% (TVL $${best.tvl.toFixed(0)})
      address: '${best.poolId}',
      quote: '${quote}',
      inverse: ${inverse},
    },
${iconLine}    website: '${c.website}',
${tagLine}${altLine}  },`);
  }

  console.log(`// ${out.length} new seed entries (of ${CANDIDATES.length} candidates)`);
  console.log(out.join('\n'));
}

discover().catch((e) => {
  console.error(e);
  process.exit(1);
});
