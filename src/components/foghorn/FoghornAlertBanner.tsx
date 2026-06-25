const DISCORD_INVITE = 'https://discord.gg/jbbqN4bQhC';

/** Slim promo strip linking to the Discord #foghorn-alerts channel. */
export function FoghornAlertBanner() {
  return (
    <a
      href={DISCORD_INVITE}
      target="_blank"
      rel="noopener noreferrer"
      className="block group"
    >
      <div className="flex items-center gap-3 rounded-[var(--radius-card)] border border-[var(--accent)]/40 bg-[var(--accent-dim)] px-4 py-2.5 transition-colors group-hover:border-[var(--accent)]">
        <span className="text-base shrink-0">📯</span>
        <p className="text-sm text-[var(--text)] flex-1 min-w-0">
          <span className="font-medium">Get Foghorn alerts in Discord.</span>{' '}
          <span className="text-[var(--text-muted)]">
            Serving failures, indexer outages and sybil swarms pushed to{' '}
            <span className="font-mono text-[var(--accent)]">#foghorn-alerts</span> the moment they&apos;re detected.
          </span>
        </p>
        <span className="text-[11px] font-medium text-[var(--accent)] whitespace-nowrap">Join →</span>
      </div>
    </a>
  );
}
