import { describe, it, expect } from 'vitest';
import { buildActivityFeed } from '../subgraph-activity';

const WEI = '1000000000000000000'; // 1 GRT

const versions = [
  { version: 1, label: '0.0.2', createdAt: 200, ipfsHash: 'QmB' },
  { version: 0, label: null, createdAt: 100, ipfsHash: 'QmA' },
];
const signals = [
  { curatorAddress: '0xcur1', lastSignalChange: 150, signalledTokens: WEI },
  { curatorAddress: '0xcur2', lastSignalChange: 0, signalledTokens: WEI }, // never changed → skipped
];

describe('buildActivityFeed', () => {
  it('merges versions and signals into one reverse-chronological timeline', () => {
    const feed = buildActivityFeed(versions, signals);
    expect(feed.map((e) => e.ts)).toEqual([200, 150, 100]); // desc, the ts=0 signal dropped
  });

  it('labels version events, falling back to v{n} when no semver label', () => {
    const feed = buildActivityFeed(versions, []);
    expect(feed[0]).toMatchObject({ kind: 'version', label: '0.0.2' });
    expect(feed[1]).toMatchObject({ kind: 'version', label: 'v0' });
  });

  it('converts signal wei to GRT', () => {
    const feed = buildActivityFeed([], signals);
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ kind: 'signal', curator: '0xcur1', signalledGrt: 1 });
  });

  it('skips signals that never changed (lastSignalChange = 0)', () => {
    const feed = buildActivityFeed([], signals);
    expect(feed.every((e) => e.kind !== 'signal' || e.curator !== '0xcur2')).toBe(true);
  });

  it('caps the feed at the given limit', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ version: i, label: null, createdAt: i, ipfsHash: `Qm${i}` }));
    expect(buildActivityFeed(many, [], 10)).toHaveLength(10);
  });

  it('returns an empty feed for no inputs', () => {
    expect(buildActivityFeed([], [])).toEqual([]);
  });
});
