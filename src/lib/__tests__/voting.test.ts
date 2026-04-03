import { describe, it, expect, vi, afterEach } from 'vitest';
import { VOTE_DOMAIN, VOTE_TYPES, getCurrentPeriod } from '../voting';

describe('VOTE_DOMAIN', () => {
  it('has name Lodestar', () => {
    expect(VOTE_DOMAIN.name).toBe('Lodestar');
  });

  it('has version 1', () => {
    expect(VOTE_DOMAIN.version).toBe('1');
  });

  it('targets Arbitrum One (chainId 42161)', () => {
    expect(VOTE_DOMAIN.chainId).toBe(42161);
  });
});

describe('VOTE_TYPES', () => {
  it('defines a Vote type with 3 fields', () => {
    expect(VOTE_TYPES.Vote).toHaveLength(3);
  });

  it('includes indexer field as address type', () => {
    const indexerField = VOTE_TYPES.Vote.find(f => f.name === 'indexer');
    expect(indexerField?.type).toBe('address');
  });

  it('includes period field as string type', () => {
    const periodField = VOTE_TYPES.Vote.find(f => f.name === 'period');
    expect(periodField?.type).toBe('string');
  });

  it('includes voter field as address type', () => {
    const voterField = VOTE_TYPES.Vote.find(f => f.name === 'voter');
    expect(voterField?.type).toBe('address');
  });
});

describe('getCurrentPeriod', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a YYYY-MM formatted string', () => {
    const period = getCurrentPeriod();
    expect(period).toMatch(/^\d{4}-\d{2}$/);
  });

  it('returns the correct UTC year and month', () => {
    // Pin time to 2026-04-15 UTC
    vi.setSystemTime(new Date('2026-04-15T12:00:00Z'));
    expect(getCurrentPeriod()).toBe('2026-04');
  });

  it('zero-pads single-digit months', () => {
    vi.setSystemTime(new Date('2026-03-01T00:00:00Z'));
    expect(getCurrentPeriod()).toBe('2026-03');
  });

  it('handles January correctly', () => {
    vi.setSystemTime(new Date('2027-01-15T00:00:00Z'));
    expect(getCurrentPeriod()).toBe('2027-01');
  });

  it('handles December correctly', () => {
    vi.setSystemTime(new Date('2026-12-31T23:59:59Z'));
    expect(getCurrentPeriod()).toBe('2026-12');
  });
});
