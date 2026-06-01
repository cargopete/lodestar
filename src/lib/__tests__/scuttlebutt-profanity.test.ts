import { describe, it, expect } from 'vitest';
import { clean } from '@/lib/scuttlebutt-profanity';

describe('clean', () => {
  it('flags empty/whitespace-only bodies as not ok', () => {
    expect(clean('').ok).toBe(false);
    expect(clean('    ').ok).toBe(false);
  });

  it('leaves clean text untouched', () => {
    const r = clean('hello there, fellow sailor');
    expect(r.ok).toBe(true);
    expect(r.filtered).toBe('hello there, fellow sailor');
  });

  it('masks blocklisted words with same-length asterisks', () => {
    const r = clean('what the shit');
    expect(r.filtered).toBe('what the ****');
  });

  it('is case-insensitive', () => {
    expect(clean('SHIT').filtered).toBe('****');
  });

  it('only masks whole words', () => {
    // "dick" is blocked, but "Dickens" should survive
    expect(clean('Charles Dickens').filtered).toBe('Charles Dickens');
  });

  it('trims surrounding whitespace', () => {
    expect(clean('  hi  ').filtered).toBe('hi');
  });
});
