import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// recordDeficiency appends to a markdown file at the repo root. We mock node:fs
// so the test never touches disk, and reset the module between tests because
// the de-dup `seen` set is module-scoped.

const appendFileSync = vi.fn();
const writeFileSync = vi.fn();
const existsSync = vi.fn();

vi.mock('node:fs', () => ({
  appendFileSync: (...a: unknown[]) => appendFileSync(...a),
  writeFileSync: (...a: unknown[]) => writeFileSync(...a),
  existsSync: (...a: unknown[]) => existsSync(...a),
}));

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetModules();
  appendFileSync.mockReset();
  writeFileSync.mockReset();
  existsSync.mockReset();
  existsSync.mockReturnValue(true); // header already present by default
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

async function importFresh() {
  return await import('../deficiencies');
}

describe('recordDeficiency', () => {
  it('records a new deficiency and exposes it via listDeficiencies', async () => {
    const { recordDeficiency, listDeficiencies } = await importFresh();
    recordDeficiency('CODE_A', 'something broke');
    expect(listDeficiencies()).toEqual(['CODE_A::something broke']);
    expect(appendFileSync).toHaveBeenCalledTimes(1);
  });

  it('de-duplicates identical code+detail pairs', async () => {
    const { recordDeficiency, listDeficiencies } = await importFresh();
    recordDeficiency('CODE_A', 'dup');
    recordDeficiency('CODE_A', 'dup');
    expect(listDeficiencies()).toHaveLength(1);
    expect(appendFileSync).toHaveBeenCalledTimes(1);
  });

  it('treats the same code with different detail as distinct entries', async () => {
    const { recordDeficiency, listDeficiencies } = await importFresh();
    recordDeficiency('CODE_A', 'detail one');
    recordDeficiency('CODE_A', 'detail two');
    expect(listDeficiencies()).toHaveLength(2);
    expect(appendFileSync).toHaveBeenCalledTimes(2);
  });

  it('writes the header when the log file does not yet exist', async () => {
    existsSync.mockReturnValue(false);
    const { recordDeficiency } = await importFresh();
    recordDeficiency('CODE_B', 'first ever');
    expect(writeFileSync).toHaveBeenCalledTimes(1);
    const headerArg = writeFileSync.mock.calls[0][1] as string;
    expect(headerArg).toContain('# Token API deficiencies');
  });

  it('escapes pipe characters in the appended detail', async () => {
    const { recordDeficiency } = await importFresh();
    recordDeficiency('CODE_C', 'a | b | c');
    const appended = appendFileSync.mock.calls[0][1] as string;
    expect(appended).toContain('a \\| b \\| c');
    expect(appended).toContain('`CODE_C`');
  });

  it('does not throw when the filesystem append fails', async () => {
    appendFileSync.mockImplementation(() => {
      throw new Error('EACCES');
    });
    const { recordDeficiency, listDeficiencies } = await importFresh();
    expect(() => recordDeficiency('CODE_D', 'noisy disk')).not.toThrow();
    // The in-memory record still landed.
    expect(listDeficiencies()).toContain('CODE_D::noisy disk');
  });

  it('warns to the console with the code and detail on first record', async () => {
    const { recordDeficiency } = await importFresh();
    recordDeficiency('CODE_E', 'console please');
    expect(warnSpy).toHaveBeenCalledWith('[token-api-deficiency] CODE_E: console please');
  });

  it('does not write the header again when the log already exists', async () => {
    existsSync.mockReturnValue(true);
    const { recordDeficiency } = await importFresh();
    recordDeficiency('CODE_F', 'no header rewrite');
    expect(writeFileSync).not.toHaveBeenCalled();
    expect(appendFileSync).toHaveBeenCalledTimes(1);
  });

  it('starts each fresh module load with an empty seen set', async () => {
    const { listDeficiencies } = await importFresh();
    expect(listDeficiencies()).toEqual([]);
  });
});
