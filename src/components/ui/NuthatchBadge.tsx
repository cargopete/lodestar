/**
 * Marks a panel whose data is served by our own nuthatch indexer instead of The Graph gateway
 * (RFC-0011 pilot). Rendered only when a panel is *actually* nuthatch-backed — i.e. the API response's
 * `source` is `"nuthatch"`, not the subgraph fallback — so it never misrepresents where data came from.
 * Links to the nuthatch project so a curious reader can see what's behind the number.
 */
export function NuthatchBadge() {
  return (
    <a
      href="https://www.nuthatch-indexer.com"
      target="_blank"
      rel="noopener noreferrer"
      title="Served by nuthatch, a self-hosted, single-binary indexer. Click to learn more."
      className="inline-flex items-center gap-1 text-[10px] text-[var(--text-faint)] hover:text-[var(--accent)] transition-colors"
    >
      <span aria-hidden>⚡</span>
      <span>Indexed by nuthatch</span>
    </a>
  );
}
