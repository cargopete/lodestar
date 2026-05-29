// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VersionsTable } from '../VersionsTable';
import type { SubgraphVersion } from '@/hooks/useNetworkStats';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const VERSIONS: SubgraphVersion[] = [
  { version: 1, label: '0.0.3', createdAt: 1711047781, ipfsHash: 'QmCurrentHashAAAAAAAAAA', signalledTokens: '100000000000000000000', stakedTokens: '0', isCurrent: true },
  { version: 0, label: '0.0.2', createdAt: 1701215330, ipfsHash: 'QmOldHashBBBBBBBBBBBBBB', signalledTokens: '50000000000000000000', stakedTokens: '0', isCurrent: false },
];

describe('VersionsTable', () => {
  it('renders a row per version with its semver label', () => {
    render(<VersionsTable versions={VERSIONS} />);
    expect(screen.getByText('0.0.3')).toBeInTheDocument();
    expect(screen.getByText('0.0.2')).toBeInTheDocument();
  });

  it('flags the current version with a "Current" badge', () => {
    render(<VersionsTable versions={VERSIONS} />);
    expect(screen.getByText('Current')).toBeInTheDocument();
  });

  it('links non-current versions to their deployment but not the current one', () => {
    render(<VersionsTable versions={VERSIONS} />);
    const links = screen.getAllByRole('link');
    // Only the old (non-current) version is a link
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/subgraphs/QmOldHashBBBBBBBBBBBBBB');
  });

  it('falls back to v{version} when no semver label is present', () => {
    render(<VersionsTable versions={[{ ...VERSIONS[0], label: null }]} />);
    expect(screen.getByText('v1')).toBeInTheDocument();
  });
});
