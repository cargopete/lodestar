'use client';

import { useState, useMemo } from 'react';

/**
 * Protocol / network logo with a graceful fallback chain. Pattern adapted
 * from lodestar-tokens-proto's TokenIcon, but the URL construction lives in
 * `buildProtocolSources` / `buildNetworkSources` because web3icons stores
 * brand assets across three folders with different casing conventions:
 *
 *   - raw-svgs/tokens/branded/<UPPERCASE>.svg     (governance tokens, AAVE/COMP/CRV/...)
 *   - raw-svgs/exchanges/branded/<lowercase>.svg  (DEX brands without a token, balancer/uniswap)
 *   - raw-svgs/networks/branded/<lowercase>.svg   (chains, ethereum/polygon/arbitrum-one)
 *
 * Each protocol has a different combination, so callers pass a pre-built
 * source list and the component just iterates through it on error, falling
 * back to a colour-circle with initials when the chain is exhausted.
 */
interface Props {
  /** Display name -- used for accessibility + fallback initials. */
  name: string;
  /** Pre-built ordered list of CDN URLs to try. */
  sources: string[];
  /** Hex colour from ProtocolConfig -- final-fallback circle background. */
  color?: string;
  size?: number;
  className?: string;
}

const CDN_BASE = 'https://cdn.jsdelivr.net/gh/0xa3k5/web3icons@main/raw-svgs';

/**
 * Manual mapping for protocol families/slugs whose logo lives somewhere other
 * than the auto-derived first-word path. Most major DeFi tokens are in
 * tokens/branded/ under their ticker, so we map slug → ticker here.
 */
const PROTOCOL_TOKEN_TICKERS: Record<string, string> = {
  'aave-v3': 'AAVE',
  'aave-v2': 'AAVE',
  'aave': 'AAVE',
  'compound-v3': 'COMP',
  'compound-v2': 'COMP',
  'compound': 'COMP',
  'uniswap-v3': 'UNI',
  'uniswap-v2': 'UNI',
  'curve': 'CRV',
  'lido': 'LDO',
  'makerdao': 'MKR',
  'liquity-v1': 'LQTY',
  'venus-bsc': 'XVS',
  'moonwell-base': 'WELL',
  'pancakeswap-v3': 'CAKE',
  'gmx-v2-arbitrum': 'GMX',
  'kwenta': 'KWENTA',
  'velodrome-v2': 'VELO',
  'rocket-pool': 'RPL',
  'yearn-v2': 'YFI',
  'stargate': 'STG',
  'axelar': 'AXL',
  'pendle': 'PENDLE',
  'camelot-v3': 'GRAIL',
  'inverse-finance': 'INV',
  'abracadabra': 'SPELL',
  'polymarket': 'POLY',
  // Spark Lend uses DAI as its visual identity (the primary asset users
  // interact with through the Sky / MakerDAO ecosystem). MKR also works
  // but DAI is the asset most users associate with Spark.
  'spark-lend': 'DAI',
  // Bridges: use the destination-chain icon when no native token exists.
  'arbitrum-one-bridge': 'ARB',
  'optimism-bridge-v2': 'OP',
};

const PROTOCOL_EXCHANGE_SLUGS: Record<string, string> = {
  'balancer-v2': 'balancer',
  'uniswap-v3': 'uniswap',
  'uniswap-v2': 'uniswap',
};

/**
 * TrustWallet `assets` repo on GitHub stores token logos at
 * `blockchains/<chain>/assets/<checksum>/logo.png`. Used for protocols whose
 * tokens aren't in web3icons. Pattern matches lodestar-tokens-proto/TokenIcon.
 */
