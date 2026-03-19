'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/Card';

export default function CuratorsPage() {
  const [address, setAddress] = useState('');
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = address.trim();
    if (trimmed) {
      router.push(`/curators/${trimmed}`);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <div className="w-16 h-16 rounded-full bg-[var(--accent-dim)] flex items-center justify-center mb-6">
        <svg className="w-8 h-8 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      </div>
      <Card className="w-full max-w-lg">
        <CardContent>
          <form onSubmit={handleSubmit} className="flex gap-3">
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="0x..."
              className="flex-1 px-4 py-2.5 text-sm font-mono bg-[var(--bg-elevated)] text-[var(--text)] border-[0.5px] border-[var(--border)] rounded-[var(--radius-button)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)] transition-colors"
            />
            <button
              type="submit"
              disabled={!address.trim()}
              className="px-5 py-2.5 text-sm font-medium bg-[var(--accent)] text-white rounded-[var(--radius-button)] hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              View Profile
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
