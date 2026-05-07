'use client';

import type { TokenTag } from '@/lib/tokens/types';

const STYLES: Record<TokenTag, string> = {
  Stablecoin: 'bg-[var(--green)]/12 text-[var(--green)]',
  Wrapped: 'bg-[#5BC2FF]/12 text-[#5BC2FF]',
  DEX: 'bg-[var(--accent)]/12 text-[var(--accent)]',
  Lending: 'bg-[#6E92FF]/12 text-[#6E92FF]',
  LST: 'bg-[#9B7BFF]/12 text-[#B395FF]',
  Restaking: 'bg-[#7C5CFF]/12 text-[#A78BFA]',
  Governance: 'bg-[#FFA94D]/12 text-[#FFB870]',
  Oracle: 'bg-[#22D3EE]/12 text-[#22D3EE]',
  Infrastructure: 'bg-[#A855F7]/12 text-[#C084FC]',
  Identity: 'bg-[#EC4899]/12 text-[#F472B6]',
  Memecoin: 'bg-[#FACC15]/15 text-[#FACC15]',
  DeFi: 'bg-[#10B981]/12 text-[#34D399]',
  AI: 'bg-[#F472B6]/12 text-[#F0ABFC]',
  RWA: 'bg-[#FB923C]/12 text-[#FDBA74]',
  DePIN: 'bg-[#06B6D4]/12 text-[#22D3EE]',
  Gaming: 'bg-[#F87171]/12 text-[#FCA5A5]',
  Bridge: 'bg-[#94A3B8]/12 text-[#CBD5E1]',
};

export function TagBadge({ tag }: { tag: TokenTag }) {
  const styles = STYLES[tag] ?? 'bg-[var(--bg-elevated)] text-[var(--text-muted)]';
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${styles}`}>
      {tag}
    </span>
  );
}
