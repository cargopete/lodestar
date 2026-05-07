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
}

const TRUSTWALLET_CHAIN: Record<string, string> = {
  mainnet: 'ethereum',
  arbitrum: 'arbitrum',
  base: 'base',
  polygon: 'polygon',
  optimism: 'optimism',
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
    try {
      const checksum = getAddress(contract);
      const tw = TRUSTWALLET_CHAIN[chain ?? 'mainnet'] ?? 'ethereum';
      out.push(`https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${tw}/assets/${checksum}/logo.png`);
    } catch {}
  }
  return out;
}

export function TokenIcon({ symbol, contract, logoUri, slug, chain = 'mainnet', size = 28, className }: Props) {
  const sources = useMemo(() => buildSourceChain(logoUri, slug, contract, chain), [logoUri, slug, contract, chain]);
  const [sourceIdx, setSourceIdx] = useState(0);
  const exhausted = sourceIdx >= sources.length;

  const [bg, fg] = FALLBACK_PALETTE[symbolHash(symbol) % FALLBACK_PALETTE.length];
  const initials = symbol.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();

  return (
    <div
      className={`relative rounded-full overflow-hidden border-[0.5px] border-[var(--border)] flex items-center justify-center shrink-0 ${className ?? ''}`}
      style={{ width: size, height: size, background: exhausted ? `linear-gradient(135deg, ${bg}, ${fg})` : 'var(--bg-elevated)' }}
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
