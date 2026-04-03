import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock browser APIs before importing the module
const mockClick = vi.fn();
const mockAppendChild = vi.fn();
const mockRemoveChild = vi.fn();
const mockCreateElement = vi.fn(() => ({
  href: '',
  download: '',
  click: mockClick,
}));
const mockRevokeObjectURL = vi.fn();
const mockCreateObjectURL = vi.fn(() => 'blob:mock-url');
const mockBlob = vi.fn();

// Install globals
Object.defineProperty(globalThis, 'Blob', { value: mockBlob, writable: true, configurable: true });
Object.defineProperty(globalThis, 'URL', {
  value: { createObjectURL: mockCreateObjectURL, revokeObjectURL: mockRevokeObjectURL },
  writable: true,
  configurable: true,
});
Object.defineProperty(globalThis, 'document', {
  value: {
    createElement: mockCreateElement,
    body: {
      appendChild: mockAppendChild,
      removeChild: mockRemoveChild,
    },
  },
  writable: true,
  configurable: true,
});

import { downloadThawingReminder } from '../calendar';

describe('downloadThawingReminder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateObjectURL.mockReturnValue('blob:mock-url');
    mockCreateElement.mockReturnValue({ href: '', download: '', click: mockClick });
  });

  it('creates a Blob with ICS content', () => {
    downloadThawingReminder({
      lockedUntil: 1800000000,
      amountGRT: 5000,
      indexerName: 'GraphOps',
    });
    expect(mockBlob).toHaveBeenCalledOnce();
    const [content, opts] = mockBlob.mock.calls[0] as [string[], { type: string }];
    expect(opts.type).toContain('text/calendar');
    expect(content[0]).toContain('BEGIN:VCALENDAR');
  });

  it('includes the indexer name in the ICS content', () => {
    downloadThawingReminder({
      lockedUntil: 1800000000,
      amountGRT: 1000,
      indexerName: 'StakeFish',
    });
    const [content] = mockBlob.mock.calls[0] as [string[], unknown];
    const ics = content[0];
    expect(ics).toContain('StakeFish');
  });

  it('includes GRT amount in the summary', () => {
    downloadThawingReminder({
      lockedUntil: 1800000000,
      amountGRT: 12345,
      indexerName: 'Indexer One',
    });
    const [content] = mockBlob.mock.calls[0] as [string[], unknown];
    const ics = content[0];
    expect(ics).toContain('12,345');
  });

  it('creates an anchor element and clicks it', () => {
    downloadThawingReminder({
      lockedUntil: 1800000000,
      amountGRT: 100,
      indexerName: 'TestIndexer',
    });
    expect(mockCreateElement).toHaveBeenCalledWith('a');
    expect(mockClick).toHaveBeenCalled();
  });

  it('appends and removes the anchor from body', () => {
    downloadThawingReminder({
      lockedUntil: 1800000000,
      amountGRT: 100,
      indexerName: 'TestIndexer',
    });
    expect(mockAppendChild).toHaveBeenCalled();
    expect(mockRemoveChild).toHaveBeenCalled();
  });

  it('revokes the object URL after download', () => {
    downloadThawingReminder({
      lockedUntil: 1800000000,
      amountGRT: 100,
      indexerName: 'TestIndexer',
    });
    expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('sets a sane filename from indexer name', () => {
    const anchor = { href: '', download: '', click: mockClick };
    mockCreateElement.mockReturnValue(anchor);
    downloadThawingReminder({
      lockedUntil: 1800000000,
      amountGRT: 100,
      indexerName: 'Graph Ops!',
    });
    expect(anchor.download).toMatch(/graph-ops.*\.ics/);
  });

  it('ICS content contains VCALENDAR structure', () => {
    downloadThawingReminder({
      lockedUntil: 1800000000,
      amountGRT: 500,
      indexerName: 'TestNode',
    });
    const [content] = mockBlob.mock.calls[0] as [string[], unknown];
    const ics = content[0];
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('END:VEVENT');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics).toContain('BEGIN:VALARM');
  });
});
