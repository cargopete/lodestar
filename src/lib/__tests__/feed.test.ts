/**
 * Tests for src/lib/feed.ts.
 *
 * NOTE: despite the assignment brief describing feed.ts as "the feed data lib"
 * with fetch/transform/merge logic, the actual module contains NO network code.
 * It exports type definitions, the FEED_TYPE_CONFIG presentation map, and the
 * pure `timeAgo` relative-time formatter. There is nothing to mock fetch for;
 * these tests exercise the real exported logic (`timeAgo` branch coverage past
 * and future, plus FEED_TYPE_CONFIG integrity).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { timeAgo, FEED_TYPE_CONFIG, type FeedItemType } from '@/lib/feed';

const NOW = new Date('2026-05-31T12:00:00.000Z').getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

/** ISO string for NOW shifted by `deltaSeconds` (negative = past). */
function at(deltaSeconds: number): string {
  return new Date(NOW + deltaSeconds * 1000).toISOString();
}

describe('timeAgo — past dates', () => {
  it('reports "just now" for under a minute', () => {
    expect(timeAgo(at(-30))).toBe('just now');
  });

  it('reports minutes', () => {
    expect(timeAgo(at(-5 * 60))).toBe('5m ago');
    expect(timeAgo(at(-59 * 60))).toBe('59m ago');
  });

  it('reports hours', () => {
    expect(timeAgo(at(-2 * 3600))).toBe('2h ago');
    expect(timeAgo(at(-23 * 3600))).toBe('23h ago');
  });

  it('reports days under a month', () => {
    expect(timeAgo(at(-3 * 86400))).toBe('3d ago');
    expect(timeAgo(at(-29 * 86400))).toBe('29d ago');
  });

  it('reports months at 30+ days', () => {
    expect(timeAgo(at(-30 * 86400))).toBe('1mo ago');
    expect(timeAgo(at(-90 * 86400))).toBe('3mo ago');
  });
});

describe('timeAgo — future dates', () => {
  it('reports "in a moment" for under a minute ahead', () => {
    expect(timeAgo(at(30))).toBe('in a moment');
  });

  it('reports minutes ahead', () => {
    expect(timeAgo(at(5 * 60))).toBe('in 5m');
  });

  it('reports hours ahead', () => {
    expect(timeAgo(at(3 * 3600))).toBe('in 3h');
  });

  it('reports days ahead', () => {
    expect(timeAgo(at(2 * 86400))).toBe('in 2d');
  });
});

describe('FEED_TYPE_CONFIG', () => {
  const ALL_TYPES: FeedItemType[] = [
    'governance', 'gip', 'vote', 'epoch',
    'announcement', 'news', 'issue', 'pr', 'release',
  ];

  it('has an entry for every FeedItemType', () => {
    for (const t of ALL_TYPES) {
      expect(FEED_TYPE_CONFIG[t]).toBeDefined();
    }
    expect(Object.keys(FEED_TYPE_CONFIG).sort()).toEqual([...ALL_TYPES].sort());
  });

  it('every entry has a non-empty label, borderColor and bgColor', () => {
    for (const t of ALL_TYPES) {
      const cfg = FEED_TYPE_CONFIG[t];
      expect(cfg.label.length).toBeGreaterThan(0);
      expect(cfg.borderColor.length).toBeGreaterThan(0);
      expect(cfg.bgColor.length).toBeGreaterThan(0);
    }
  });
});
