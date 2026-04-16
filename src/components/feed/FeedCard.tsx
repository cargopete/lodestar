'use client';

import { useState } from 'react';
import { FEED_TYPE_CONFIG, timeAgo, type FeedItem } from '@/lib/feed';
import { cn } from '@/lib/utils';

interface FeedCardProps {
  item: FeedItem;
}

export function FeedCard({ item }: FeedCardProps) {
  const [expanded, setExpanded] = useState(false);
  const config = FEED_TYPE_CONFIG[item.type];
  const isEpoch = item.type === 'epoch';
  const rewardsDelta = parseFloat(item.metadata.rewardsDelta ?? '0');

  const borderColor = isEpoch
    ? rewardsDelta >= 0
      ? 'var(--green)'
      : 'var(--red)'
    : config.borderColor;

  return (
    <>
      <div
        onClick={() => setExpanded(true)}
        className={cn(
          'block p-3 rounded-lg border-l-[3px] transition-colors cursor-pointer',
          'bg-[var(--bg-elevated)] hover:bg-[color-mix(in_srgb,var(--bg-elevated)_90%,var(--accent)_10%)]',
        )}
        style={{ borderLeftColor: borderColor }}
      >
        {/* Type badge + timestamp */}
        <div className="flex items-center justify-between mb-1.5">
          <span
            className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded"
            style={{ color: borderColor, backgroundColor: config.bgColor }}
          >
            {config.label}
          </span>
          <span className="text-[10px] text-[var(--text-faint)]">
            {timeAgo(item.timestamp)}
          </span>
        </div>

        {/* Title */}
        <p className="text-[13px] font-medium text-[var(--text)] leading-snug mb-1 line-clamp-2">
          {item.title}
        </p>

        {/* Summary */}
        {item.summary && (
          <p className="text-[11px] text-[var(--text-muted)] leading-relaxed line-clamp-2 mb-2">
            {item.summary}
          </p>
        )}

        {/* Footer metadata */}
        <div className="flex items-center gap-3 text-[10px] text-[var(--text-faint)]">
          {item.type === 'vote' ? (
            <>
              {item.metadata.snapshotState && (
                <span
                  className="font-medium"
                  style={{ color: item.metadata.snapshotState === 'active' ? 'var(--green)' : 'var(--text-faint)' }}
                >
                  {item.metadata.snapshotState}
                </span>
              )}
              {item.metadata.snapshotVotes != null && item.metadata.snapshotVotes > 0 && (
                <span>{item.metadata.snapshotVotes.toLocaleString()} votes</span>
              )}
              {item.metadata.winningChoice && item.metadata.snapshotState === 'closed' && (
                <span className="truncate">→ {item.metadata.winningChoice}</span>
              )}
              {item.metadata.snapshotEnd && item.metadata.snapshotState === 'active' && (
                <span>ends {timeAgo(item.metadata.snapshotEnd)}</span>
              )}
            </>
          ) : (
            <>
              {item.metadata.views != null && item.metadata.views > 0 && (
                <span>{item.metadata.views.toLocaleString()} views</span>
              )}
              {item.metadata.replies != null && item.metadata.replies > 0 && (
                <span>{item.metadata.replies} replies</span>
              )}
              {item.metadata.author && (
                <span>by {item.metadata.author}</span>
              )}
              {item.metadata.repo && (
                <span className="font-mono">{item.metadata.repo}</span>
              )}
              {item.metadata.releaseTag && (
                <span className="font-mono">{item.metadata.releaseTag}</span>
              )}
              {item.metadata.epochNumber != null && (
                <span className="font-mono">#{item.metadata.epochNumber}</span>
              )}
              {item.tags.length > 0 && (
                <span className="truncate">
                  {item.tags.slice(0, 2).join(', ')}
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Expanded modal ── */}
      {expanded && (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setExpanded(false)}
        >
          <div
            className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[var(--border)] flex-shrink-0">
              <div className="flex items-center gap-2">
                <span
                  className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded"
                  style={{ color: borderColor, backgroundColor: config.bgColor }}
                >
                  {config.label}
                </span>
                <span className="text-[11px] text-[var(--text-faint)]">
                  {timeAgo(item.timestamp)}
                </span>
              </div>
              <button
                onClick={() => setExpanded(false)}
                className="p-1 rounded hover:bg-[var(--bg-elevated)] transition-colors text-[var(--text-faint)] hover:text-[var(--text)]"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              <h3 className="text-[15px] font-semibold text-[var(--text)] leading-snug">
                {item.title}
              </h3>

              {(item.body || item.summary) && (
                <p className="text-[13px] text-[var(--text-muted)] leading-relaxed whitespace-pre-line">
                  {item.body || item.summary}
                </p>
              )}

              {/* Metadata row */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--text-faint)] pt-1">
                {item.metadata.author && <span>by {item.metadata.author}</span>}
                {item.metadata.repo && <span className="font-mono">{item.metadata.repo}</span>}
                {item.metadata.releaseTag && <span className="font-mono">{item.metadata.releaseTag}</span>}
                {item.metadata.epochNumber != null && <span className="font-mono">Epoch #{item.metadata.epochNumber}</span>}
                {item.metadata.snapshotState && (
                  <span style={{ color: item.metadata.snapshotState === 'active' ? 'var(--green)' : 'var(--text-faint)' }}>
                    {item.metadata.snapshotState}
                  </span>
                )}
                {item.metadata.snapshotVotes != null && item.metadata.snapshotVotes > 0 && (
                  <span>{item.metadata.snapshotVotes.toLocaleString()} votes</span>
                )}
                {item.metadata.winningChoice && item.metadata.snapshotState === 'closed' && (
                  <span>→ {item.metadata.winningChoice}</span>
                )}
              </div>

              {/* Tags */}
              {item.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {item.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--bg-elevated)] text-[var(--text-muted)]"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Modal footer — link if available */}
            {item.url && (
              <div className="px-5 py-3 border-t border-[var(--border)] flex-shrink-0">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--accent)] hover:underline"
                >
                  Open source
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
