// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DelegationStatusBadge } from '../DelegationStatusBadge';

describe('DelegationStatusBadge', () => {
  it('renders "Withdrawable" with a ready-to-withdraw hint', () => {
    render(<DelegationStatusBadge status="withdrawable" />);
    const badge = screen.getByText('Withdrawable');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute('title', expect.stringContaining('ready to withdraw'));
  });

  it('renders "Thawing" for an in-progress thaw', () => {
    render(<DelegationStatusBadge status="thawing" />);
    expect(screen.getByText('Thawing')).toBeInTheDocument();
  });

  it('renders "Active" for an active position', () => {
    render(<DelegationStatusBadge status="active" />);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('renders "Closed" for a closed position', () => {
    render(<DelegationStatusBadge status="closed" />);
    expect(screen.getByText('Closed')).toBeInTheDocument();
  });

  it('shows distinct labels — withdrawable is not the same as thawing', () => {
    const { rerender } = render(<DelegationStatusBadge status="withdrawable" />);
    expect(screen.queryByText('Thawing')).not.toBeInTheDocument();
    rerender(<DelegationStatusBadge status="thawing" />);
    expect(screen.queryByText('Withdrawable')).not.toBeInTheDocument();
  });
});
