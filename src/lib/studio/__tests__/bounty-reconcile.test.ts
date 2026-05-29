import { describe, it, expect } from 'vitest';
import { reconcileBountyStatus, needsUpdate } from '../bounty-reconcile';

const ZERO = '0x0000000000000000000000000000000000000000';
const WINNER = '0xAbC0000000000000000000000000000000000001';
const NOW = 1_800_000_000; // fixed "now" in seconds

describe('reconcileBountyStatus', () => {
  it('marks a settled bounty with a winner as claimed (winner lowercased)', () => {
    const r = reconcileBountyStatus({ settled: true, winner: WINNER, expiresAt: 0n }, NOW);
    expect(r.status).toBe('claimed');
    expect(r.claimedBy).toBe(WINNER.toLowerCase());
  });

  it('marks a settled, winner-less, non-expired bounty as cancelled', () => {
    const r = reconcileBountyStatus({ settled: true, winner: ZERO, expiresAt: 0n }, NOW);
    expect(r.status).toBe('cancelled');
    expect(r.claimedBy).toBeUndefined();
  });

  it('marks a settled, winner-less, past-expiry bounty as expired (refunded)', () => {
    const r = reconcileBountyStatus({ settled: true, winner: ZERO, expiresAt: BigInt(NOW - 10) }, NOW);
    expect(r.status).toBe('expired');
  });

  it('marks an unsettled, past-expiry bounty as expired (refund pending)', () => {
    const r = reconcileBountyStatus({ settled: false, winner: ZERO, expiresAt: BigInt(NOW - 1) }, NOW);
    expect(r.status).toBe('expired');
  });

  it('keeps an unsettled, not-yet-expired bounty open', () => {
    const r = reconcileBountyStatus({ settled: false, winner: ZERO, expiresAt: BigInt(NOW + 3600) }, NOW);
    expect(r.status).toBe('open');
  });

  it('keeps an unsettled bounty with no expiry open', () => {
    const r = reconcileBountyStatus({ settled: false, winner: ZERO, expiresAt: 0n }, NOW);
    expect(r.status).toBe('open');
  });

  it('treats expiry as exclusive — exactly at expiresAt is still open', () => {
    const r = reconcileBountyStatus({ settled: false, winner: ZERO, expiresAt: BigInt(NOW) }, NOW);
    expect(r.status).toBe('open');
  });

  it('claimed takes precedence even past expiry (claimed just before deadline)', () => {
    const r = reconcileBountyStatus({ settled: true, winner: WINNER, expiresAt: BigInt(NOW - 100) }, NOW);
    expect(r.status).toBe('claimed');
  });
});

describe('needsUpdate', () => {
  it('is true when the status differs', () => {
    expect(needsUpdate({ status: 'open' }, { status: 'claimed', claimedBy: WINNER.toLowerCase() })).toBe(true);
  });

  it('is false when status matches and not a claim', () => {
    expect(needsUpdate({ status: 'expired' }, { status: 'expired' })).toBe(false);
  });

  it('is false when an already-claimed row records the correct winner', () => {
    expect(needsUpdate(
      { status: 'claimed', claimed_by: WINNER.toLowerCase() },
      { status: 'claimed', claimedBy: WINNER.toLowerCase() },
    )).toBe(false);
  });

  it('is true when a claimed row recorded the WRONG winner (old optimistic PATCH)', () => {
    expect(needsUpdate(
      { status: 'claimed', claimed_by: '0xdeadbeef00000000000000000000000000000000' },
      { status: 'claimed', claimedBy: WINNER.toLowerCase() },
    )).toBe(true);
  });

  it('is true when a claimed row has no recorded winner at all', () => {
    expect(needsUpdate(
      { status: 'claimed', claimed_by: null },
      { status: 'claimed', claimedBy: WINNER.toLowerCase() },
    )).toBe(true);
  });
});
