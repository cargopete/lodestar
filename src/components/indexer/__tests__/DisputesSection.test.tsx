// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { IndexerDispute } from '@/hooks/useNetworkStats';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

// Mock the hook so the section renders synchronously with controlled data.
let mockData: { disputes: IndexerDispute[] };
let mockLoading = false;
vi.mock('@/hooks/useNetworkStats', () => ({
  useIndexerDisputes: () => ({ data: mockData, isLoading: mockLoading }),
}));

import { DisputesSection } from '../DisputesSection';

function dispute(over: Partial<IndexerDispute> = {}): IndexerDispute {
  return {
    id: 'd1', dispute_type: 'Indexing', fisherman: '0xf1', allocation_id: '0xa1',
    deployment_id: 'QmDep', status: 'Accepted', tokens_slashed_grt: '100',
    tokens_burned_grt: '25', created_at: '2026-01-01T00:00:00Z', closed_at: null,
    ...over,
  };
}

describe('DisputesSection', () => {
  it('shows a clean-record message when there are no disputes', () => {
    mockData = { disputes: [] }; mockLoading = false;
    render(<DisputesSection address="0x1" />);
    expect(screen.getByText(/never been disputed or slashed/i)).toBeInTheDocument();
    expect(screen.getByText('Clean record')).toBeInTheDocument();
  });

  it('renders a dispute row with type, status and slashed amount', () => {
    mockData = { disputes: [dispute()] }; mockLoading = false;
    render(<DisputesSection address="0x1" />);
    expect(screen.getByText('Indexing')).toBeInTheDocument();
    expect(screen.getByText('Accepted')).toBeInTheDocument();
    expect(screen.getByText(/100/)).toBeInTheDocument(); // slashed GRT
  });

  it('dashes out a zero slashed/burned amount', () => {
    mockData = { disputes: [dispute({ tokens_slashed_grt: '0', tokens_burned_grt: '0', status: 'Rejected' })] };
    mockLoading = false;
    render(<DisputesSection address="0x1" />);
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
