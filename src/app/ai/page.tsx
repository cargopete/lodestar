import { Badge } from '@/components/ui/Badge';

interface McpEntry {
  name: string;
  author: string;
  category: 'official' | 'community';
  description: string;
  capabilities: string[];
  clients: string[];
  repoUrl: string;
  docsUrl?: string;
  installHint?: string;
}

const MCPS: McpEntry[] = [
  {
    name: 'Subgraph MCP',
    author: 'GraphOps',
    category: 'official',
    description: 'Query 15,000+ blockchain subgraphs through natural language — no GraphQL required. The flagship MCP for The Graph, with a hosted SSE endpoint ready to connect.',
    capabilities: ['Schema retrieval', 'GraphQL query execution', 'Contract lookup by address', 'Subgraph search', '30-day query volume analytics'],
    clients: ['Claude', 'Claude Code', 'Cursor', 'Cline'],
    repoUrl: 'https://github.com/graphops/subgraph-mcp',
    docsUrl: 'https://thegraph.com/docs/en/ai-suite/subgraph-mcp/introduction/',
    installHint: 'https://subgraphs.mcp.thegraph.com/sse',
  },
  {
    name: 'Token API MCP',
    author: 'The Graph / Pinax',
    category: 'official',
    description: 'On-chain token data across 9 networks via natural language. ERC-20 & NFT metadata, wallet balances, transfer history, and top holder analysis — no custom subgraph needed.',
    capabilities: ['Token metadata (name, symbol, supply)', 'Wallet balance queries', 'Transfer tracking', 'Top holder analysis', 'Historical data'],
    clients: ['Claude', 'Cursor', 'Cline'],
    repoUrl: 'https://github.com/pinax-network/mcp-token-api',
    docsUrl: 'https://thegraph.com/docs/en/ai-suite/token-api-mcp/introduction/',
    installHint: 'Requires JWT from thegraph.market',
  },
  {
    name: 'graph-polymarket-mcp',
    author: 'PaulieB14',
    category: 'community',
    description: 'Specialized MCP exposing 31 tools for Polymarket prediction market data via The Graph subgraphs. Covers live pricing, order books, trader P&L, and position tracking.',
    capabilities: ['Trader P&L analysis', 'Leaderboard generation', 'Open interest tracking', 'Live CLOB pricing', 'Order book data', 'Historical price charts'],
    clients: ['Claude', 'Cursor', 'Windsurf', 'VS Code'],
    repoUrl: 'https://github.com/PaulieB14/graph-polymarket-mcp',
    installHint: 'npm install -g graph-polymarket-mcp',
  },
  {
    name: 'subgraph-mcp-skills',
    author: 'PaulieB14',
    category: 'community',
    description: 'A set of AI agent skills and setup guides that make it easy to connect any AI client to The Graph\'s subgraphs. More workflow tooling than raw MCP server.',
    capabilities: ['Conversational subgraph search', 'Multi-client setup guides', 'Schema exploration workflows'],
    clients: ['Claude', 'Claude Code', 'Cursor', 'Cline'],
    repoUrl: 'https://github.com/PaulieB14/subgraph-mcp-skills',
  },
  {
    name: 'thegraph-mcp',
    author: 'kukapay',
    category: 'community',
    description: 'Python-based MCP server for querying blockchain data indexed by The Graph. Schema retrieval, GraphQL execution, and natural language prompts for data analysis.',
    capabilities: ['Schema retrieval', 'GraphQL query execution', 'Natural language data analysis'],
    clients: ['Any MCP-compatible client'],
    repoUrl: 'https://github.com/kukapay/thegraph-mcp',
    installHint: 'Python 3.10+ · pip install',
  },
  {
    name: 'graph-advocate',
    author: 'PaulieB14',
    category: 'community',
    description: 'Experimental multi-agent routing agent that intelligently routes data requests across The Graph\'s AI suite — Token API, Subgraph Registry, and Substreams — based on query intent.',
    capabilities: ['Multi-agent request routing', 'Token API integration', 'Subgraph Registry lookup', 'Substreams routing'],
    clients: ['Claude', 'Any MCP-compatible client'],
    repoUrl: 'https://github.com/PaulieB14/graph-advocate',
  },
];

export default function McpsPage() {
  const official = MCPS.filter((m) => m.category === 'official');
  const community = MCPS.filter((m) => m.category === 'community');

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-[var(--text)] tracking-tight">MCP Directory</h1>
        <p className="text-[var(--text-muted)] mt-2">
          Model Context Protocol servers that connect AI agents to The Graph&apos;s blockchain data.
        </p>
      </div>

      <Section title="Official" entries={official} />
      <Section title="Community" entries={community} />
    </div>
  );
}

function Section({ title, entries }: { title: string; entries: McpEntry[] }) {
  return (
    <div className="mb-10">
      <h2 className="text-[11px] font-medium text-[var(--text-faint)] uppercase tracking-[0.08em] mb-4">{title}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {entries.map((mcp) => (
          <McpCard key={mcp.name} mcp={mcp} />
        ))}
      </div>
    </div>
  );
}

function McpCard({ mcp }: { mcp: McpEntry }) {
  return (
    <div className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] overflow-hidden">
      <div className="h-1 bg-gradient-to-r from-[var(--accent)] to-[var(--green)]" />
      <div className="p-5 flex flex-col gap-3 flex-1">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-[15px] font-semibold text-[var(--text)]">{mcp.name}</h3>
            <p className="text-[12px] text-[var(--text-faint)] mt-0.5">{mcp.author}</p>
          </div>
          <Badge variant={mcp.category === 'official' ? 'accent' : 'default'}>
            {mcp.category === 'official' ? 'Official' : 'Community'}
          </Badge>
        </div>

        {/* Description */}
        <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">{mcp.description}</p>

        {/* Capabilities */}
        <div className="flex flex-wrap gap-1.5">
          {mcp.capabilities.map((cap) => (
            <span
              key={cap}
              className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--bg-elevated)] text-[var(--text-muted)] border border-[var(--border)]"
            >
              {cap}
            </span>
          ))}
        </div>

        {/* Clients */}
        <div>
          <p className="text-[11px] text-[var(--text-faint)] mb-1.5">Works with</p>
          <div className="flex flex-wrap gap-1.5">
            {mcp.clients.map((client) => (
              <span
                key={client}
                className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--accent-dim)] text-[var(--accent)] font-medium"
              >
                {client}
              </span>
            ))}
          </div>
        </div>

        {/* Install hint */}
        {mcp.installHint && (
          <p className="text-[11px] font-mono text-[var(--text-faint)] bg-[var(--bg-elevated)] px-3 py-1.5 rounded-lg truncate">
            {mcp.installHint}
          </p>
        )}

        {/* Links */}
        <div className="flex items-center gap-3 mt-auto pt-1">
          <a
            href={mcp.repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[12px] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            GitHub
          </a>
          {mcp.docsUrl && (
            <a
              href={mcp.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[12px] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
              </svg>
              Docs
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
