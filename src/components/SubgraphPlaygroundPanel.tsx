'use client';

import { useCallback, useMemo, useState } from 'react';
import { useAccount, useChainId, useConnect, useSwitchChain, useWalletClient } from 'wagmi';
import { injected } from 'wagmi/connectors';
import type { Fetcher } from '@graphiql/toolkit';
import SubgraphGraphiQL from './SubgraphGraphiQL';
import {
  X402Error,
  activeX402ChainId,
  activeX402ChainLabel,
  payAndQuery,
  quote,
  toX402Signer,
} from '@/lib/x402-client';

type Mode = 'key' | 'keyless';

/**
 * The subgraph playground, with an escape hatch.
 *
 * Default mode proxies through Lodestar's own Graph API key. Keyless mode pays
 * the gateway per query in USDC and needs no API key at all, which is the only
 * way to query a published subgraph while a freshly minted Studio key is still
 * propagating (measured at ~9 minutes; nightswatchhq/graph-support#22).
 *
 * Keyless does not conjure indexers. A subgraph published moments ago has no
 * allocation yet and will answer `no indexers found` however you pay for it.
 */
export default function SubgraphPlaygroundPanel({ hash }: { hash: string }) {
  const [mode, setMode] = useState<Mode>('key');
  const [price, setPrice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { isConnected } = useAccount();
  const { connect } = useConnect();
  const { data: walletClient } = useWalletClient();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  const wantedChainId = activeX402ChainId();
  const wantedChain = activeX402ChainLabel();
  const onWrongChain = isConnected && chainId !== wantedChainId;
  const ready = mode === 'keyless' ? Boolean(walletClient) && !onWrongChain : true;

  const keylessFetcher = useCallback<Fetcher>(
    async (params) => {
      if (!walletClient) throw new X402Error('Connect a wallet to pay for this query');
      const target = { deployment: hash };
      setError(null);
      try {
        const q = await quote(target, params.query, params.variables);
        if (!q) throw new X402Error('Gateway did not ask for payment');
        setPrice(q.priceUsdc);
        // The wallet's own signing prompt is the per-query confirmation; it
        // shows the exact amount and recipient, so we do not add a second one.
        return await payAndQuery(target, params.query, {
          signer: toX402Signer(walletClient),
          quote: q,
          variables: params.variables,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
        throw e;
      }
    },
    [hash, walletClient],
  );

  const fetcher = useMemo(
    () => (mode === 'keyless' && ready ? keylessFetcher : undefined),
    [mode, ready, keylessFetcher],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div
          role="radiogroup"
          aria-label="Query authentication"
          className="inline-flex rounded-[var(--radius-card)] border border-[var(--border)] overflow-hidden"
        >
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'key'}
            onClick={() => setMode('key')}
            className={`px-3 py-1.5 ${mode === 'key' ? 'bg-[var(--border)]' : ''}`}
          >
            Lodestar key
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'keyless'}
            onClick={() => setMode('keyless')}
            className={`px-3 py-1.5 ${mode === 'keyless' ? 'bg-[var(--border)]' : ''}`}
          >
            No API key (pay per query)
          </button>
        </div>

        {mode === 'keyless' && (
          <span className="opacity-70">
            {price ? `${price} USDC per query` : 'Pays the gateway directly'} on {wantedChain}. No
            gas.
          </span>
        )}
      </div>

      {mode === 'keyless' && !isConnected && (
        <p className="text-sm">
          <button
            type="button"
            onClick={() => connect({ connector: injected() })}
            className="underline"
          >
            Connect a wallet
          </button>{' '}
          holding USDC on {wantedChain}. Each query is signed individually and costs no gas.
        </p>
      )}

      {mode === 'keyless' && onWrongChain && (
        <p className="text-sm">
          Your wallet is on the wrong network.{' '}
          <button
            type="button"
            onClick={() => switchChain({ chainId: wantedChainId })}
            className="underline"
          >
            Switch to {wantedChain}
          </button>
        </p>
      )}

      {mode === 'keyless' && error && (
        <p role="alert" className="text-sm text-[var(--danger,#c0392b)]">
          {error}
        </p>
      )}

      <SubgraphGraphiQL hash={hash} fetcher={fetcher} />
    </div>
  );
}
