import { describe, it, expect, beforeAll } from 'vitest';
import { clientIp, hashIp } from '@/lib/scuttlebutt-ip';

beforeAll(() => {
  process.env.SCUTTLEBUTT_IP_PEPPER = 'test-pepper';
});

function req(headers: Record<string, string>) {
  return { headers: { get: (n: string) => headers[n.toLowerCase()] ?? null } };
}

describe('clientIp', () => {
  it('prefers the first x-forwarded-for entry', () => {
    expect(clientIp(req({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }))).toBe('1.2.3.4');
  });

  it('falls back to x-real-ip', () => {
    expect(clientIp(req({ 'x-real-ip': '9.9.9.9' }))).toBe('9.9.9.9');
  });

  it('returns "unknown" when no headers are present', () => {
    expect(clientIp(req({}))).toBe('unknown');
  });
});

describe('hashIp', () => {
  it('is stable for the same IP', () => {
    expect(hashIp('1.2.3.4')).toBe(hashIp('1.2.3.4'));
  });

  it('differs for different IPs', () => {
    expect(hashIp('1.2.3.4')).not.toBe(hashIp('4.3.2.1'));
  });

  it('never returns the raw IP', () => {
    const h = hashIp('1.2.3.4');
    expect(h).not.toContain('1.2.3.4');
    expect(h).toMatch(/^[0-9a-f]{32}$/);
  });
});
