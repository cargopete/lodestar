/**
 * The round store writes `verdict_json` as a jsonb object, not as a JSON string inside a jsonb
 * (lodestar#62). Everything the store sends is captured by a recording tag; `sql.json` is the real
 * postgres.js helper so the parameter carries the object, not a stringification of it.
 */
import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { recordRound, recentRounds, type RoundRecord } from '../servability-rounds';

type Call = { text: string; values: unknown[] };

function recordingSql(rows: unknown[] = []) {
  const calls: Call[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join('$'), values });
    return Promise.resolve(rows);
  };
  const real = postgres({ max: 1 });
  return { sql: Object.assign(tag, { json: real.json }) as unknown as postgres.Sql, calls };
}

const round: RoundRecord = {
  deploymentHash: 'QmHash',
  probedAt: '2026-09-03T18:42:51.277Z',
  servingOperators: 0,
  servingIndexers: 0,
  gatewayVerdict: 'served',
  verdict: { effectiveServingOperators: 0, servingIndexerCount: 0, effectivelyDead: true, recovering: false, dominantOperatorShare: 1 },
  probes: [
    { indexerId: '0xabc', url: 'https://indexer.example/', probe: 'broken', cause: 'transport', error: 'timeout', status: null, contentType: null, paid: true, attempts: 2, elapsedMs: 8002 },
  ],
};

describe('servability round store', () => {
  it('writes verdict_json as an object parameter, never as a pre-stringified value', async () => {
    const { sql, calls } = recordingSql();
    await recordRound(sql, round);
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toMatch(/INSERT INTO servability_rounds/);
    const json = calls[0].values[5] as { value: unknown };
    expect(typeof json).toBe('object');
    expect(typeof json.value).not.toBe('string');
    expect(json.value).toMatchObject({ effectivelyDead: true, probes: [{ indexerId: '0xabc', cause: 'transport', error: 'timeout', attempts: 2 }] });
    for (const v of calls[0].values) expect(typeof v === 'string' && v.startsWith('{')).toBe(false);
  });

  it('reads the newest rows back oldest first, with the counts as numbers', async () => {
    const { sql, calls } = recordingSql([
      { probed_at: new Date('2026-09-03T18:42:51.277Z'), serving_operator_count: '1', serving_indexer_count: '1', gateway_verdict: 'served' },
      { probed_at: '2026-09-03T18:21:30.394Z', serving_operator_count: 0, serving_indexer_count: 0, gateway_verdict: null },
    ]);
    const history = await recentRounds(sql, 'QmHash', 3);
    expect(calls[0].values).toEqual(['QmHash', 3]);
    expect(history).toEqual([
      { probedAt: '2026-09-03T18:21:30.394Z', servingOperators: 0, servingIndexers: 0, gatewayVerdict: null },
      { probedAt: '2026-09-03T18:42:51.277Z', servingOperators: 1, servingIndexers: 1, gatewayVerdict: 'served' },
    ]);
  });
});
