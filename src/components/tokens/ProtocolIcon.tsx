/**
 * Small protocol logo for CTAs that send users off-site (Aave, Uniswap,
 * Kyber, Hyperliquid, etc).
 *
 * Renders every protocol as a rounded-square tile of identical outer
 * dimensions so logos line up vertically when stacked in a column (e.g.
 * the Trade column of the Spot Pools table). Sources:
 *   - Aave / Uniswap: web3icons brand SVG (matches the AAVE / UNI token
 *     icon used on the directory) on a white tile so the glyph stays
 *     visible against the page's dark background.
 *   - Everyone else: DefiLlama's protocol icon CDN, which already returns
 *     full-bleed colored tiles.
 */
'use client';

interface Props {
  slug: string | null | undefined;
  size?: number;
  className?: string;
}

// web3icons SVG slugs for protocols whose governance token is also a seed
// in our directory — reusing the same asset keeps the protocol logo on
// the detail page identical to the token icon shown on the index.
const TOKEN_PROXY_SLUG: Record<string, string> = {
  uniswap: 'UNI',
  aave: 'AAVE',
};

export function ProtocolIcon({ slug, size = 14, className = '' }: Props) {
  if (!slug) return null;
  const baseSlug = slug.startsWith('aave-') ? 'aave' : slug.startsWith('uniswap-') ? 'uniswap' : slug;
  const proxyToken = TOKEN_PROXY_SLUG[baseSlug];

  const tileClass = `inline-flex items-center justify-center rounded-md overflow-hidden shrink-0 ${className}`;
  const boxStyle = { width: size, height: size } as const;

  if (proxyToken) {
    // White backplate so dark glyphs (Aave dome+eyes, Uniswap unicorn)
    // read against the page's dark surface. Inner img held to ~80% of
    // the tile so the brand mark doesn't kiss the rounded edge.
    const inner = Math.round(size * 0.8);
    return (
      <span className={`${tileClass} bg-white`} style={boxStyle}>
        <img
          src={`https://cdn.jsdelivr.net/gh/0xa3k5/web3icons@main/raw-svgs/tokens/branded/${proxyToken}.svg`}
          alt=""
          width={inner}
          height={inner}
          loading="lazy"
        />
      </span>
    );
  }

  // DefiLlama icons are already full-bleed colored tiles — no backplate
  // needed, just render the img directly inside the same outer box.
  const px = size * 2;
  return (
    <span className={tileClass} style={boxStyle}>
      <img
        src={`https://icons.llamao.fi/icons/protocols/${slug}?w=${px}&h=${px}`}
        alt=""
        width={size}
        height={size}
        loading="lazy"
      />
    </span>
  );
}

/**
 * Best-effort mapping from a free-form protocol name (Token API's
 * `pool.protocol` string) or a venue host (`trade.venue` from
 * `getTradeUrl`) to the DefiLlama icon slug for that protocol.
 *
 * The mapping is intentionally lenient — the same logo represents
 * Uniswap V2 / V3 / V4, Aave V2 / V3, etc., so we don't try to be
 * version-precise unless DefiLlama distinguishes them and the difference
 * matters visually.
 */
export function defiLlamaSlugFor(idOrVenue: string | null | undefined): string | null {
  if (!idOrVenue) return null;
  const s = idOrVenue.toLowerCase();
  if (s.includes('uniswap')) return 'uniswap';
  if (s.includes('sushi')) return 'sushiswap';
  if (s.includes('pancake')) return 'pancakeswap';
  if (s.includes('curve')) return 'curve-finance';
  if (s.includes('balancer')) return 'balancer-v2';
  if (s.includes('aave')) return 'aave';
  if (s.includes('kyber')) return 'kyberswap';
  if (s.includes('cow')) return 'cowswap';
  if (s.includes('aerodrome') || s.includes('velodrome')) return 'aerodrome-v1';
  if (s.includes('dodo')) return 'dodo';
  if (s.includes('bancor')) return 'bancor';
  if (s.includes('hyperliquid')) return 'hyperliquid';
  if (s.includes('1inch')) return '1inch-network';
  return null;
}
