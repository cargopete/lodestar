import { describe, it, expect } from 'vitest';
import { signalExposure, riskPriority, worstFlagLevel } from '../disassembly/signal';

describe('signalExposure', () => {
  it('buckets GRT signalled into exposure levels', () => {
    expect(signalExposure(0)).toBe('none');
    expect(signalExposure(-5)).toBe('none');
    expect(signalExposure(1)).toBe('low');
    expect(signalExposure(999)).toBe('low');
    expect(signalExposure(1_000)).toBe('medium');
    expect(signalExposure(49_999)).toBe('medium');
    expect(signalExposure(50_000)).toBe('high');
    expect(signalExposure(412_000)).toBe('high');
  });
});

describe('worstFlagLevel', () => {
  it('returns the highest-severity level present', () => {
    expect(worstFlagLevel([])).toBe('none');
    expect(worstFlagLevel(['info'])).toBe('info');
    expect(worstFlagLevel(['info', 'warn'])).toBe('warn');
    expect(worstFlagLevel(['warn', 'critical', 'info'])).toBe('critical');
  });
});

describe('riskPriority', () => {
  it('keeps clean / info-only code low priority regardless of signal', () => {
    expect(riskPriority('none', 'high')).toBe('low');
    expect(riskPriority('info', 'high')).toBe('low');
  });

  it('escalates a warn flag with signal', () => {
    expect(riskPriority('warn', 'none')).toBe('low');
    expect(riskPriority('warn', 'low')).toBe('low');
    expect(riskPriority('warn', 'medium')).toBe('medium');
    expect(riskPriority('warn', 'high')).toBe('high');
  });

  it('escalates a critical flag harder — only critical+high signal is critical', () => {
    expect(riskPriority('critical', 'none')).toBe('medium');
    expect(riskPriority('critical', 'low')).toBe('medium');
    expect(riskPriority('critical', 'medium')).toBe('high');
    expect(riskPriority('critical', 'high')).toBe('critical');
  });
});
