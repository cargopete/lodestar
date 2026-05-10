'use client';

import { useState, useMemo } from 'react';
import { getAddress } from 'viem';

/**
 * Token icon with a graceful fallback chain:
 *   1. web3icons GitHub via jsdelivr (matches the slug Token API gives us)
 *   2. TrustWallet `assets` repo on GitHub (addressable by checksum contract)
 *   3. Deterministic colored gradient circle with the token's initials
 *
 * The fallback only renders when the chain has been exhausted, so we never
 * see the gradient peeking through a transparent SVG.
 */
interface Props {
  symbol: string;
  contract?: string;
  /** Logo URL pre-resolved server-side (e.g. from Uniswap's default token list). Tried first. */
  logoUri?: string | null;
  /** Lowercase web3icons slug from Token API metadata, if available. */
  slug?: string | null;
  /** Chain key — TrustWallet uses this in the path. */
  chain?: 'mainnet' | 'arbitrum' | 'base' | 'polygon' | 'optimism';
  size?: number;
  className?: string;
  /** Override the circle's background. Used when rendering as a protocol icon
   *  on top of a dark page background — passing `#fff` keeps dark glyphs
   *  (Aave dome, Uniswap shield) visible. Defaults to var(--bg-elevated). */
  bg?: string;
}

const TRUSTWALLET_CHAIN: Record<string, string> = {
  mainnet: 'ethereum',
  arbitrum: 'arbitrum',
  base: 'base',
  polygon: 'polygon',
  optimism: 'optimism',
};

// EVM chain IDs for the CDNs that key by numeric chain (DefiLlama, 1inch).
// Keep this aligned with TRUSTWALLET_CHAIN above.
const CHAIN_ID: Record<string, number> = {
  mainnet: 1,
  arbitrum: 42161,
  base: 8453,
  polygon: 137,
  optimism: 10,
};

const FALLBACK_PALETTE = [
  ['#3B82F6', '#1E40AF'],
  ['#A855F7', '#6B21A8'],
  ['#EC4899', '#9D174D'],
  ['#F59E0B', '#92400E'],
  ['#10B981', '#065F46'],
  ['#06B6D4', '#155E75'],
  ['#F43F5E', '#9F1239'],
  ['#84CC16', '#4D7C0F'],
];

function symbolHash(symbol: string): number {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) >>> 0;
  return h;
}

function buildSourceChain(
  logoUri: string | null | undefined,
  slug: string | null | undefined,
  contract: string | undefined,
  chain: string | undefined
): string[] {
  const out: string[] = [];
  if (logoUri) out.push(logoUri);
  if (slug) {
    out.push(`https://cdn.jsdelivr.net/gh/0xa3k5/web3icons@main/raw-svgs/tokens/branded/${slug.toUpperCase()}.svg`);
  }
  if (contract) {
    const lower = contract.toLowerCase();
    try {
      const checksum = getAddress(contract);
      const tw = TRUSTWALLET_CHAIN[chain ?? 'mainnet'] ?? 'ethereum';
      out.push(`https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${tw}/assets/${checksum}/logo.png`);
    } catch {}
    // DefiLlama's token-icons CDN keys by chain-id + lowercase address. Has
    // very wide coverage of tradable ERC-20s — useful as a fallback for
    // counterparty tokens we encounter via Recent Swaps but don't carry
    // in our 154-token seed set.
    const chainId = CHAIN_ID[chain ?? 'mainnet'];
    if (chainId) {
      out.push(`https://token-icons.llamao.fi/icons/tokens/${chainId}/${lower}?h=64`);
    }
    // 1inch's CDN — mainnet-only but extensive. Last resort before falling
    // back to the deterministic gradient initials.
    if ((chain ?? 'mainnet') === 'mainnet') {
      out.push(`https://tokens-data.1inch.io/images/${lower}.png`);
    }
  }
  return out;
}

export function TokenIcon({ symbol, contract, logoUri, slug, chain = 'mainnet', size = 28, className, bg: bgOverride }: Props) {
  const sources = useMemo(() => buildSourceChain(logoUri, slug, contract, chain), [logoUri, slug, contract, chain]);
  const [sourceIdx, setSourceIdx] = useState(0);
  const exhausted = sourceIdx >= sources.length;

  const [bg, fg] = FALLBACK_PALETTE[symbolHash(symbol) % FALLBACK_PALETTE.length];
  const initials = symbol.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
  const background = exhausted
    ? `linear-gradient(135deg, ${bg}, ${fg})`
    : bgOverride ?? 'var(--bg-elevated)';

  return (
    <div
      className={`relative rounded-full overflow-hidden border-[0.5px] border-[var(--border)] flex items-center justify-center shrink-0 ${className ?? ''}`}
      style={{ width: size, height: size, background }}
    >
      {exhausted ? (
        <span
          className="text-white drop-shadow-sm leading-none font-bold tracking-tight"
          style={{ fontSize: Math.max(8, Math.floor(size / 3.2)) }}
        >
          {initials}
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={sources[sourceIdx]}
          src={sources[sourceIdx]}
          alt={symbol}
          width={size}
          height={size}
          className="w-full h-full"
          onError={() => setSourceIdx((i) => i + 1)}
        />
      )}
    </div>
  );
}
