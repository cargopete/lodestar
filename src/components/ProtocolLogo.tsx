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
  // Bridges: use the destination-chain icon when no native token exists.
  'arbitrum-one-bridge': 'ARB',
  'optimism-bridge-v2': 'OP',
};

const PROTOCOL_EXCHANGE_SLUGS: Record<string, string> = {
  'balancer-v2': 'balancer',
  'uniswap-v3': 'uniswap',
  'uniswap-v2': 'uniswap',
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
