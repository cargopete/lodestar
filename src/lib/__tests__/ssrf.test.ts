import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLookup = vi.fn();
vi.mock('node:dns/promises', () => ({
  lookup: (...a: unknown[]) => (mockLookup as (...x: unknown[]) => unknown)(...a),
}));

import { isPrivateIp, isSafeUrlString, isSafeUrlResolved } from '../ssrf';

describe('isPrivateIp', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '192.168.0.1', '172.16.0.1', '172.31.255.255',
    '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', '::',
    'fe80::1', 'fc00::1', 'fd12::1', '::ffff:127.0.0.1', '[fc00::1]',
  ])('flags %s as private', (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each(['1.1.1.1', '8.8.8.8', '172.15.0.1', '172.32.0.1', '93.184.216.34', '2606:4700::1'])(
    'allows public %s',
    (ip) => {
      expect(isPrivateIp(ip)).toBe(false);
    },
  );
});

describe('isSafeUrlString', () => {
  it('rejects non-http(s) schemes', () => {
    expect(isSafeUrlString('file:///etc/passwd')).toBe(false);
    expect(isSafeUrlString('ftp://example.com')).toBe(false);
  });
  it('rejects localhost forms and private literals', () => {
    expect(isSafeUrlString('http://localhost:8000')).toBe(false);
    expect(isSafeUrlString('http://foo.localhost')).toBe(false);
    expect(isSafeUrlString('http://127.0.0.1')).toBe(false);
    expect(isSafeUrlString('http://[fc00::1]/')).toBe(false);
    expect(isSafeUrlString('http://169.254.169.254/latest')).toBe(false);
  });
  it('accepts a public https URL', () => {
    expect(isSafeUrlString('https://idx.example.com/status')).toBe(true);
  });
  it('rejects garbage', () => {
    expect(isSafeUrlString('not a url')).toBe(false);
  });
});

describe('isSafeUrlResolved', () => {
  beforeEach(() => mockLookup.mockReset());

  it('fails fast on a private literal without resolving', async () => {
    expect(await isSafeUrlResolved('http://127.0.0.1')).toBe(false);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('rejects when DNS resolves to a private IP (rebinding defence)', async () => {
    mockLookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    expect(await isSafeUrlResolved('http://evil.example.com')).toBe(false);
  });

  it('rejects if ANY resolved address is private', async () => {
    mockLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]);
    expect(await isSafeUrlResolved('http://mixed.example.com')).toBe(false);
  });

  it('allows when all resolved addresses are public', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    expect(await isSafeUrlResolved('https://good.example.com')).toBe(true);
  });

  it('fails closed on empty resolution', async () => {
    mockLookup.mockResolvedValue([]);
    expect(await isSafeUrlResolved('https://empty.example.com')).toBe(false);
  });
});
