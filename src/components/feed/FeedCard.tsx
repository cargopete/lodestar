'use client';

import { FEED_TYPE_CONFIG, timeAgo, type FeedItem } from '@/lib/feed';
import { cn } from '@/lib/utils';

interface FeedCardProps {
  item: FeedItem;
}

export function FeedCard({ item }: FeedCardProps) {
  const config = FEED_TYPE_CONFIG[item.type];
  const isEpoch = item.type === 'epoch';
  const rewardsDelta = parseFloat(item.metadata.rewardsDelta ?? '0');

  // For epochs, border color depends on rewards direction
  const borderColor = isEpoch
    ? rewardsDelta >= 0
      ? 'var(--green)'
      : 'var(--red)'
    : config.borderColor;

  const Wrapper = item.url ? 'a' : 'div';
  const wrapperProps = item.url
    ? { href: item.url, target: '_blank' as const, rel: 'noopener noreferrer' }
    : {};

  return (
    <Wrapper
      {...wrapperProps}
      className={cn(
        'block p-3 rounded-lg border-l-[3px] transition-colors',
        'bg-[var(--bg-elevated)] hover:bg-[color-mix(in_srgb,var(--bg-elevated)_90%,var(--accent)_10%)]',
        item.url && 'cursor-pointer'
      )}
      style={{ borderLeftColor: borderColor }}
    >
      {/* Type badge + timestamp */}
      <div className="flex items-center justify-between mb-1.5">
        <span
          className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded"
          style={{
            color: borderColor,
            backgroundColor: config.bgColor,
          }}
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
        {item.metadata.views != null && item.metadata.views > 0 && (
          <span>{item.metadata.views.toLocaleString()} views</span>
        )}
        {item.metadata.replies != null && item.metadata.replies > 0 && (
          <span>{item.metadata.replies} replies</span>
        )}
        {item.metadata.author && (
          <span>by {item.metadata.author}</span>
        )}
        {item.metadata.epochNumber != null && (
          <span className="font-mono">#{item.metadata.epochNumber}</span>
        )}
        {item.tags.length > 0 && (
          <span className="truncate">
            {item.tags.slice(0, 2).join(', ')}
          </span>
        )}
      </div>
    </Wrapper>
  );
}
