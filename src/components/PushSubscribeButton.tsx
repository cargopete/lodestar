'use client';

import { useAccount, useConnect } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { useState } from 'react';
import { usePushStatus, useTogglePushSubscription } from '@/hooks/usePushSubscription';
import { cn } from '@/lib/utils';

interface PushSubscribeButtonProps {
  className?: string;
}

export function PushSubscribeButton({ className }: PushSubscribeButtonProps) {
  const { isConnected } = useAccount();
  const { connect } = useConnect();
  const { data: subscribed, isLoading: statusLoading } = usePushStatus();
  const { mutate: toggle, isPending, error, reset } = useTogglePushSubscription();
  const [toast, setToast] = useState<string | null>(null);

  const handleClick = () => {
    if (error) { reset(); return; }
    if (!isConnected) { connect({ connector: injected() }); return; }

    toggle(!!subscribed, {
      onSuccess: (nowSubscribed) => {
        setToast(nowSubscribed ? 'Notifications enabled' : 'Notifications disabled');
        setTimeout(() => setToast(null), 2500);
      },
    });
  };

  const label = error
    ? 'Failed, retry?'
    : isPending
      ? subscribed ? 'Unsubscribing…' : 'Signing…'
      : statusLoading
        ? '…'
        : subscribed
          ? '🔔 Subscribed'
          : isConnected
            ? '🔔 Get alerts'
            : '🔔 Connect for alerts';

  return (
    <div className="relative inline-flex">
      <button
        onClick={handleClick}
        disabled={isPending || statusLoading}
        title={error?.message ?? (subscribed ? 'Click to disable notifications' : 'Get notified when your indexer changes cuts or goes inactive')}
        className={cn(
          'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
          error
            ? 'bg-[var(--red)]/15 text-[var(--red)] hover:bg-[var(--red)]/25'
            : subscribed
              ? 'bg-[var(--green)]/15 text-[var(--green)] hover:bg-[var(--green)]/25'
              : 'bg-[var(--accent)]/15 text-[var(--accent-text)] hover:bg-[var(--accent)]/25',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          className
        )}
      >
        {label}
      </button>
      {toast && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 text-xs font-medium rounded-md bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-muted)] whitespace-nowrap shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
