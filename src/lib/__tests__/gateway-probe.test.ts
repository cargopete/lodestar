import { describe, it, expect } from 'vitest';
import {
  parseBadIndexers,
  classifyBadIndexer,
  badIndexerLabel,
  interpretGatewayResponse,
} from '../gateway-probe';

const PROBED_AT = '2026-07-08T00:00:00.000Z';

// The real message observed from the gateway for the down "exchangev3-wd" subgraph.
const REAL_BAD =
  'bad indexers: {0x2f09092aacd80196fc984908c5a9a7ab3ee4f1ce: BadResponse(no attestation: indexing_error), 0x550c1f4814a85aa10f5f061ca8c45e2ee9620226: Unavailable(too far behind), 0x63c9dc729ba7a22bb8605216b24a34b902e5fe94: Unavailable(too far behind), 0xf00f7157fa8fd0420b87956d46058a16b2f23adc: BadResponse(no attestation: indexing_error)}';

describe('parseBadIndexers', () => {
  it('parses the real gateway message into four structured verdicts', () => {
    const parsed = parseBadIndexers(REAL_BAD);
    expect(parsed).toHaveLength(4);
    expect(parsed[0]).toEqual({
      indexer: '0x2f09092aacd80196fc984908c5a9a7ab3ee4f1ce',
      kind: 'BadResponse',
      detail: 'no attestation: indexing_error',
      category: 'errored',
    });
    expect(parsed[1]).toEqual({
      indexer: '0x550c1f4814a85aa10f5f061ca8c45e2ee9620226',
      kind: 'Unavailable',
      detail: 'too far behind',
      category: 'stale',
    });
  });

  it('lower-cases addresses', () => {
    const parsed = parseBadIndexers('bad indexers: {0xABCDEF0123456789abcdef0123456789ABCDEF01: Timeout(deadline)}');
    expect(parsed[0].indexer).toBe('0xabcdef0123456789abcdef0123456789abcdef01');
    expect(parsed[0].category).toBe('timeout');
  });

  it('handles bare entries with no parenthesised detail', () => {
    const parsed = parseBadIndexers('bad indexers: {0x1111111111111111111111111111111111111111: Unavailable}');
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ kind: 'Unavailable', detail: '', category: 'unavailable' });
  });

  it('does not double-count an address that has a parenthesised detail', () => {
    const parsed = parseBadIndexers(REAL_BAD);
    const addrs = parsed.map((p) => p.indexer);
    expect(new Set(addrs).size).toBe(addrs.length);
  });

  it('returns empty for a message with no addresses', () => {
    expect(parseBadIndexers('bad indexers: {}')).toEqual([]);
  });
});

describe('classifyBadIndexer', () => {
  it('detail keywords win over kind', () => {
    // Unavailable kind but "too far behind" → stale, not unavailable
    expect(classifyBadIndexer('Unavailable', 'too far behind')).toBe('stale');
    // BadResponse kind but attestation detail → errored
    expect(classifyBadIndexer('BadResponse', 'no attestation: indexing_error')).toBe('errored');
  });

  it('falls back to kind when detail is unhelpful', () => {
    expect(classifyBadIndexer('Unavailable', '')).toBe('unavailable');
    expect(classifyBadIndexer('Timeout', '')).toBe('timeout');
    expect(classifyBadIndexer('BadResponse', '')).toBe('errored');
    expect(classifyBadIndexer('Weird', 'nonsense')).toBe('other');
  });
});

describe('badIndexerLabel', () => {
  it('maps categories to human labels', () => {
    expect(badIndexerLabel({ indexer: '0x0', kind: 'Unavailable', detail: '', category: 'stale' })).toBe('Too far behind');
    expect(badIndexerLabel({ indexer: '0x0', kind: 'BadResponse', detail: '', category: 'errored' })).toBe(
      'Not attesting (indexing error)',
    );
  });
});

describe('interpretGatewayResponse', () => {
  it('classifies a served response and extracts the block', () => {
    const r = interpretGatewayResponse('Qm1', 200, { data: { _meta: { block: { number: 481651018 } } } }, PROBED_AT);
    expect(r.verdict).toBe('served');
    expect(r.servedBlock).toBe(481651018);
    expect(r.badIndexers).toEqual([]);
  });

  it('classifies a bad-indexers response', () => {
    const r = interpretGatewayResponse('Qm1', 200, { errors: [{ message: REAL_BAD }] }, PROBED_AT);
    expect(r.verdict).toBe('bad-indexers');
    expect(r.badIndexers).toHaveLength(4);
    expect(r.message).toBe(REAL_BAD);
  });

  it('classifies not-found', () => {
    const r = interpretGatewayResponse('Qmx', 200, { errors: [{ message: 'subgraph not found: Qmx' }] }, PROBED_AT);
    expect(r.verdict).toBe('not-found');
  });

  it('classifies no-indexers', () => {
    const r = interpretGatewayResponse('Qmx', 200, { errors: [{ message: 'no indexers found for deployment' }] }, PROBED_AT);
    expect(r.verdict).toBe('no-indexers');
  });

  it('an unknown error message falls through to error', () => {
    const r = interpretGatewayResponse('Qmx', 200, { errors: [{ message: 'auth error: bad api key' }] }, PROBED_AT);
    expect(r.verdict).toBe('error');
    expect(r.message).toBe('auth error: bad api key');
  });

  it('data with errors present is not treated as served', () => {
    const r = interpretGatewayResponse('Qmx', 200, { data: null, errors: [{ message: REAL_BAD }] }, PROBED_AT);
    expect(r.verdict).toBe('bad-indexers');
  });
});
