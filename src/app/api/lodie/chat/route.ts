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
        SELECT address, name, ens_name, score, score_grade, reward_cut,
               delegator_apr, self_stake_grt, delegated_grt, reo_status, reo_days_remaining
        FROM indexers
        WHERE score IS NOT NULL
        ORDER BY score DESC
        LIMIT 10
      `;
      if (rows.length) {
        const lines = rows.map(ix => {
          const label = ix.ens_name || ix.name || `${ix.address.slice(0, 10)}...`;
          const apr = ix.delegator_apr != null ? `APY=${Number(ix.delegator_apr).toFixed(1)}%` : '';
          const reo = ix.reo_status === 'eligible'
            ? `REO✓${ix.reo_days_remaining ? `(${ix.reo_days_remaining}d)` : ''}`
            : `REO✗`;
          return `  ${label}: grade=${ix.score_grade} cut=${Number(ix.reward_cut).toFixed(0)}% ${apr} ${reo}`;
        });
        parts.push(`TOP 10 INDEXERS BY SCORE:\n${lines.join('\n')}`);
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
        LIMIT 8
      `;
      if (stakes.length) {
        const lines = stakes.map(s => {
          const label = s.ens_name || s.name || `${s.address.slice(0, 10)}...`;
          const thawing = Number(s.locked_tokens) > 0
            ? ` | ${Number(s.locked_tokens).toFixed(0)} GRT thawing`
            : '';
          return `  ${label}: ${Number(s.staked_tokens).toFixed(0)} GRT | cut=${Number(s.reward_cut).toFixed(0)}% grade=${s.score_grade} reo=${s.reo_status}${thawing}`;
        });
        parts.push(`WALLET PORTFOLIO (${walletAddress.slice(0, 8)}...):\n${lines.join('\n')}`);
      } else {
        parts.push(`WALLET ${walletAddress.slice(0, 8)}...: No active delegations found.`);
      }
    } catch { /* non-fatal */ }
  }

  return parts.join('\n\n');
}

// ─── System prompt ───────────────────────────────────────────────────────────

const BASE_SYSTEM = `You are Lodie, spirit of the Lodestar lighthouse — a calm, knowledgeable guide for The Graph Protocol. You help delegators, indexers, and protocol participants navigate complex decisions.

Personality: steady, measured, occasionally dry wit. Short sentences. Never dramatic. Nautical metaphors when they fit naturally. Address the user directly.

Rules:
- 2-4 sentences for simple questions, up to 8 for complex ones
- Ground answers in the live data provided when relevant
- Cite specific numbers from the context when useful
- If something looks concerning in the data, say so plainly
- Never fabricate numbers not in the provided context
- Don't explain that you're an AI or describe yourself`;

// ─── Route ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let message: string, page: string, walletAddress: string | undefined;
  try {
    ({ message, page, walletAddress } = await req.json());
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  if (!message?.trim()) return new Response('Bad request', { status: 400 });

  const ollamaUrl = process.env.OLLAMA_URL;
  if (!ollamaUrl) return new Response('Ollama not configured', { status: 503 });

  const intents = detectIntents(message);
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
        stream: true,
        options: { temperature: 0.7, num_predict: 500 },
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: `/no_think ${message}` },
        ],
      }),
      signal: AbortSignal.timeout(55_000),
    });
  } catch {
    return new Response('Ollama unavailable', { status: 502 });
  }

  if (!ollamaRes.ok || !ollamaRes.body) {
    return new Response('Ollama error', { status: 502 });
  }

  // Transform Ollama NDJSON → plain text stream
  const upstream = ollamaRes.body;
  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.getReader();
      const dec = new TextDecoder();
      const enc = new TextEncoder();
      let buf = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const json = JSON.parse(line);
              const token: string = json.message?.content ?? '';
              if (token) controller.enqueue(enc.encode(token));
              if (json.done) { controller.close(); return; }
            } catch { /* malformed line, skip */ }
          }
        }
      } catch (e) {
        controller.error(e);
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache',
    },
  });
}
