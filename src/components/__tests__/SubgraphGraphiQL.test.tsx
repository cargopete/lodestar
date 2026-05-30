// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// The real GraphiQL pulls in CodeMirror et al — mock it to a lightweight stand-in.
vi.mock('graphiql', () => ({
  GraphiQL: ({ defaultQuery }: { defaultQuery?: string }) => (
    <div data-testid="graphiql" data-default-query={defaultQuery} />
  ),
}));
vi.mock('graphiql/style.css', () => ({}));

const createFetcher = vi.fn(() => vi.fn());
vi.mock('@graphiql/toolkit', () => ({
  createGraphiQLFetcher: (...args: unknown[]) => (createFetcher as (...a: unknown[]) => unknown)(...args),
}));

import SubgraphGraphiQL from '../SubgraphGraphiQL';

describe('SubgraphGraphiQL', () => {
  it('mounts the GraphiQL IDE', () => {
    render(<SubgraphGraphiQL hash="QmTestHash" />);
    expect(screen.getByTestId('graphiql')).toBeInTheDocument();
  });

  it('wires the fetcher to the server-side playground proxy for the deployment', () => {
    render(<SubgraphGraphiQL hash="QmTestHash" />);
    expect(createFetcher).toHaveBeenCalledWith({ url: '/api/subgraph-playground/QmTestHash' });
  });

  it('seeds a default introspection-friendly query', () => {
    render(<SubgraphGraphiQL hash="QmTestHash" />);
    expect(screen.getByTestId('graphiql').getAttribute('data-default-query')).toContain('_meta');
  });
});
