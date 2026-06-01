import { describe, it, expect, beforeAll } from 'vitest';
import { parseName, makeTripcode } from '@/lib/scuttlebutt-trip';

beforeAll(() => {
  process.env.SCUTTLEBUTT_TRIP_SALT = 'test-salt';
});

describe('parseName', () => {
  it('returns null name and trip for empty input', () => {
    expect(parseName('')).toEqual({ name: null, tripcode: null });
    expect(parseName(null)).toEqual({ name: null, tripcode: null });
    expect(parseName(undefined)).toEqual({ name: null, tripcode: null });
  });

  it('parses a plain name with no tripcode', () => {
    expect(parseName('Pete')).toEqual({ name: 'Pete', tripcode: null });
  });

  it('splits Name#secret into name + tripcode', () => {
    const { name, tripcode } = parseName('Pete#hunter2');
    expect(name).toBe('Pete');
    expect(tripcode).toMatch(/^![A-Za-z0-9]{1,10}$/);
  });

  it('supports anonymous poster with a tripcode (#secret)', () => {
    const { name, tripcode } = parseName('#hunter2');
    expect(name).toBeNull();
    expect(tripcode).toMatch(/^!/);
  });

  it('truncates over-long names', () => {
    const long = 'a'.repeat(100);
    expect(parseName(long).name).toHaveLength(40);
  });

  it('handles unicode names', () => {
    expect(parseName('⚓Salty').name).toBe('⚓Salty');
  });
});

describe('makeTripcode', () => {
  it('is deterministic for the same secret', () => {
    expect(makeTripcode('hunter2')).toBe(makeTripcode('hunter2'));
  });

  it('differs for different secrets', () => {
    expect(makeTripcode('hunter2')).not.toBe(makeTripcode('hunter3'));
  });

  it('depends on the salt (secrecy)', () => {
    const a = makeTripcode('hunter2');
    process.env.SCUTTLEBUTT_TRIP_SALT = 'different-salt';
    const b = makeTripcode('hunter2');
    process.env.SCUTTLEBUTT_TRIP_SALT = 'test-salt';
    expect(a).not.toBe(b);
  });
});
