import { describe, it, expect } from 'vitest';
import { generateApiKey, hashApiKey, isValidApiKeyFormat, API_KEY_RE } from '../api-keys';

describe('generateApiKey', () => {
  it('produces a well-formed lod_live_ key', () => {
    const { plaintext } = generateApiKey();
    expect(plaintext).toMatch(API_KEY_RE);
    expect(plaintext.startsWith('lod_live_')).toBe(true);
  });

  it('stores a hash that matches hashApiKey(plaintext) and never the plaintext', () => {
    const { plaintext, hash } = generateApiKey();
    expect(hash).toBe(hashApiKey(plaintext));
    expect(hash).not.toContain(plaintext);
    expect(hash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });

  it('exposes a display prefix that is a prefix of the key', () => {
    const { plaintext, prefix } = generateApiKey();
    expect(plaintext.startsWith(prefix)).toBe(true);
    expect(prefix.length).toBeLessThan(plaintext.length);
  });

  it('generates unique keys', () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateApiKey().plaintext));
    expect(keys.size).toBe(50);
  });
});

describe('hashApiKey', () => {
  it('is deterministic', () => {
    expect(hashApiKey('lod_live_abc')).toBe(hashApiKey('lod_live_abc'));
  });
  it('differs for different inputs', () => {
    expect(hashApiKey('a')).not.toBe(hashApiKey('b'));
  });
});

describe('isValidApiKeyFormat', () => {
  it('accepts a freshly generated key', () => {
    expect(isValidApiKeyFormat(generateApiKey().plaintext)).toBe(true);
  });
  it('rejects malformed keys', () => {
    expect(isValidApiKeyFormat('lod_live_xyz')).toBe(false); // too short / non-hex
    expect(isValidApiKeyFormat('lod_test_' + 'a'.repeat(48))).toBe(false); // wrong prefix
    expect(isValidApiKeyFormat('LOD_LIVE_' + 'a'.repeat(48))).toBe(false); // case
    expect(isValidApiKeyFormat('')).toBe(false);
  });
});
