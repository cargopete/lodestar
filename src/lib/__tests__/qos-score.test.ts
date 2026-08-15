import { describe, it, expect } from 'vitest';
import {
  wilsonLowerBound,
  decayUtil,
  latencyUtil,
  freshnessUtil,
  ewmaWeight,
  median,
  blockTimeSec,
  computeQuality,
  type DeploymentMetrics,
} from '../qos-score';

describe('wilsonLowerBound', () => {
  it('returns 0 for no evidence', () => {
    expect(wilsonLowerBound(0, 0)).toBe(0);
    expect(wilsonLowerBound(0, 100)).toBe(0);
  });

  it('matches the published value for p=0.8, n=100 (≈0.711)', () => {
    expect(wilsonLowerBound(80, 100)).toBeCloseTo(0.711, 2);
  });

  it('THE decisive property: a few-but-perfect leech cannot beat a workhorse', () => {
    const leech = wilsonLowerBound(10, 10); // 10/10
    const workhorse = wilsonLowerBound(9990, 10000); // 99.9% of 10k
    expect(workhorse).toBeGreaterThan(leech);
  });

  it('shrinks toward the prior for small n at the same p̂', () => {
    const small = wilsonLowerBound(10, 10); // perfect, tiny
    const large = wilsonLowerBound(10000, 10000); // perfect, huge
    expect(large).toBeGreaterThan(small);
    expect(small).toBeLessThan(0.8); // 10/10 must NOT score near 1
    expect(large).toBeGreaterThan(0.999);
  });

  it('never exceeds [0,1] and is monotonic in n for fixed p̂', () => {
    const a = wilsonLowerBound(80, 100);
    const b = wilsonLowerBound(800, 1000);
    const c = wilsonLowerBound(8000, 10000);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    expect(c).toBeLessThanOrEqual(1);
    expect(wilsonLowerBound(0, 50)).toBeGreaterThanOrEqual(0);
  });
});

describe('decay utilities', () => {
  it('decayUtil: 0 → 1, tau → 1/e, monotonic decreasing', () => {
    expect(decayUtil(0, 100)).toBe(1);
    expect(decayUtil(100, 100)).toBeCloseTo(1 / Math.E, 6);
    expect(decayUtil(200, 100)).toBeLessThan(decayUtil(100, 100));
  });

  it('decayUtil handles tau<=0', () => {
    expect(decayUtil(0, 0)).toBe(1);
    expect(decayUtil(5, 0)).toBe(0);
  });

  it('latencyUtil rewards low latency, punishes high', () => {
    expect(latencyUtil(0, 200)).toBe(1);
    expect(latencyUtil(2000, 200)).toBeLessThan(0.0001); // 10× tau → ~e^-10
  });

  it('freshnessUtil: at-head → 1, far-behind → ~0', () => {
    expect(freshnessUtil(0)).toBe(1);
    expect(freshnessUtil(600, 600)).toBeCloseTo(1 / Math.E, 6);
    expect(freshnessUtil(60000, 600)).toBeLessThan(1e-40); // days behind
  });
});

describe('ewmaWeight', () => {
  it('age 0 → 1, half-life → 0.5, double → 0.25', () => {
    expect(ewmaWeight(0, 10)).toBe(1);
    expect(ewmaWeight(10, 10)).toBeCloseTo(0.5, 9);
    expect(ewmaWeight(20, 10)).toBeCloseTo(0.25, 9);
  });
  it('handles non-positive half-life', () => {
    expect(ewmaWeight(0, 0)).toBe(1);
    expect(ewmaWeight(3, 0)).toBe(0);
  });
});

describe('median & blockTimeSec', () => {
  it('median odd/even/empty', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
  });
  it('blockTimeSec known chains + aliases', () => {
    expect(blockTimeSec('arbitrum-one')).toBe(0.25);
    expect(blockTimeSec('mainnet')).toBe(12);
    expect(blockTimeSec('BSC')).toBe(3); // case-insensitive
    expect(blockTimeSec('xdai')).toBe(5); // alias of gnosis
    expect(blockTimeSec('sonic')).toBe(0.5);
  });

  it('blockTimeSec returns null for a chain we do not know', () => {
    // Guessing 12s here turned a fast-chain deployment a few thousand blocks behind into
    // "seventeen hours stale", and exp(-t/tau) rendered that as a flat zero. An unknown
    // chain means we cannot convert blocks to time, which is not the same as being stale.
    expect(blockTimeSec('some-new-rollup')).toBeNull();
    expect(blockTimeSec(null)).toBeNull();
    expect(blockTimeSec('')).toBeNull();
  });
});

