export type FeedItemType = 'governance' | 'gip' | 'epoch' | 'announcement';

export interface FeedItem {
  id: string;
  type: FeedItemType;
  title: string;
  summary: string;
  url: string;
  timestamp: string; // ISO 8601
  tags: string[];
  metadata: {
    views?: number;
    replies?: number;
    gipStage?: string;
    epochNumber?: number;
    rewardsDelta?: string;
    queryFeeDelta?: string;
    totalDistributed?: string;
    author?: string;
  };
}

export const FEED_TYPE_CONFIG: Record<
  FeedItemType,
  { label: string; borderColor: string; bgColor: string }
> = {
  governance: {
    label: 'Governance',
    borderColor: 'var(--amber)',
    bgColor: 'var(--amber-dim)',
  },
  gip: {
    label: 'GIP',
    borderColor: 'var(--accent)',
    bgColor: 'var(--accent-dim)',
  },
  epoch: {
    label: 'Epoch',
    borderColor: 'var(--green)',
    bgColor: 'var(--green-dim)',
  },
  announcement: {
    label: 'Announcement',
    borderColor: 'var(--star-base)',
    bgColor: 'rgba(123, 117, 232, 0.12)',
  },
};

/** Human-readable relative time */
export function timeAgo(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const seconds = Math.floor((now - then) / 1000);

  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
