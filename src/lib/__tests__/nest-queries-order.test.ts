/**
 * A list that casts a column to VARCHAR under its own name and then orders by that bare name is ordered
 * as text (nightswatchhq/nuthatch#1160: the deployments list put a 99.99 GRT deployment first). Every
 * builder that produces an ORDER BY is called with sample arguments and checked: no ORDER BY term may be
 * an unqualified name that the same statement also uses as a VARCHAR alias.
 */
import { describe, it, expect } from 'vitest';
import * as q from '../nest-queries';

const ADDR = '0x6f9bb7e454f5b3eb2310343f0e99269dc2bb8a1d';
const DEP = '0x' + 'a'.repeat(64);
const samples: Array<[string, string]> = [];
for (const [name, fn] of Object.entries(q)) {
  if (typeof fn !== 'function') continue;
  const args: unknown[][] = [
    [ADDR, 25, 0, 'signalledTokens', 'desc'], [25, 0, 'stakedTokens', 'desc'], [25, 0], [ADDR, 25], [DEP, 25], [DEP], [ADDR], [ADDR, ADDR, 25],
    [1700000000, 25], [[ADDR, DEP]], [ADDR, [1, 2, 3]], [100, 200], [1, 2, 3, 4], [],
  ];
  for (const a of args) {
    try {
      const out = (fn as (...x: unknown[]) => unknown)(...a);
      if (typeof out === 'string' && /ORDER BY/i.test(out)) { samples.push([name, out]); break; }
    } catch { /* wrong arity for this sample; try the next */ }
  }
}

describe('nest list queries order by the table column, not a VARCHAR alias of it', () => {
  it('found the list builders', () => {
    expect(samples.map(([n]) => n)).toEqual(expect.arrayContaining(['indexersSql', 'curatorsSql', 'deploymentsListSql', 'indexerDelegatorsSql', 'curatorSignalsSql', 'deploymentSignalsSql']));
  });
  for (const [name, sql] of samples) {
    it(name, () => {
      const aliases = new Set([...sql.matchAll(/AS VARCHAR\) AS ([a-z_]+)/g)].map((m) => m[1]));
      const orderBy = sql.match(/ORDER BY (.*?)(?: LIMIT| OFFSET|$)/i)?.[1] ?? '';
      const bare = orderBy.split(',').map((t) => t.trim().split(/\s+/)[0]).filter((t) => /^[a-z_]+$/.test(t) && aliases.has(t));
      expect(bare, `${name} orders by a VARCHAR alias: ${bare.join(', ')}\n${sql}`).toEqual([]);
    });
  }
});
