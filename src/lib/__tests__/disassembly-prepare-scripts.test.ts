import { describe, it, expect } from 'vitest';
import { pickPrepareScripts } from '../disassembly/build-sandbox';

describe('pickPrepareScripts', () => {
  it('returns nothing when there are no prepare-like scripts', () => {
    expect(pickPrepareScripts({ build: 'graph build', codegen: 'graph codegen' })).toEqual([]);
  });

  it('prefers prepare, then prep', () => {
    expect(pickPrepareScripts({ prep: 'x', prepare: 'y' })).toEqual(['prepare', 'prep']);
  });

  it('adds the first network-specific prepare script', () => {
    expect(pickPrepareScripts({ 'prepare:mainnet': 'm', 'prepare:arbitrum': 'a' })).toEqual(['prepare:mainnet']);
  });

  it('supports prepare-<network> dash form alongside plain prepare', () => {
    expect(pickPrepareScripts({ prepare: 'p', 'prepare-mainnet': 'm' })).toEqual(['prepare', 'prepare-mainnet']);
  });

  it('does not duplicate or pick build/deploy scripts', () => {
    const picked = pickPrepareScripts({ prepare: 'p', build: 'b', deploy: 'd' });
    expect(picked).toEqual(['prepare']);
  });
});
