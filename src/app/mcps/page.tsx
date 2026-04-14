import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';

export const metadata: Metadata = {
  title: 'MCP Directory | Lodestar',
  description:
    'Model Context Protocol (MCP) servers powered by The Graph — discoverable by AI agents and developers building on decentralised data.',
};

interface MCPEntry {
  name: string;
  description: string;
  category: 'DeFi Lending' | 'DEX / Trading' | 'NFT' | 'Infrastructure' | 'Analytics';
  author: string;
  repoUrl?: string;
  npmPackage?: string;
  status: 'active' | 'beta' | 'coming-soon';
  subgraphsUsed: string[];
  tags: string[];
}

const MCPS: MCPEntry[] = [
  {
    name: 'Graph Protocol MCP',
    description:
      'Query any subgraph on The Graph Network via natural language. Enables AI agents to access live on-chain data across 40+ blockchains without writing GraphQL.',
    category: 'Infrastructure',
    author: 'The Graph Foundation',
    repoUrl: 'https://github.com/graphprotocol/mcp-server',
    status: 'active',
    subgraphsUsed: ['Any subgraph on The Graph Network'],
    tags: ['official', 'universal', 'multi-chain'],
  },
  {
    name: 'Aave / Lending Markets MCP',
    description:
      'Real-time lending protocol data — borrow rates, health factors, liquidations, and reserve stats for Aave and other lending markets. Built by PaulieB.',
    category: 'DeFi Lending',
    author: 'PaulieB',
    status: 'active',
    subgraphsUsed: ['Aave V3', 'Aave V2', 'Compound V3'],
    tags: ['lending', 'defi', 'rates', 'liquidations'],
  },
  {
    name: 'Uniswap DEX MCP',
    description:
      'Live pool liquidity, swap volume, price impact, and fee APR for Uniswap V3 and V4. Ideal for agents executing or analysing on-chain trades.',
    category: 'DEX / Trading',
    author: 'Community',
    status: 'coming-soon',
    subgraphsUsed: ['Uniswap V3', 'Uniswap V4'],
    tags: ['dex', 'uniswap', 'liquidity', 'swaps'],
  },
];

const STATUS_CONFIG: Record<MCPEntry['status'], { label: string; variant: 'success' | 'default' | 'warning' }> = {
  active: { label: 'Active', variant: 'success' },
  beta: { label: 'Beta', variant: 'warning' },
  'coming-soon': { label: 'Coming Soon', variant: 'default' },
};

const CATEGORY_COLORS: Record<MCPEntry['category'], string> = {
  'DeFi Lending': 'text-[var(--green)]',
  'DEX / Trading': 'text-[var(--accent)]',
  'NFT': 'text-[var(--amber)]',
  'Infrastructure': 'text-[var(--text-muted)]',
  'Analytics': 'text-[var(--accent)]',
};

export default function MCPDirectoryPage() {
  const active = MCPS.filter((m) => m.status === 'active');
  const beta = MCPS.filter((m) => m.status === 'beta');
  const comingSoon = MCPS.filter((m) => m.status === 'coming-soon');

  return (
    <div className="max-w-4xl space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-[var(--text)] mb-2">MCP Directory</h1>
        <p className="text-sm text-[var(--text-muted)] leading-relaxed max-w-2xl">
          Model Context Protocol servers powered by The Graph Network. These MCPs let AI agents
          and developers query live on-chain data without writing GraphQL — making decentralised
          data easily discoverable and accessible.
        </p>
      </div>

      {/* What is an MCP? */}
      <div className="px-4 py-3 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-[var(--radius-card)] text-sm text-[var(--text-muted)] leading-relaxed">
        <strong className="text-[var(--text)]">What is an MCP?</strong>{' '}
        The Model Context Protocol is an open standard that lets AI assistants (Claude, Cursor, etc.)
        connect to live data sources. A Graph-powered MCP exposes subgraph data to any MCP-compatible
        agent — no API key, no schema knowledge required.
      </div>

      {/* Active MCPs */}
      {active.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-[var(--text-faint)] uppercase tracking-[0.06em] mb-3">
            Live
          </h2>
          <div className="space-y-3">
            {active.map((mcp) => (
              <MCPCard key={mcp.name} mcp={mcp} />
            ))}
          </div>
        </section>
      )}

      {/* Beta */}
      {beta.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-[var(--text-faint)] uppercase tracking-[0.06em] mb-3">
            Beta
          </h2>
          <div className="space-y-3">
            {beta.map((mcp) => (
              <MCPCard key={mcp.name} mcp={mcp} />
            ))}
          </div>
        </section>
      )}

      {/* Coming Soon */}
      {comingSoon.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-[var(--text-faint)] uppercase tracking-[0.06em] mb-3">
            In the Pipeline
          </h2>
          <div className="space-y-3">
            {comingSoon.map((mcp) => (
              <MCPCard key={mcp.name} mcp={mcp} />
            ))}
          </div>
        </section>
      )}

      {/* Submit CTA */}
      <div className="px-4 py-4 border border-dashed border-[var(--border-mid)] rounded-[var(--radius-card)] text-center space-y-1">
        <p className="text-sm text-[var(--text-muted)]">Built an MCP that uses The Graph?</p>
        <p className="text-xs text-[var(--text-faint)]">
          Open a PR or drop a link in{' '}
          <span className="text-[var(--accent)]">#lodestar</span> on The Graph Discord to get it listed.
        </p>
      </div>
    </div>
  );
}

function MCPCard({ mcp }: { mcp: MCPEntry }) {
  const status = STATUS_CONFIG[mcp.status];
  const categoryColor = CATEGORY_COLORS[mcp.category];
  const isComingSoon = mcp.status === 'coming-soon';

  return (
    <div className={`px-4 py-4 bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius-card)] transition-colors ${isComingSoon ? 'opacity-60' : 'hover:border-[var(--border-mid)]'}`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[15px] font-semibold text-[var(--text)]">{mcp.name}</span>
          <Badge variant={status.variant}>{status.label}</Badge>
          <span className={`text-xs font-medium ${categoryColor}`}>{mcp.category}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {mcp.repoUrl && (
            <Link
              href={mcp.repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[var(--text-faint)] hover:text-[var(--accent)] transition-colors"
            >
              GitHub ↗
            </Link>
          )}
          {mcp.npmPackage && (
            <Link
              href={`https://npmjs.com/package/${mcp.npmPackage}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[var(--text-faint)] hover:text-[var(--accent)] transition-colors"
            >
              npm ↗
            </Link>
          )}
        </div>
      </div>

      <p className="text-sm text-[var(--text-muted)] mb-3 leading-relaxed">{mcp.description}</p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[var(--text-faint)]">
        <span>By <span className="text-[var(--text-muted)]">{mcp.author}</span></span>
        <span>Subgraphs: <span className="text-[var(--text-muted)]">{mcp.subgraphsUsed.join(', ')}</span></span>
      </div>

      {mcp.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {mcp.tags.map((tag) => (
            <span
              key={tag}
              className="px-1.5 py-0.5 text-[10px] rounded bg-[var(--bg-elevated)] text-[var(--text-faint)] border border-[var(--border)]"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
