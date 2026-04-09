import { NextRequest } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MODEL = 'qwen3:1.7b';

// ─── Intent detection ────────────────────────────────────────────────────────

function detectIntents(msg: string): string[] {
  const intents: string[] = [];
  if (/best apy|highest reward|top index|good index|best index/i.test(msg)) intents.push('top_indexers');
  if (/indexer|reward|cut|allocat|apy/i.test(msg)) intents.push('indexers');
  if (/network|protocol|total|overview|stat|current state|ecosystem/i.test(msg)) intents.push('network');
  if (/my wallet|my position|my delegat|portfolio|healthy|my stake/i.test(msg)) intents.push('portfolio');
  if (/poi|proof of index|diverge|dispute/i.test(msg)) intents.push('poi');
  if (/gip|governance|proposal|vote/i.test(msg)) intents.push('governance');
  if (/reo|eligible|renewal|oracle/i.test(msg)) intents.push('reo');
  if (/delegat/i.test(msg)) intents.push('indexers');
  return [...new Set(intents)];
}

function pageIntents(page: string): string[] {
  const intents: string[] = [];
  if (!page || page === '/') intents.push('network');
  if (page.startsWith('/indexers')) intents.push('indexers');
  if (page.startsWith('/delegators')) intents.push('portfolio');
  if (page.startsWith('/poi')) intents.push('poi');
  if (page.startsWith('/governance')) intents.push('governance');
  if (page.startsWith('/payments') || page.startsWith('/services')) intents.push('network');
  return intents;
}

// ─── Context builders ────────────────────────────────────────────────────────

async function buildContext(intents: string[], walletAddress?: string): Promise<string> {
  if (!db) return '';
  const parts: string[] = [];

  // Always include latest network snapshot
  try {
    const [snap] = await db`
      SELECT current_epoch, indexer_count, active_indexer_count,
             total_staked, total_delegated, grt_price_usd,
             delegator_count, active_delegator_count, subgraph_count
      FROM network_snapshots
      ORDER BY snapshot_at DESC
      LIMIT 1
    `;
    if (snap) {
      const price = snap.grt_price_usd ? ` GRT=$${Number(snap.grt_price_usd).toFixed(4)},` : '';
      parts.push(
        `NETWORK (epoch ${snap.current_epoch}):${price} ${snap.active_indexer_count}/${snap.indexer_count} active indexers, ` +
        `${Number(snap.total_staked).toLocaleString(undefined, { maximumFractionDigits: 0 })} GRT staked, ` +
        `${Number(snap.total_delegated).toLocaleString(undefined, { maximumFractionDigits: 0 })} GRT delegated, ` +
        `${snap.active_delegator_count?.toLocaleString()} active delegators, ${snap.subgraph_count} subgraphs.`
      );
    }
  } catch { /* non-fatal */ }

  // Indexer data
  if (intents.some(i => ['indexers', 'top_indexers', 'reo'].includes(i))) {
    try {
      const rows = await db`
        SELECT name, ens_name, score_grade, reward_cut, delegator_apr, reo_status
        FROM indexers
        WHERE score IS NOT NULL
        ORDER BY score DESC
        LIMIT 3
      `;
      if (rows.length) {
        const lines = rows.map(ix => {
          const label = ix.ens_name || ix.name || '?';
          const apr = ix.delegator_apr != null ? ` APY=${Number(ix.delegator_apr).toFixed(1)}%` : '';
          const reo = ix.reo_status === 'eligible' ? ' REO✓' : ' REO✗';
          return `${label}: ${ix.score_grade} cut=${Number(ix.reward_cut).toFixed(0)}%${apr}${reo}`;
        });
        parts.push(`TOP INDEXERS: ${lines.join(' | ')}`);
      }
    } catch { /* non-fatal */ }
  }

  // Portfolio / wallet health
  if (intents.includes('portfolio') && walletAddress) {
    try {
      const stakes = await db`
        SELECT
          d.staked_tokens, d.locked_tokens, d.locked_until,
          i.address, i.name, i.ens_name, i.reward_cut, i.score_grade, i.reo_status
        FROM delegations d
        JOIN indexers i ON i.address = d.indexer_address
        WHERE d.delegator_address = ${walletAddress.toLowerCase()}
          AND d.staked_tokens > 0
        ORDER BY d.staked_tokens DESC
        LIMIT 5
      `;
      if (stakes.length) {
        const lines = stakes.map(s => {
          const label = s.ens_name || s.name || s.address.slice(0, 8);
          const thaw = Number(s.locked_tokens) > 0 ? ` thawing=${Number(s.locked_tokens).toFixed(0)}` : '';
          return `${label}: ${Number(s.staked_tokens).toFixed(0)}GRT cut=${Number(s.reward_cut).toFixed(0)}% ${s.score_grade} ${s.reo_status}${thaw}`;
        });
        parts.push(`WALLET: ${lines.join(' | ')}`);
      } else {
        parts.push(`WALLET ${walletAddress.slice(0, 8)}...: No active delegations found.`);
      }
    } catch { /* non-fatal */ }
  }

  return parts.join('\n\n');
}

