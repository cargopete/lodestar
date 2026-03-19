'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { useWalletStore, type WatchedWallet } from '@/hooks/useWalletStore';
import { shortenAddress, cn } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from './Card';
import { Badge } from './Badge';

interface WalletManagerProps {
  onSelectWallet?: (address: string) => void;
  selectedWallet?: string;
}

export function WalletManager({ onSelectWallet, selectedWallet }: WalletManagerProps) {
  const { address: connectedAddress, isConnected } = useAccount();
  const { wallets, addWallet, removeWallet, updateLabel, hasWallet } = useWalletStore();
  const [newAddress, setNewAddress] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [editingWallet, setEditingWallet] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [error, setError] = useState('');

  const handleAddWallet = () => {
    setError('');

    // Validate address
    if (!newAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
      setError('Invalid Ethereum address');
      return;
    }

    if (hasWallet(newAddress)) {
      setError('Wallet already added');
      return;
    }

    addWallet(newAddress, newLabel || undefined);
    setNewAddress('');
    setNewLabel('');
  };

  const handleStartEdit = (wallet: WatchedWallet) => {
    setEditingWallet(wallet.address);
    setEditLabel(wallet.label);
  };

  const handleSaveEdit = (address: string) => {
    if (editLabel.trim()) {
      updateLabel(address, editLabel.trim());
    }
    setEditingWallet(null);
    setEditLabel('');
  };

  // All wallets including connected one
  const allWallets: Array<WatchedWallet & { isConnected: boolean }> = [
    // Connected wallet first
    ...(isConnected && connectedAddress
      ? [
          {
            address: connectedAddress.toLowerCase(),
            label: 'Connected Wallet',
            addedAt: 0,
            isConnected: true,
          },
        ]
      : []),
    // Watched wallets
    ...wallets
      .filter((w) => w.address.toLowerCase() !== connectedAddress?.toLowerCase())
      .map((w) => ({ ...w, isConnected: false })),
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Wallets</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Wallet list */}
        <div className="space-y-2 mb-4">
          {allWallets.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] text-center py-4">
              No wallets added. Connect your wallet or add an address to watch.
            </p>
          ) : (
            allWallets.map((wallet) => {
              const isSelected =
                selectedWallet?.toLowerCase() === wallet.address.toLowerCase();
              const isEditing = editingWallet === wallet.address;

              return (
                <div
                  key={wallet.address}
                  className={cn(
                    'flex items-center justify-between p-3 rounded-lg transition-colors',
                    'border',
                    isSelected
                      ? 'border-[var(--accent)] bg-[var(--accent-dim)]'
                      : 'border-[var(--border)] hover:border-[var(--accent-hover)]',
                    onSelectWallet && 'cursor-pointer'
                  )}
                  onClick={() => onSelectWallet?.(wallet.address)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Indicator */}
                    <div
                      className={cn(
                        'w-2 h-2 rounded-full flex-shrink-0',
                        wallet.isConnected ? 'bg-[var(--green)]' : 'bg-[var(--text-faint)]'
                      )}
                    />

                    {/* Label / Edit */}
                    {isEditing ? (
                      <input
                        type="text"
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveEdit(wallet.address);
                          if (e.key === 'Escape') setEditingWallet(null);
                        }}
                        onBlur={() => handleSaveEdit(wallet.address)}
                        className={cn(
                          'px-2 py-1 text-sm rounded bg-[var(--bg-elevated)]',
                          'border border-[var(--border)] text-[var(--text)]',
                          'focus:outline-none focus:border-[var(--accent)]'
                        )}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[var(--text)] truncate">
                          {wallet.label}
                        </p>
                        <p className="text-xs text-[var(--text-faint)] font-mono">
                          {shortenAddress(wallet.address)}
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {wallet.isConnected && (
                      <Badge variant="success">Connected</Badge>
                    )}

                    {!wallet.isConnected && !isEditing && (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartEdit(wallet);
                          }}
                          className="p-1 text-[var(--text-faint)] hover:text-[var(--text)] transition-colors"
                          title="Edit label"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeWallet(wallet.address);
                          }}
                          className="p-1 text-[var(--text-faint)] hover:text-[var(--red)] transition-colors"
                          title="Remove wallet"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Add wallet form */}
        <div className="pt-4 border-t border-[var(--border)]">
          <p className="text-xs text-[var(--text-faint)] mb-2">Add wallet to watch</p>
          <div className="space-y-2">
            <input
              type="text"
              placeholder="0x..."
              value={newAddress}
              onChange={(e) => {
                setNewAddress(e.target.value);
                setError('');
              }}
              className={cn(
                'w-full px-3 py-2 text-sm rounded-[var(--radius-button)]',
                'bg-[var(--bg-elevated)] border border-[var(--border)]',
                'text-[var(--text)] placeholder:text-[var(--text-faint)]',
                'focus:outline-none focus:border-[var(--accent)]',
                error && 'border-red-400'
              )}
            />
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Label (optional)"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                className={cn(
                  'flex-1 min-w-0 px-3 py-2 text-sm rounded-[var(--radius-button)]',
                  'bg-[var(--bg-elevated)] border border-[var(--border)]',
                  'text-[var(--text)] placeholder:text-[var(--text-faint)]',
                  'focus:outline-none focus:border-[var(--accent)]'
                )}
              />
              <button
                onClick={handleAddWallet}
                className={cn(
                  'px-4 py-2 text-sm font-medium rounded-[var(--radius-button)]',
                  'bg-[var(--accent)] text-white flex-shrink-0',
                  'hover:opacity-90 transition-opacity'
                )}
              >
                Add
              </button>
            </div>
          </div>
          {error && <p className="text-xs text-[var(--red)] mt-1">{error}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