const PROTOCOL_TRUSTWALLET: Record<string, { chain: string; checksum: string }> = {
  'badger-dao':       { chain: 'ethereum',   checksum: '0x3472A5A71965499acd81997a54BBA8D852C6E53d' },
  'ether-fi':         { chain: 'ethereum',   checksum: '0xFe0c30065B384F05761f15d0CC899D4F9F9Cc0eB' },
  'goldfinch':        { chain: 'ethereum',   checksum: '0xdab396cCF3d84Cf2D07C4454e10C8A6F5b008D2b' },
  'benqi':            { chain: 'avalanchec', checksum: '0x8729438EB15e2C8B576fCc6AeCdA6A148776C0F5' },
  // Morpho's newer governance token (0x9994E35...) isn't in TrustWallet yet;
  // the legacy MORPHO contract logo is fine since the brand is identical.
  'morpho-blue':      { chain: 'ethereum',   checksum: '0x58D97B57BB95320F9a05dC918Aef65434969c2B2' },
  'aerodrome':        { chain: 'base',       checksum: '0x940181a94A35A4569E4529A3CDfB74e38FD98631' },
  'truefi':           { chain: 'ethereum',   checksum: '0x57e114B691Db790C35207b2e685D4A43181e6061' },
};

/** Network slug aliases for chains whose web3icons folder name differs from the casual chain name. */
const NETWORK_SLUG_MAP: Record<string, string> = {
  'Ethereum': 'ethereum',
  'Arbitrum': 'arbitrum-one',
  'Base': 'base',
  'Polygon': 'polygon',
  'Optimism': 'optimism',
  'Avalanche': 'avalanche',
  'Gnosis': 'gnosis',
  'Fantom': 'fantom',
  'BSC': 'binance-smart-chain',
  'Mantle': 'mantle',
  'Scroll': 'scroll',
};

/**
 * Build the ordered fallback URL list for a protocol logo. Tries the
 * branded token ticker first (when one is mapped), then an exchange-folder
 * lowercase slug, then any explicit overrides.
 */
export function buildProtocolSources(slugOrFamily: string): string[] {
  const out: string[] = [];
  const ticker = PROTOCOL_TOKEN_TICKERS[slugOrFamily];
  if (ticker) {
    out.push(`${CDN_BASE}/tokens/branded/${ticker}.svg`);
  }
  const exchange = PROTOCOL_EXCHANGE_SLUGS[slugOrFamily];
  if (exchange) {
    out.push(`${CDN_BASE}/exchanges/branded/${exchange}.svg`);
  }
  const tw = PROTOCOL_TRUSTWALLET[slugOrFamily];
  if (tw) {
    out.push(`https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${tw.chain}/assets/${tw.checksum}/logo.png`);
  }
  // Last-ditch: try the first slug segment as both a ticker and an exchange
  // slug. Catches new entries that haven't been added to the maps yet.
  const guessed = slugOrFamily.split('-')[0];
  out.push(`${CDN_BASE}/tokens/branded/${guessed.toUpperCase()}.svg`);
  out.push(`${CDN_BASE}/exchanges/branded/${guessed}.svg`);
  return out;
}

/** Build the ordered URL list for a chain logo. */
export function buildNetworkSources(chainName: string): string[] {
  const slug = NETWORK_SLUG_MAP[chainName] ?? chainName.toLowerCase().replace(/\s+/g, '-');
  return [
    `${CDN_BASE}/networks/branded/${slug}.svg`,
    `${CDN_BASE}/networks/mono/${slug}.svg`,
  ];
}

export function ProtocolLogo({ name, sources, color, size = 20, className }: Props) {
  const [sourceIdx, setSourceIdx] = useState(0);
  const exhausted = sourceIdx >= sources.length;

  const fallbackBg = color ?? '#6B7280';
  const initials = name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase();

  return (
    <div
      className={`rounded-full overflow-hidden border border-[var(--border)] flex items-center justify-center shrink-0 ${className ?? ''}`}
      style={{
        width: size,
        height: size,
        background: exhausted ? fallbackBg : 'var(--bg-elevated)',
      }}
    >
      {exhausted ? (
        <span
          className="text-white leading-none font-bold tracking-tight"
          style={{ fontSize: Math.max(7, Math.floor(size / 3)) }}
        >
          {initials}
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={sources[sourceIdx]}
          src={sources[sourceIdx]}
          alt={name}
          width={size}
          height={size}
          className="w-full h-full"
          onError={() => setSourceIdx((i) => i + 1)}
        />
      )}
    </div>
  );
}