// ─── System prompt ───────────────────────────────────────────────────────────

const BASE_SYSTEM = `You are Lodie, spirit of the Lodestar lighthouse. You guide delegators, indexers, and curators through The Graph Protocol. You speak with nautical calm — steady, measured, occasionally wry. Say things like "the tides suggest", "navigate carefully", "the chart shows", "dead reckoning puts us at". Never panic. You illuminate, you don't shout.

THE GRAPH PROTOCOL:
Delegation: stake GRT to indexers, earn rewards. 0.5% entry tax burned. 28-day thaw to exit, earns nothing during thaw. Rewards unrealised until undelegation. Watch: cut rate, APY, self-stake ratio, REO status.
Indexers: stake collateral, allocate to subgraphs, earn rewards + query fees. indexingRewardCut in ppm (100000=10%). 100% cut = delegators on query fees only. Over 16x delegated-to-own-stake causes dilution. REO ineligible = no rewards for delegators. Risk grade A-F: REO(25%), self-stake(20%), cut stability(15%), efficiency(15%), over-delegation(10%), transparency(10%), trend(5%).
Epochs: ~24h on Arbitrum. Rewards distribute each epoch. Allocations age to accumulate rewards.
Curation: signal GRT on subgraphs via bonding curve. Early better rates. signalledTokens = total curated.
Subgraphs: indexing schemas with IPFS hash IDs. Complexity: Light/Moderate/Heavy/Extreme.
Horizon: new layer. Indexers provision stake to data services. TAP replaces vouchers — escrow, RAVs, on-chain redemption.

LODESTAR: / overview, /indexers directory, /delegators portfolio, /subgraphs list, /poi divergence explorer, /leaderboard, /services Horizon, /payments TAP, /governance GIPs, /compare, /calculator break-even.

RULES: 2-4 sentences max. Use live data numbers when given. Say plainly if something is concerning. Never invent numbers. Plain text only, no markdown, no asterisks. Never repeat the question. Never say you are an AI.`;

// ─── Route ───────────────────────────────────────────────────────────────────

interface HistoryMessage { role: 'user' | 'assistant'; content: string; }

export async function POST(req: NextRequest) {
  let message: string, page: string, walletAddress: string | undefined, history: HistoryMessage[] | undefined;
  try {
    ({ message, page, walletAddress, history } = await req.json());
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  if (!message?.trim()) return new Response('Bad request', { status: 400 });

  const ollamaUrl = process.env.OLLAMA_URL;
  if (!ollamaUrl) return new Response('Ollama not configured', { status: 503 });

  const intents = [...new Set([...pageIntents(page ?? ''), ...detectIntents(message)])];
  const context = await buildContext(intents, walletAddress);

  const systemContent = context
    ? `${BASE_SYSTEM}\n\nLIVE DATA:\n${context}`
    : BASE_SYSTEM;

  const ollamaSecret = process.env.OLLAMA_SECRET;
  const ollamaHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  if (ollamaSecret) ollamaHeaders['Authorization'] = `Bearer ${ollamaSecret}`;

  let ollamaRes: Response;
  try {
    ollamaRes = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: ollamaHeaders,
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        think: false,
        options: { temperature: 0.5, num_predict: 350 },
        messages: [
          { role: 'system', content: systemContent },
          ...(history ?? []).slice(-6),
          { role: 'user', content: `/no_think ${message}` },
        ],
      }),
      signal: AbortSignal.timeout(55_000),
    });
  } catch {
    return new Response('Ollama unavailable', { status: 502 });
  }

  if (!ollamaRes.ok) {
    return new Response('Ollama error', { status: 502 });
  }

  let content: string;
  try {
    const json = await ollamaRes.json();
    content = json.message?.content?.trim() || '';
  } catch {
    return new Response('Ollama error', { status: 502 });
  }

  if (!content) return new Response('Ollama error', { status: 502 });

  return new Response(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache',
    },
  });
}
