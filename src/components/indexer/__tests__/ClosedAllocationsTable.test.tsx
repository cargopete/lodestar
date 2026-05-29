// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClosedAllocationsTable, type ClosedAllocation } from '../ClosedAllocationsTable';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

function alloc(overrides: Partial<ClosedAllocation> = {}): ClosedAllocation {
  return {
    id: '0xalloc1',
    allocatedTokens: '5000000000000000000000',
    createdAtEpoch: 100,
    closedAtEpoch: 120,
    closedAt: 1700000000,
    indexingRewards: '1000000000000000000',
    queryFeesCollected: '0',
    poi: '0xpoi',
    forceClosed: false,
    subgraphDeployment: {
      id: '0xdeployment',
      ipfsHash: 'QmDeploymentHashAAAAAA',
      versions: [{ subgraph: { metadata: { displayName: 'My Subgraph' } } }],
    },
    ...overrides,
  };
}

describe('ClosedAllocationsTable', () => {
  it('renders the deployment display name and links to the subgraph', () => {
    render(<ClosedAllocationsTable allocations={[alloc()]} />);
    const link = screen.getByRole('link', { name: 'My Subgraph' });
    expect(link).toHaveAttribute('href', '/subgraphs/QmDeploymentHashAAAAAA');
  });

  it('computes allocation duration in epochs', () => {
    render(<ClosedAllocationsTable allocations={[alloc({ createdAtEpoch: 100, closedAtEpoch: 120 })]} />);
    expect(screen.getByText('20 ep')).toBeInTheDocument();
  });

  it('shows a dash for query fees when none were collected', () => {
    render(<ClosedAllocationsTable allocations={[alloc({ queryFeesCollected: '0' })]} />);
    // Both query fees and (here) any zero-value cell render a dash
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('flags force-closed allocations', () => {
    render(<ClosedAllocationsTable allocations={[alloc({ forceClosed: true })]} />);
    expect(screen.getByText('force closed')).toBeInTheDocument();
  });

  it('does not flag normally-closed allocations', () => {
    render(<ClosedAllocationsTable allocations={[alloc({ forceClosed: false })]} />);
    expect(screen.queryByText('force closed')).not.toBeInTheDocument();
  });

  it('falls back to the deployment id when no display name exists', () => {
    render(<ClosedAllocationsTable allocations={[alloc({
      subgraphDeployment: { id: '0xdeadbeef00000000000000000000000000000000', ipfsHash: 'QmX', versions: [] },
    })]} />);
    // shortenAddress output of the id appears (no display name)
    expect(screen.getByText(/0xdead/i)).toBeInTheDocument();
  });
});
