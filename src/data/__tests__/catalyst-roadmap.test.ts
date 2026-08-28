import { describe, it, expect } from 'vitest';
import {
  CATALYST_ITEMS,
  catalystSummary,
  coverageBand,
} from '../catalyst-roadmap';

describe('CATALYST_ITEMS', () => {
  it('scores every item within 0–100', () => {
    for (const item of CATALYST_ITEMS) {
      expect(item.coverage).toBeGreaterThanOrEqual(0);
      expect(item.coverage).toBeLessThanOrEqual(100);
    }
  });

  it('has unique slugs', () => {
    const slugs = CATALYST_ITEMS.map((i) => i.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('is ordered by coverage descending, since the card renders array order', () => {
    const scores = CATALYST_ITEMS.map((i) => i.coverage);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('argues every score', () => {
    for (const item of CATALYST_ITEMS) {
      expect(item.rationale.length).toBeGreaterThan(40);
    }
  });
});

describe('catalystSummary', () => {
  it('reproduces the ~37% headline claimed in the post', () => {
    const { overall } = catalystSummary();
    expect(overall).toBeCloseTo(36.875, 3);
  });

  it('counts items with and without community work', () => {
    const { covered, untouched, total } = catalystSummary();
    expect(covered + untouched).toBe(total);
    expect(total).toBe(CATALYST_ITEMS.length);
  });
});

describe('coverageBand', () => {
  it('bands on the 50 and 25 boundaries', () => {
    expect(coverageBand(65)).toBe('strong');
    expect(coverageBand(50)).toBe('strong');
    expect(coverageBand(49)).toBe('partial');
    expect(coverageBand(25)).toBe('partial');
    expect(coverageBand(24)).toBe('foundation');
    expect(coverageBand(0)).toBe('foundation');
  });
});
