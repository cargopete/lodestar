import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isCronAuthorized } from '../cron-auth';

function reqWith(authHeader: string | null) {
  return {
    headers: {
      get(name: string) {
        return name.toLowerCase() === 'authorization' ? authHeader : null;
      },
    },
  };
}

describe('isCronAuthorized', () => {
  const ORIG = process.env.CRON_SECRET;
  beforeEach(() => {
    process.env.CRON_SECRET = 'super-secret-cron-token';
  });
  afterEach(() => {
    if (ORIG === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = ORIG;
  });

  it('fails CLOSED when CRON_SECRET is unset', () => {
    delete process.env.CRON_SECRET;
    expect(isCronAuthorized(reqWith('Bearer anything'))).toBe(false);
    expect(isCronAuthorized(reqWith(null))).toBe(false);
  });

  it('fails CLOSED when CRON_SECRET is empty string', () => {
    process.env.CRON_SECRET = '';
    expect(isCronAuthorized(reqWith('Bearer '))).toBe(false);
  });

  it('rejects a missing Authorization header', () => {
    expect(isCronAuthorized(reqWith(null))).toBe(false);
  });

  it('rejects a wrong token', () => {
    expect(isCronAuthorized(reqWith('Bearer wrong-token'))).toBe(false);
  });

  it('rejects a token of different length (no length-leak crash)', () => {
    expect(isCronAuthorized(reqWith('Bearer x'))).toBe(false);
    expect(isCronAuthorized(reqWith('Bearer super-secret-cron-token-extra'))).toBe(false);
  });

  it('rejects the raw secret without the Bearer prefix', () => {
    expect(isCronAuthorized(reqWith('super-secret-cron-token'))).toBe(false);
  });

  it('accepts the correct Bearer token', () => {
    expect(isCronAuthorized(reqWith('Bearer super-secret-cron-token'))).toBe(true);
  });
});