describe('computeQuality', () => {
  const perfectDeployment = (deployment: string): DeploymentMetrics => ({
    deployment,
    n: 10000,
    successes: 9990,
    avgLatencyMs: 40,
    latencyTauMs: 100,
    timeBehindSec: 10,
    servedShare: 0.3,
  });

  it('empty input → zero score', () => {
    const r = computeQuality([]);
    expect(r.qScore).toBe(0);
    expect(r.credibleDeployments).toBe(0);
  });

  it('a weighted-product near-zero on ANY axis tanks the deployment', () => {
    // Perfect reliability + freshness, but latency 100× tau → U_lat ≈ 0.
    const r = computeQuality([
      { deployment: 'd', n: 10000, successes: 10000, avgLatencyMs: 10000, latencyTauMs: 100, timeBehindSec: 0, servedShare: 1 },
    ]);
    expect(r.qScore).toBeLessThan(1);
    expect(r.latUtil).toBeLessThan(0.0001);
    expect(r.reliability).toBeGreaterThan(0.99); // reliability itself still high
  });

  it('THE headline: a leech scores far below a broad workhorse', () => {
    // Leech: one self-curated deployment, tiny volume, slow, far behind.
    const leech = computeQuality([
      { deployment: 'L', n: 12, successes: 12, avgLatencyMs: 1500, latencyTauMs: 100, timeBehindSec: 50000, servedShare: 1 },
    ]);
    // Workhorse: nine deployments, high credible volume, fast, fresh.
    const workhorse = computeQuality(
      Array.from({ length: 9 }, (_, i) => perfectDeployment(`d${i}`)),
    );
    expect(workhorse.qScore).toBeGreaterThan(50);
    expect(leech.qScore).toBeLessThan(10);
    expect(workhorse.qScore).toBeGreaterThan(leech.qScore * 5);
  });

  it('coverage rewards breadth: more credible deployments → higher coverage factor', () => {
    const one = computeQuality([perfectDeployment('a')]);
    const five = computeQuality(['a', 'b', 'c', 'd', 'e'].map(perfectDeployment));
    expect(five.coverage).toBeGreaterThan(one.coverage);
    expect(one.coverage).toBeGreaterThanOrEqual(0.5);
    expect(five.coverage).toBeLessThanOrEqual(1);
    expect(five.qScore).toBeGreaterThan(one.qScore);
  });

  it('volume below minCredibleN does not count toward coverage', () => {
    const r = computeQuality([
      { deployment: 'd', n: 50, successes: 50, avgLatencyMs: 10, latencyTauMs: 100, timeBehindSec: 0, servedShare: 1 },
    ]);
    expect(r.credibleDeployments).toBe(0);
    expect(r.coverage).toBeCloseTo(0.5, 9); // 0.5 + 0.5*(0/3)
  });

  it('sub-metrics are volume-weighted means', () => {
    const r = computeQuality([
      { deployment: 'a', n: 3000, successes: 3000, avgLatencyMs: 0, latencyTauMs: 100, timeBehindSec: 0, servedShare: 0.1 },
      { deployment: 'b', n: 1000, successes: 0, avgLatencyMs: 0, latencyTauMs: 100, timeBehindSec: 0, servedShare: 1 },
    ]);
    // a is 3000 of the 4000 queries and reliable; b is 1000 and fails → weighted ≈ 0.75.
    // Note b carries ten times a's served SHARE and must not dominate on that basis.
    expect(r.reliability).toBeGreaterThan(0.7);
    expect(r.reliability).toBeLessThan(0.8);
    expect(r.latUtil).toBeCloseTo(1, 6); // both latency 0
  });

  /**
   * The bug this file exists to prevent recurring.
   *
   * Deployments were blended by SERVED SHARE — the indexer's slice of that deployment's
   * traffic — so answering 3 of 3 queries on a backwater scored weight 1.0 while answering
   * 4,731 of 56,289 on the deployment that carries the actual traffic scored 0.084. Twenty
   * sole-served trickles then outvoted the real workload twelve to one, and because the
   * Wilson bound reads a perfect 3-of-3 as 0.438, an indexer with a flawless record on small
   * deployments came out at half reliability. Weight is volume served. Share is a fairness
   * measure and belongs in ServedGap, where it already lives.
   */
  it('THE regression: a sole-served trickle cannot outweigh the firehose', () => {
    const firehose: DeploymentMetrics = {
      deployment: 'busy', n: 100_000, successes: 100_000,
      avgLatencyMs: 50, latencyTauMs: 250, timeBehindSec: 5, servedShare: 0.08,
    };
    // Twenty deployments of three perfect queries each, where this indexer is the only server.
    const trickles: DeploymentMetrics[] = Array.from({ length: 20 }, (_, i) => ({
      deployment: `t${i}`, n: 3, successes: 3,
      avgLatencyMs: 50, latencyTauMs: 250, timeBehindSec: 5, servedShare: 1,
    }));

    const alone = computeQuality([firehose]);
    const withTrickles = computeQuality([firehose, ...trickles]);

    // 60 perfect queries spread over 20 deployments must not halve a 100,000-query record.
    expect(withTrickles.reliability).toBeGreaterThan(0.98);
    expect(alone.reliability - withTrickles.reliability).toBeLessThan(0.02);
  });

  it('a deployment the oracle published no success figure for is excluded, not scored zero', () => {
    // Absent is not a verdict. Scoring an unpublished success rate as total failure is the
    // same error as reading missing data as healthy, just pointing the other way.
    const measured: DeploymentMetrics = {
      deployment: 'known', n: 1000, successes: 1000,
      avgLatencyMs: 50, latencyTauMs: 250, timeBehindSec: 0, servedShare: 0.5,
    };
    const unmeasured: DeploymentMetrics = {
      deployment: 'silent', n: 5000, successes: null,
      avgLatencyMs: 50, latencyTauMs: 250, timeBehindSec: 0, servedShare: 0.5,
    };
    const r = computeQuality([measured, unmeasured]);
    expect(r.reliability).toBeGreaterThan(0.98);
    expect(r.unmeasuredDeployments).toBe(1);
    expect(r.credibleDeployments).toBe(1); // an unmeasured deployment is not credibly served
  });

  it('all-unmeasured input scores nothing rather than zero', () => {
    const r = computeQuality([
      { deployment: 'a', n: 500, successes: null, avgLatencyMs: 10, latencyTauMs: 100, timeBehindSec: 0, servedShare: 1 },
    ]);
    expect(r.qScore).toBe(0);
    expect(r.unmeasuredDeployments).toBe(1);
  });

  it('an unknown chain omits freshness instead of scoring it zero', () => {
    const known: DeploymentMetrics = {
      deployment: 'a', n: 1000, successes: 1000,
      avgLatencyMs: 0, latencyTauMs: 100, timeBehindSec: 0, servedShare: 1,
    };
    const unknownChain: DeploymentMetrics = { ...known, deployment: 'b', timeBehindSec: null };
    const r = computeQuality([unknownChain]);
    // Same score as a deployment measured at the chain head: we withhold the factor rather
    // than guess a block time and manufacture staleness out of the guess.
    expect(r.qScore).toBeCloseTo(computeQuality([known]).qScore, 6);
    expect(r.freshUtil).toBeNull();
  });

  it('freshness still bites when we DO know the chain', () => {
    const r = computeQuality([
      { deployment: 'a', n: 1000, successes: 1000, avgLatencyMs: 0, latencyTauMs: 100, timeBehindSec: 36_000, servedShare: 1 },
    ]);
    expect(r.freshUtil).toBeLessThan(0.001);
    expect(r.qScore).toBeLessThan(5);
  });
});
