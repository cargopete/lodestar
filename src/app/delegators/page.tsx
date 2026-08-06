'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAccount } from 'wagmi';
import { Card } from '@/components/ui/Card';
import { DelegationFeed } from '@/components/feed/DelegationFeed';
import dynamic from 'next/dynamic';

const DelegationFlowChart = dynamic(() => import('@/components/charts/DelegationFlowChart').then(m => ({ default: m.DelegationFlowChart })), { ssr: false });
const TokenIssuanceChart = dynamic(() => import('@/components/charts/TokenIssuanceChart').then(m => ({ default: m.TokenIssuanceChart })), { ssr: false });
import { shortenAddress, cn } from '@/lib/utils';

export default function DelegatorsPage() {
  const [address, setAddress] = useState('');
  const router = useRouter();
  const { address: connectedAddress, isConnected } = useAccount();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = address.trim();
    if (trimmed) {
      router.push(`/delegators/${trimmed}`);
    }
  };

  const isValidAddress = /^0x[a-fA-F0-9]{40}$/.test(address.trim());

  return (
    <div className="space-y-8">
    <div className="flex flex-col items-center justify-center text-center pt-4">
      <div className="w-16 h-16 rounded-full bg-[var(--accent-dim)] flex items-center justify-center mb-6">
        <svg className="w-8 h-8 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
        </svg>
      </div>
      <h2 className="text-xl font-semibold text-[var(--text)] mb-2">Delegator Portfolio</h2>
      <p className="text-[var(--text-muted)] max-w-md mb-8">
        Enter a delegator address to view their portfolio and delegation positions.
      </p>

      {/* Connected wallet shortcuts */}
      {isConnected && connectedAddress && (
        <div className="w-full max-w-lg space-y-3 mb-4">
          <Link
            href={`/delegators/${connectedAddress}`}
            className={cn(
              'w-full flex items-center justify-between px-5 py-4',
              'rounded-[var(--radius-button)] border border-[var(--accent)]',
              'bg-[var(--accent-dim)] hover:bg-[var(--accent)]/20 transition-colors'
            )}
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-[var(--accent)] flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                </svg>
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-[var(--accent)]">View My Portfolio</p>
                <p className="text-[11px] font-mono text-[var(--text-muted)]">{shortenAddress(connectedAddress, 6)}</p>
              </div>
            </div>
            <svg className="w-5 h-5 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </Link>
          <Link
            href="/delegate"
            className={cn(
              'w-full flex items-center justify-between px-5 py-4',
              'rounded-[var(--radius-button)] border border-[var(--border)]',
              'bg-[var(--bg-surface)] hover:border-[var(--accent-hover)] transition-colors'
            )}
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-[var(--bg-elevated)] flex items-center justify-center">
                <svg className="w-4 h-4 text-[var(--green)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-[var(--text)]">Delegate GRT</p>
                <p className="text-[11px] text-[var(--text-muted)]">We pick the best indexer; enter an amount and confirm</p>
              </div>
            </div>
            <svg className="w-5 h-5 text-[var(--text-faint)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </Link>
        </div>
      )}

      <Card className="w-full max-w-lg">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="0x... delegator address"
            className={cn(
              'w-full px-4 py-3 text-sm font-mono',
              'rounded-[var(--radius-button)]',
              'bg-[var(--bg-elevated)] border-[0.5px] border-[var(--border)]',
              'text-[var(--text)] placeholder:text-[var(--text-faint)]',
              'focus:outline-none focus:border-[var(--accent)]',
              'transition-colors duration-200'
            )}
          />
          <button
            type="submit"
            disabled={!isValidAddress}
            className={cn(
              'px-6 py-3 text-sm font-medium',
              'rounded-[var(--radius-button)]',
              'transition-all duration-200',
              isValidAddress
                ? 'bg-[var(--accent)] text-white hover:opacity-90 cursor-pointer'
                : 'bg-[var(--bg-elevated)] text-[var(--text-faint)] cursor-not-allowed'
            )}
          >
            View Portfolio
          </button>
        </form>
      </Card>

      {!isConnected && (
        <p className="text-[11px] text-[var(--text-faint)] mt-6">
          Or connect your wallet using the button in the top right corner
        </p>
      )}
    </div>

    {/* Network-wide delegation flows */}
    <DelegationFlowChart />

    {/* Token issuance & burn */}
    <TokenIssuanceChart />

    {/* Network-wide delegation activity */}
    <DelegationFeed />
    </div>
  );
}
