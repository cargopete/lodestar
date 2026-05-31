import { describe, it, expect } from 'vitest';
import { getTradeUrl } from '../trade-urls';

const TOKEN_IN = '0xAAAaAAAaAAAAAAAaAAaaAAAAaAaAAaaAaaAa0001';
const TOKEN_OUT = '0xBBBbBBBbBBbBbbBBbBbBBBbbBBbbBbbBbbBb0002';

describe('getTradeUrl', () => {
  it('returns null for an unknown protocol', () => {
    expect(getTradeUrl('frax-swap', 'mainnet', TOKEN_IN, TOKEN_OUT)).toBeNull();
  });

  it('lowercases token addresses in the produced URL', () => {
    const r = getTradeUrl('uniswap-v3', 'mainnet', TOKEN_IN, TOKEN_OUT);
    expect(r).not.toBeNull();
    expect(r!.url).toContain(TOKEN_IN.toLowerCase());
    expect(r!.url).toContain(TOKEN_OUT.toLowerCase());
    expect(r!.url).not.toContain('AAAa');
  });

  it('matches any uniswap* protocol via startsWith and maps the chain param', () => {
    const r = getTradeUrl('uniswap-v3', 'arbitrum', TOKEN_IN, TOKEN_OUT);
    expect(r).toEqual({
      url: `https://app.uniswap.org/#/swap?inputCurrency=${TOKEN_IN.toLowerCase()}&outputCurrency=${TOKEN_OUT.toLowerCase()}&chain=arbitrum`,
      venue: 'app.uniswap.org',
    });
  });

  it('falls back to mainnet for an unknown chain on uniswap', () => {
    const r = getTradeUrl('uniswap-v2', 'fantom', TOKEN_IN, TOKEN_OUT);
    expect(r!.url).toContain('chain=mainnet');
  });

  it('handles uppercase protocol names (case-insensitive)', () => {
    const r = getTradeUrl('UNISWAP', 'base', TOKEN_IN, TOKEN_OUT);
    expect(r!.venue).toBe('app.uniswap.org');
    expect(r!.url).toContain('chain=base');
  });

  it.each(['sushiswap', 'sushi', 'sushi_v2', 'sushi_v3'])(
    'routes %s to sushi.com',
    (proto) => {
      const r = getTradeUrl(proto, 'mainnet', TOKEN_IN, TOKEN_OUT);
      expect(r!.venue).toBe('sushi.com');
      expect(r!.url).toContain(`token0=${TOKEN_IN.toLowerCase()}`);
      expect(r!.url).toContain(`token1=${TOKEN_OUT.toLowerCase()}`);
    },
  );

  it('maps balancer mainnet to the ethereum path segment', () => {
    const r = getTradeUrl('balancer', 'mainnet', TOKEN_IN, TOKEN_OUT);
    expect(r!.venue).toBe('balancer.fi');
    expect(r!.url).toBe(
      `https://balancer.fi/ethereum/swap/${TOKEN_IN.toLowerCase()}/${TOKEN_OUT.toLowerCase()}`,
    );
  });

  it('keeps non-mainnet chain segment for balancer', () => {
    const r = getTradeUrl('balancer_v2', 'polygon', TOKEN_IN, TOKEN_OUT);
    expect(r!.url).toContain('balancer.fi/polygon/swap/');
  });

  it.each(['pancakeswap', 'pancake_v3'])('routes %s to pancakeswap', (proto) => {
    const r = getTradeUrl(proto, 'mainnet', TOKEN_IN, TOKEN_OUT);
    expect(r!.venue).toBe('pancakeswap.finance');
    expect(r!.url).toContain(`inputCurrency=${TOKEN_IN.toLowerCase()}`);
  });

  it.each(['curve', 'curvefi'])('routes %s to a static curve URL', (proto) => {
    const r = getTradeUrl(proto, 'mainnet', TOKEN_IN, TOKEN_OUT);
    expect(r).toEqual({ url: 'https://curve.fi/#/ethereum/swap', venue: 'curve.fi' });
  });

  it('routes cow with the chain-id-1 path', () => {
    const r = getTradeUrl('cow', 'mainnet', TOKEN_IN, TOKEN_OUT);
    expect(r!.venue).toBe('swap.cow.fi');
    expect(r!.url).toBe(
      `https://swap.cow.fi/#/1/swap/${TOKEN_IN.toLowerCase()}/${TOKEN_OUT.toLowerCase()}`,
    );
  });

  it('routes aerodrome with from/to params', () => {
    const r = getTradeUrl('aerodrome', 'base', TOKEN_IN, TOKEN_OUT);
    expect(r!.venue).toBe('aerodrome.finance');
    expect(r!.url).toContain(`from=${TOKEN_IN.toLowerCase()}`);
    expect(r!.url).toContain(`to=${TOKEN_OUT.toLowerCase()}`);
  });

  it.each(['kyber_elastic', 'kyberswap'])('routes %s to kyberswap', (proto) => {
    const r = getTradeUrl(proto, 'mainnet', TOKEN_IN, TOKEN_OUT);
    expect(r!.venue).toBe('kyberswap.com');
    expect(r!.url).toContain(
      `${TOKEN_IN.toLowerCase()}-to-${TOKEN_OUT.toLowerCase()}`,
    );
  });

  it('routes dodo and bancor to their static exchange pages', () => {
    expect(getTradeUrl('dodo', 'mainnet', TOKEN_IN, TOKEN_OUT)).toEqual({
      url: 'https://app.dodoex.io/exchange',
      venue: 'dodoex.io',
    });
    expect(getTradeUrl('bancor', 'mainnet', TOKEN_IN, TOKEN_OUT)).toEqual({
      url: 'https://app.bancor.network/trade',
      venue: 'bancor.network',
    });
  });
});
