'use client';

/**
 * Tiny chain logo for places where we mention the chain a row's data
 * lives on (e.g. cross-chain Aave V3 markets table). Pulls from web3icons
 * via jsdelivr — same CDN we use for token icons, so no new dependency.
 */
type ChainKey = 'mainnet' | 'arbitrum' | 'base' | 'polygon' | 'optimism';

const SLUG: Record<ChainKey, string> = {
  mainnet: 'ethereum',
  arbitrum: 'arbitrum-one',
  base: 'base',
  polygon: 'polygon',
  optimism: 'optimism',
};

interface Props {
  chain: ChainKey;
  size?: number;
  className?: string;
}

export function ChainIcon({ chain, size = 14, className = '' }: Props) {
  const slug = SLUG[chain];
  if (!slug) return null;
  // White backplate keeps dark glyphs (Ethereum diamond, Arbitrum mark)
  // visible on the page's purple-tinted dark background. The inner glyph
  // is held to ~70% of the circle so square logos (Base, Optimism wordmark)
  // don't kiss the white edge — they were designed full-bleed and need
  // their own padding.
  const inner = Math.round(size * 0.7);
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full bg-white shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      <img
        src={`https://cdn.jsdelivr.net/gh/0xa3k5/web3icons@main/raw-svgs/networks/branded/${slug}.svg`}
        alt=""
        width={inner}
        height={inner}
        loading="lazy"
      />
    </span>
  );
}
