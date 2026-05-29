import { describe, it, expect } from 'vitest';
import {
  detectStatus,
  formatMessage,
  type DeploymentHealth,
} from '../alerts';

function health(over: Partial<DeploymentHealth> = {}): DeploymentHealth {
  return {
    totalIndexers: 1,
    syncedCount: 1,
    failedCount: 0,
    bestBlocksBehind: 0,
    ...over,
  };
}

describe('detectStatus', () => {
  it('flags lagging with "no indexers" when there are none', () => {
    expect(detectStatus(health({ totalIndexers: 0, syncedCount: 0 }), 5000)).toBe('lagging');
  });

  it('flags failed when all indexers failed and none are synced', () => {
    expect(
      detectStatus(health({ totalIndexers: 2, syncedCount: 0, failedCount: 2 }), 5000),
    ).toBe('failed');
  });

  it('prefers lagging over failed if something is still synced', () => {
    expect(
      detectStatus(health({ totalIndexers: 2, syncedCount: 1, failedCount: 1 }), 5000),
    ).toBe('ok');
  });

  it('flags lagging when no indexer is fully synced', () => {
    expect(
      detectStatus(
        health({ totalIndexers: 2, syncedCount: 0, failedCount: 0, bestBlocksBehind: 200 }),
        5000,
      ),
    ).toBe('lagging');
  });

  it('flags lagging when the best indexer is beyond the threshold', () => {
    expect(
      detectStatus(health({ syncedCount: 1, bestBlocksBehind: 9000 }), 5000),
    ).toBe('lagging');
  });

  it('stays ok when a synced indexer is within the threshold', () => {
    expect(detectStatus(health({ syncedCount: 1, bestBlocksBehind: 100 }), 5000)).toBe('ok');
  });

  it('stays ok when blocksBehind is unknown but an indexer is synced', () => {
    expect(
      detectStatus(health({ syncedCount: 1, bestBlocksBehind: undefined }), 5000),
    ).toBe('ok');
  });

  it('returns ok for a healthy synced deployment', () => {
    expect(detectStatus(health(), 5000)).toBe('ok');
  });
});

describe('formatMessage', () => {
  it('formats a lagging message with thousands-separated lag', () => {
    const { content, text } = formatMessage('lagging', 'QmAbc1234567890wxyz', 'My Subgraph', 6200);
    expect(content).toContain('⚠️');
    expect(content).toContain('My Subgraph');
    expect(content).toContain('6,200 blocks behind');
    expect(content).toBe(text); // both keys identical
  });

  it('formats a failed message with the error text', () => {
    const { content } = formatMessage(
      'failed',
      'QmAbc1234567890wxyz',
      'My Subgraph',
      undefined,
      'handler reverted',
    );
    expect(content).toContain('❌');
    expect(content).toContain('fatal error: handler reverted');
  });

  it('formats a recovered message', () => {
    const { content } = formatMessage('recovered', 'QmAbc1234567890wxyz', 'My Subgraph');
    expect(content).toContain('✅');
    expect(content).toContain('recovered');
  });

  it('falls back to "subgraph" when label is null', () => {
    const { content } = formatMessage('recovered', 'QmAbc1234567890wxyz', null);
    expect(content).toContain('"subgraph"');
  });

  it('shortens the deployment id', () => {
    const { content } = formatMessage('recovered', 'QmAbcdef1234567890wxyz', 'X');
    expect(content).toContain('QmAbcd…wxyz');
  });
});
