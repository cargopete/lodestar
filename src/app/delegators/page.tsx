'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/utils';

export default function DelegatorsPage() {
  const [address, setAddress] = useState('');
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = address.trim();
    if (trimmed) {
      router.push(`/delegators/${trimmed}`);
    }
  };

  const isValidAddress = /^0x[a-fA-F0-9]{40}$/.test(address.trim());

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="w-16 h-16 rounded-full bg-[var(--accent-dim)] flex items-center justify-center mb-6">
        <svg className="w-8 h-8 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
        </svg>
      </div>
      <h2 className="text-xl font-semibold text-[var(--text)] mb-2">Delegator Portfolio</h2>
      <p className="text-[var(--text-muted)] max-w-md mb-8">
        Enter a delegator address to view their portfolio, delegation positions, and rebalancing insights.
      </p>

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

      <p className="text-[11px] text-[var(--text-faint)] mt-6">
        Or connect your wallet using the button in the top right corner
      </p>
    </div>
  );
}
