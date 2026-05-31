import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  API_KEY_RE,
  generateApiKey,
  hashApiKey,
  isValidApiKeyFormat,
} from '@/lib/studio/api-keys';

describe('generateApiKey', () => {
  it('mints a lod_live_ key with 48 lowercase hex chars', () => {
    const { plaintext } = generateApiKey();
    expect(plaintext).toMatch(/^lod_live_[0-9a-f]{48}$/);
    // "lod_live_" (9) + 48 hex = 57 chars
    expect(plaintext).toHaveLength(57);
  });

  it('returns a hash matching sha256(plaintext) and a display prefix', () => {
    const { plaintext, hash, prefix } = generateApiKey();
    expect(hash).toBe(createHash('sha256').update(plaintext).digest('hex'));
    expect(hash).toBe(hashApiKey(plaintext));
    // Display prefix = "lod_live_" + first 4 of the hex body = 13 chars.
    expect(prefix).toBe(plaintext.slice(0, 13));
    expect(prefix).toHaveLength(13);
    expect(prefix.startsWith('lod_live_')).toBe(true);
  });

  it('produces a fresh random key on each call', () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.hash).not.toBe(b.hash);
  });

  it('the minted key passes its own format validator', () => {
    expect(isValidApiKeyFormat(generateApiKey().plaintext)).toBe(true);
  });
});

describe('hashApiKey', () => {
  it('is deterministic and a 64-char sha256 hex digest', () => {
    expect(hashApiKey('lod_live_abc')).toBe(hashApiKey('lod_live_abc'));
    expect(hashApiKey('lod_live_abc')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs for differing inputs', () => {
    expect(hashApiKey('a')).not.toBe(hashApiKey('b'));
  });
});

describe('isValidApiKeyFormat', () => {
  it('accepts a well-formed key', () => {
    expect(isValidApiKeyFormat('lod_live_' + 'a'.repeat(48))).toBe(true);
  });

  it('rejects wrong prefix, wrong length, uppercase, and non-hex', () => {
    expect(isValidApiKeyFormat('lod_test_' + 'a'.repeat(48))).toBe(false); // wrong prefix
    expect(isValidApiKeyFormat('lod_live_' + 'a'.repeat(47))).toBe(false); // too short
    expect(isValidApiKeyFormat('lod_live_' + 'a'.repeat(49))).toBe(false); // too long
    expect(isValidApiKeyFormat('lod_live_' + 'A'.repeat(48))).toBe(false); // uppercase hex
    expect(isValidApiKeyFormat('lod_live_' + 'g'.repeat(48))).toBe(false); // non-hex char
    expect(isValidApiKeyFormat('')).toBe(false);
    expect(isValidApiKeyFormat('lod_live_')).toBe(false); // no body
  });

  it('rejects a key with surrounding whitespace (anchored regex)', () => {
    expect(isValidApiKeyFormat(' lod_live_' + 'a'.repeat(48))).toBe(false);
    expect(isValidApiKeyFormat('lod_live_' + 'a'.repeat(48) + '\n')).toBe(false);
  });

  it('API_KEY_RE is exported and anchored', () => {
    expect(API_KEY_RE.source).toBe('^lod_live_[0-9a-f]{48}$');
  });
});
