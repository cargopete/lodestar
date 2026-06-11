import { describe, it, expect } from 'vitest';
import { assessServability, type ServabilityInput } from '../servability';

function ix(over: Partial<ServabilityInput> = {}): ServabilityInput {
  return { indexerId: '0x' + Math.random().toString(16).slice(2, 10), servable: false, status: 'synced', allocatedTokens: '0', ...over };
}

describe('assessServability', () => {
  it('the iExec case: all allocated but none servable → effectively dead', () => {
    // five identities, all report synced, none serve (BadResponse 400)
    const v = assessServability([
      ix({ servable: false, status: 'synced', allocatedTokens: '1000' }),
      ix({ servable: false, status: 'synced', allocatedTokens: '1000' }),
      ix({ servable: false, status: 'synced', allocatedTokens: '1000' }),
      ix({ servable: false, status: 'synced', allocatedTokens: '1000' }),
      ix({ servable: false, status: 'synced', allocatedTokens: '1000' }),
    ]);
    expect(v.effectivelyDead).toBe(true);
    expect(v.effectiveServingOperators).toBe(0);
    expect(v.recovering).toBe(false);
  });

  it('one honest servable indexer keeps it alive', () => {
    const v = assessServability([
      ix({ servable: false, status: 'failed' }),
      ix({ servable: true, status: 'synced', allocatedTokens: '500' }),
    ]);
    expect(v.effectivelyDead).toBe(false);
    expect(v.effectiveServingOperators).toBe(1);
    expect(v.servingIndexerCount).toBe(1);
  });

  it('recovering: dead now, but a rescue is syncing', () => {
    const v = assessServability([
      ix({ servable: false, status: 'synced' }),
      ix({ servable: false, status: 'syncing', allocatedTokens: '300' }),
    ]);
    expect(v.effectivelyDead).toBe(true);
    expect(v.recovering).toBe(true);
  });

  it('collapses one operator’s many identities via operatorOf', () => {
    const indexers = [
      ix({ indexerId: 'a1', servable: true, allocatedTokens: '100' }),
      ix({ indexerId: 'a2', servable: true, allocatedTokens: '100' }),
      ix({ indexerId: 'b1', servable: true, allocatedTokens: '100' }),
    ];
    const operatorOf = (id: string) => (id.startsWith('a') ? 'A' : 'B');
    const v = assessServability(indexers, operatorOf);
    // 3 servable indexers, but only 2 distinct operators
    expect(v.servingIndexerCount).toBe(3);
    expect(v.effectiveServingOperators).toBe(2);
  });

  it('dominantOperatorShare flags single-point-of-failure concentration', () => {
    const v = assessServability([
      ix({ servable: true, allocatedTokens: '9000' }),
      ix({ servable: true, allocatedTokens: '1000' }),
    ]);
    expect(v.dominantOperatorShare).toBeCloseTo(0.9, 4);
    expect(v.effectivelyDead).toBe(false); // concentration is NOT death
  });

  it('empty allocation set is dead, share 0', () => {
    const v = assessServability([]);
    expect(v.effectivelyDead).toBe(true);
    expect(v.dominantOperatorShare).toBe(0);
  });
});
