import { describe, it, expect } from 'vitest';
import {
  PROTOCOLS,
  getProtocol,
  POLYMARKET_OI_DEPLOYMENT,
  POLYMARKET_MAIN_DEPLOYMENT,
  POLYMARKET_RESOLUTION_DEPLOYMENT,
} from '../config';

describe('getProtocol', () => {
  it('returns the matching config by slug', () => {
    const p = getProtocol('uniswap-v3');
    expect(p).toBeDefined();
    expect(p!.name).toBe('Uniswap V3');
    expect(p!.schemaType).toBe('uniswap-v3');
  });

  it('returns undefined for an unknown slug', () => {
    expect(getProtocol('not-a-real-protocol')).toBeUndefined();
  });
});

describe('PROTOCOLS registry invariants', () => {
  it('has unique slugs', () => {
    const slugs = PROTOCOLS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('has unique subgraph ids', () => {
    const ids = PROTOCOLS.map((p) => p.subgraphId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('requires familyLabel whenever family is set', () => {
    const offenders = PROTOCOLS.filter((p) => p.family && !p.familyLabel).map((p) => p.slug);
    expect(offenders).toEqual([]);
  });

  it('gives every entry a non-empty name, description, website and at least one chain', () => {
    for (const p of PROTOCOLS) {
      expect(p.name.length, p.slug).toBeGreaterThan(0);
      expect(p.description.length, p.slug).toBeGreaterThan(0);
      expect(p.website.startsWith('http'), p.slug).toBe(true);
      expect(p.chains.length, p.slug).toBeGreaterThan(0);
    }
  });

  it('uses a hex colour for every entry', () => {
    for (const p of PROTOCOLS) {
      expect(p.color, p.slug).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('only ever sets knownIssueAffects to fees or volume', () => {
    for (const p of PROTOCOLS) {
      if (p.knownIssueAffects !== undefined) {
        expect(['fees', 'volume']).toContain(p.knownIssueAffects);
      }
    }
  });

  it('groups family members under a shared familyLabel', () => {
    const aave3 = PROTOCOLS.filter((p) => p.family === 'aave-v3');
    expect(aave3.length).toBeGreaterThan(1);
    expect(new Set(aave3.map((p) => p.familyLabel))).toEqual(new Set(['Aave V3']));
  });

  it('only uses known schemaType values', () => {
    const known = new Set([
      'messari-dex', 'messari-lending', 'messari-rwa', 'messari-staking',
      'messari-yield', 'messari-bridge', 'messari-perp', 'gmx-v2-synthetics',
      'balancer-v2', 'uniswap-v2', 'uniswap-v3', 'algebra-v1',
      'etherfi-native', 'polymarket',
    ]);
    for (const p of PROTOCOLS) {
      expect(known.has(p.schemaType), `${p.slug} -> ${p.schemaType}`).toBe(true);
    }
  });

  it('only uses known category values', () => {
    const known = new Set([
      'DEX', 'Lending', 'Liquid Staking', 'Yield Aggregator',
      'Prediction Markets', 'Bridge', 'RWA', 'Perpetuals',
    ]);
    for (const p of PROTOCOLS) {
      expect(known.has(p.category), `${p.slug} -> ${p.category}`).toBe(true);
    }
  });
});

describe('Polymarket deployment hashes', () => {
  it('exports distinct IPFS deployment hashes', () => {
    const hashes = [POLYMARKET_OI_DEPLOYMENT, POLYMARKET_MAIN_DEPLOYMENT, POLYMARKET_RESOLUTION_DEPLOYMENT];
    hashes.forEach((h) => expect(h).toMatch(/^Qm/));
    expect(new Set(hashes).size).toBe(3);
  });
});
