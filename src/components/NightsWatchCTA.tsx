'use client';

import { useDismissible } from '@/hooks/useDismissible';

// localStorage: once dismissed, the CTA stays gone across reloads and
// future visits (same behaviour as the camp banner).
const STORAGE_KEY = 'lodestar:nights-watch-cta-dismissed';
const INVITE_URL = 'https://discord.gg/484vgDETEZ';

export function NightsWatchCTA() {
  const { dismissed, dismiss } = useDismissible(STORAGE_KEY);

  if (dismissed) return null;

  return (
    <div className="px-3 pt-3">
      <div
        className="relative rounded-[var(--radius-card)] border p-3"
        style={{
          background: 'color-mix(in srgb, var(--accent) 12%, var(--bg-surface))',
          borderColor: 'color-mix(in srgb, var(--accent) 45%, transparent)',
        }}
      >
        <button
          onClick={dismiss}
          className="absolute top-1 right-1.5 text-[var(--text-faint)] hover:text-[var(--text)] transition-colors text-base leading-none p-1"
          aria-label="Dismiss for this session"
        >
          &times;
        </button>

        <a
          href={INVITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="block group transition-transform active:scale-[0.98]"
        >
          <div className="flex items-center gap-2 pr-5">
            <span className="text-[15px] leading-none" aria-hidden="true">⚔️</span>
            <span className="text-[13px] font-semibold text-[var(--text)]">The Night&apos;s Watch</span>
          </div>
          <p className="mt-1 text-[11px] text-[var(--text-muted)] leading-snug">
            The Night&apos;s Watch is an open community of people who believe in The Graph&apos;s original vision of an open, permissionless and thriving network for all ecosystem participants.
          </p>
          <span
            className="mt-2 inline-flex items-center justify-center w-full px-3 py-1.5 text-[12px] font-medium rounded-[var(--radius-button)] transition-[filter] group-hover:brightness-110"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            Join the Watch →
          </span>
        </a>
      </div>
    </div>
  );
}
