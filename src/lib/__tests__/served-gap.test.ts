import { describe, it, expect } from 'vitest';
import { servedGap, aggregateServedGap, scoreServedGap } from '../served-gap';

describe('servedGap', () => {
  it('is allocShare − servedShare', () => {
    expect(servedGap(0.5, 0.5)).toBe(0);
    expect(servedGap(0.5, 0.1)).toBeCloseTo(0.4, 9); // under-serving
    expect(servedGap(0.2, 0.6)).toBeCloseTo(-0.4, 9); // over-serving
  });
});

describe('aggregateServedGap', () => {
  it('stake-weights the gap across deployments', () => {
    // big deployment (weight 900) served fine; tiny one (weight 100) leeched
    const g = aggregateServedGap([
      { allocShare: 0.5, servedShare: 0.5, weight: 900 },
      { allocShare: 0.9, servedShare: 0.0, weight: 100 },
    ]);
    // weighted: (900*0 + 100*0.9) / 1000 = 0.09
    expect(g).toBeCloseTo(0.09, 9);
  });

  it('is split-invariant: splitting neither helps nor hides', () => {
    // one operator allocates 0.6 share, serves 0 → gap 0.6
    const whole = aggregateServedGap([{ allocShare: 0.6, servedShare: 0.0, weight: 600 }])!;
    // split into two identities of 0.3 each, each serving 0
    const halfA = aggregateServedGap([{ allocShare: 0.3, servedShare: 0.0, weight: 300 }])!;
    const halfB = aggregateServedGap([{ allocShare: 0.3, servedShare: 0.0, weight: 300 }])!;
    expect(whole).toBeCloseTo(0.6, 9);
    // Each fragment is INDEPENDENTLY flagged — a positive gap it can't escape by
    // splitting (no attribution needed) …
    expect(halfA).toBeCloseTo(0.3, 9);
    expect(halfB).toBeCloseTo(0.3, 9);
    // … and the total service obligation is conserved: hiding gains nothing.
    expect(halfA + halfB).toBeCloseTo(whole, 9);
  });

  it('returns null when there is no weight to judge', () => {
    expect(aggregateServedGap([])).toBeNull();
    expect(aggregateServedGap([{ allocShare: 0.5, servedShare: 0, weight: 0 }])).toBeNull();
  });
});

describe('scoreServedGap', () => {
  it('rewards serving at or above your allocation share', () => {
    expect(scoreServedGap(0)).toBe(100);
    expect(scoreServedGap(-0.5)).toBe(100); // over-serving
    expect(scoreServedGap(0.05)).toBe(100); // within tolerance
  });

  it('punishes the leech: high gap → low score, total leech → 0', () => {
    expect(scoreServedGap(1)).toBe(0); // allocated everything, serves nothing
    expect(scoreServedGap(0.525)).toBe(50); // midpoint-ish
    expect(scoreServedGap(0.3)).toBeLessThan(scoreServedGap(0.1));
  });
});
