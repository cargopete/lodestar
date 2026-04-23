import { describe, it, expect } from 'vitest';
import { generateMockPortfolioHistory } from '../portfolio-utils';

describe('generateMockPortfolioHistory', () => {
  it('returns one data point per day plus today', () => {
    const data = generateMockPortfolioHistory(1000, 100, 90);
    expect(data).toHaveLength(91); // days + 1 (i goes from 90 down to 0)
  });

  it('uses default of 90 days when not specified', () => {
    const data = generateMockPortfolioHistory(1000, 100);
    expect(data).toHaveLength(91);
  });

  it('each point has required fields', () => {
    const data = generateMockPortfolioHistory(500, 50, 10);
    for (const point of data) {
      expect(point).toHaveProperty('date');
      expect(point).toHaveProperty('timestamp');
      expect(point).toHaveProperty('value');
      expect(point).toHaveProperty('rewards');
      expect(point).toHaveProperty('principal');
    }
  });

  it('principal is derived from currentValue minus currentRewards', () => {
    const data = generateMockPortfolioHistory(1000, 200, 10);
    const expectedPrincipal = 1000 - 200;
    for (const point of data) {
      expect(point.principal).toBe(expectedPrincipal);
    }
  });

  it('timestamps are in ascending order', () => {
    const data = generateMockPortfolioHistory(1000, 100, 30);
    for (let i = 1; i < data.length; i++) {
      expect(data[i].timestamp).toBeGreaterThan(data[i - 1].timestamp);
    }
  });

  it('value equals principal plus rewards', () => {
    const data = generateMockPortfolioHistory(1000, 100, 10);
    for (const point of data) {
      expect(point.value).toBeCloseTo(point.principal + point.rewards, 5);
    }
  });

  it('handles zero rewards gracefully', () => {
    const data = generateMockPortfolioHistory(500, 0, 10);
    for (const point of data) {
      expect(point.rewards).toBeCloseTo(0, 5);
      expect(point.value).toBeCloseTo(500, 5);
    }
  });
});
