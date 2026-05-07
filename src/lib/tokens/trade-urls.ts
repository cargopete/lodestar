/**
 * Per-protocol "trade now" URL builder. Routes a (protocol, chain, tokenIn,
 * tokenOut) tuple to the venue's swap interface, deep-linked with the pair
 * pre-selected so the user lands on a quoted, actionable page.
 *
 * Returning null means we don't have a deep link for this venue yet; the
 * caller should fall back to plain text or a non-actionable surface.
 */

const UNI_CHAIN_PARAM: Record<string, string> = {
  mainnet: 'mainnet',
  arbitrum: 'arbitrum',
  base: 'base',
  polygon: 'polygon',
  optimism: 'optimism',
};

export function getTradeUrl(
  protocol: string,
  chain: string,
  tokenIn: string,
  tokenOut: string
): { url: string; venue: string } | null {
  const inAddr = tokenIn.toLowerCase();
  const outAddr = tokenOut.toLowerCase();
  const proto = protocol.toLowerCase();

  if (proto.startsWith('uniswap')) {
    const c = UNI_CHAIN_PARAM[chain] ?? 'mainnet';
    return {
      url: `https://app.uniswap.org/#/swap?inputCurrency=${inAddr}&outputCurrency=${outAddr}&chain=${c}`,
      venue: 'app.uniswap.org',
    };
  }
  if (proto === 'sushiswap' || proto === 'sushi' || proto === 'sushi_v2' || proto === 'sushi_v3') {
    return {
      url: `https://www.sushi.com/swap?token0=${inAddr}&token1=${outAddr}`,
      venue: 'sushi.com',
    };
  }
  if (proto === 'balancer' || proto === 'balancer_v2' || proto === 'balancer_v3') {
    const c = chain === 'mainnet' ? 'ethereum' : chain;
    return {
      url: `https://balancer.fi/${c}/swap/${inAddr}/${outAddr}`,
      venue: 'balancer.fi',
    };
  }
  if (proto === 'pancakeswap' || proto === 'pancake_v3') {
    return {
      url: `https://pancakeswap.finance/swap?inputCurrency=${inAddr}&outputCurrency=${outAddr}`,
      venue: 'pancakeswap.finance',
    };
  }
  if (proto === 'curve' || proto === 'curvefi') {
    return { url: 'https://curve.fi/#/ethereum/swap', venue: 'curve.fi' };
  }
  if (proto === 'cow') {
    return {
      url: `https://swap.cow.fi/#/1/swap/${inAddr}/${outAddr}`,
      venue: 'swap.cow.fi',
    };
  }
  if (proto === 'aerodrome') {
    return {
      url: `https://aerodrome.finance/swap?from=${inAddr}&to=${outAddr}`,
      venue: 'aerodrome.finance',
    };
  }
  if (proto === 'kyber_elastic' || proto === 'kyberswap') {
    return {
      url: `https://kyberswap.com/swap/ethereum/${inAddr}-to-${outAddr}`,
      venue: 'kyberswap.com',
    };
  }
  if (proto === 'dodo') {
    return { url: 'https://app.dodoex.io/exchange', venue: 'dodoex.io' };
  }
  if (proto === 'bancor') {
    return { url: 'https://app.bancor.network/trade', venue: 'bancor.network' };
  }
  return null;
}
