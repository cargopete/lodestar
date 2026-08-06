'use client';

import { cn } from '@/lib/utils';

interface Step {
  label: string;
  status: 'pending' | 'active' | 'done' | 'error';
}

interface TransactionStatusProps {
  steps: Step[];
  txHash?: `0x${string}`;
  error?: string | null;
  className?: string;
}

export function TransactionStatus({ steps, txHash, error, className }: TransactionStatusProps) {
  return (
    <div className={cn('space-y-3', className)}>
      {/* Step indicators */}
      <div className="flex items-center gap-2">
        {steps.map((step, i) => (
          <div key={step.label} className="flex items-center gap-2 flex-1">
            {/* Circle */}
            <div className={cn(
              'w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold',
              step.status === 'done' && 'bg-[var(--green)] text-white',
              step.status === 'active' && 'bg-[var(--accent)] text-white',
              step.status === 'error' && 'bg-[var(--red)] text-white',
              step.status === 'pending' && 'bg-[var(--bg-elevated)] text-[var(--text-faint)] border border-[var(--border)]',
            )}>
              {step.status === 'done' ? (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : step.status === 'active' ? (
                <div className="w-2.5 h-2.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : step.status === 'error' ? (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                i + 1
              )}
            </div>
            <span className={cn(
              'text-xs whitespace-nowrap',
              step.status === 'active' && 'text-[var(--accent-text)] font-medium',
              step.status === 'done' && 'text-[var(--green)]',
              step.status === 'error' && 'text-[var(--red)]',
              step.status === 'pending' && 'text-[var(--text-faint)]',
            )}>
              {step.label}
            </span>
            {/* Connector line */}
            {i < steps.length - 1 && (
              <div className={cn(
                'flex-1 h-px',
                step.status === 'done' ? 'bg-[var(--green)]' : 'bg-[var(--border)]'
              )} />
            )}
          </div>
        ))}
      </div>

      {/* Error message */}
      {error && (
        <p className="text-xs text-[var(--red)] bg-[var(--red-dim)] px-3 py-2 rounded-md">
          {error}
        </p>
      )}

      {/* Tx link */}
      {txHash && (
        <a
          href={`https://arbiscan.io/tx/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-[var(--accent-text)] hover:underline"
        >
          View on Arbiscan
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      )}
    </div>
  );
}
