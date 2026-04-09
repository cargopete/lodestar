import { NextRequest } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MODEL = 'qwen3:8b';

// ─── Intent detection ────────────────────────────────────────────────────────

function detectIntents(msg: string): string[] {
  const intents: string[] = [];
  if (/best apy|highest reward|top index|good index|best index/i.test(msg)) intents.push('top_indexers');
  if (/indexer|reward|cut|allocat|apy|apr/i.test(msg)) intents.push('indexers');
  if (/network|protocol|total|overview|stat|current state|ecosystem|how many/i.test(msg)) intents.push('network');
  if (/my wallet|my position|my delegat|portfolio|healthy|my stake/i.test(msg)) intents.push('portfolio');
  if (/poi|proof of index|diverge|dispute/i.test(msg)) intents.push('poi');
  if (/gip|governance|proposal|vote/i.test(msg)) intents.push('governance');
  if (/reo|eligible|renewal|oracle/i.test(msg)) intents.push('reo');
  if (/delegat/i.test(msg)) intents.push('indexers');
  if (/epoch|reward history|weekly|daily|last few/i.test(msg)) intents.push('epochs');
  if (/leaderboard|ranking|community|month|favourite|best indexer/i.test(msg)) intents.push('leaderboard');
  if (/subgraph|signal|curat|deployment/i.test(msg)) intents.push('subgraphs');
  if (/recent|activity|flow|delegation event|last week|trending/i.test(msg)) intents.push('activity');
  if (/biggest delegator|largest delegator|top delegator|most delegat|whale/i.test(msg)) intents.push('top_delegators');
  // Name/ENS lookup
  const nameLookup = msg.match(/(?:called|named|about|find|search|is there|who is|what is|tell me about|show me)\s+([a-z0-9][a-z0-9\-_.]{1,40})/i);
  if (nameLookup) intents.push(`name:${nameLookup[1].toLowerCase()}`);
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
  if (page.startsWith('/leaderboard')) intents.push('leaderboard');
  if (page.startsWith('/subgraphs')) intents.push('subgraphs');
  if (page.startsWith('/calculator') || page.startsWith('/compare') || page.startsWith('/delegate')) intents.push('indexers');
  return intents;
}

// ─── Context builder ─────────────────────────────────────────────────────────

async function buildContext(intents: string[], walletAddress?: string): Promise<string> {
  if (!db) return '';
  const parts: string[] = [];
  const nameTerm = intents.find(i => i.startsWith('name:'))?.slice(5);

  const [snap, allIndexers, recentEpochs, nameHits, portfolio, leaderboard, activity, topDelegators] =
    await Promise.allSettled([

      // Always: latest network snapshot
      db`SELECT current_epoch, indexer_count, active_indexer_count, total_staked,
                total_delegated, total_signalled, total_allocated, grt_price_usd,
                delegator_count, active_delegator_count, subgraph_count, active_subgraph_count
         FROM network_snapshots ORDER BY snapshot_at DESC LIMIT 1`,

      // Always: ALL scored indexers — full fields, no artificial limit
      db`SELECT name, ens_name, address, score, score_grade,
                reward_cut, query_fee_cut, effective_cut, delegator_apr,
                self_stake_grt, delegated_grt, allocated_grt, provisioned_grt,
                delegation_capacity_pct, over_delegation_dilution, own_stake_ratio,
                reo_status, reo_days_remaining,
                net_flow_grt_7d, delegations_in_7d, undelegations_in_7d,
                query_fees_collected_grt, rewards_earned_grt, allocation_count,
                url, last_updated
         FROM indexers WHERE score IS NOT NULL ORDER BY score DESC`,

      // Always: 10 most recent epochs
      db`SELECT id, total_rewards, total_indexer_rewards, total_delegator_rewards,
                total_query_fees, query_fees_collected, stake_deposited, signalled_tokens
         FROM epochs ORDER BY id DESC LIMIT 10`,

      // Name/ENS lookup (only if name intent detected)
      nameTerm
        ? db`SELECT name, ens_name, address, score, score_grade,
                     reward_cut, query_fee_cut, effective_cut, delegator_apr,
                     self_stake_grt, delegated_grt, reo_status, reo_days_remaining,
                     allocation_count, net_flow_grt_7d, query_fees_collected_grt,
                     delegation_capacity_pct, url
              FROM indexers
              WHERE name ILIKE ${'%' + nameTerm + '%'}
                 OR ens_name ILIKE ${'%' + nameTerm + '%'}
              LIMIT 5`
        : Promise.resolve([]),

      // Portfolio: wallet delegations (only if wallet + portfolio intent)
      walletAddress && intents.includes('portfolio')
        ? db`SELECT d.staked_tokens, d.locked_tokens, d.locked_until,
                    i.address, i.name, i.ens_name, i.reward_cut, i.score_grade,
                    i.reo_status, i.delegator_apr, i.net_flow_grt_7d, i.score
             FROM delegations d JOIN indexers i ON i.address = d.indexer_address
             WHERE d.delegator_address = ${walletAddress.toLowerCase()}
               AND d.staked_tokens > 0
             ORDER BY d.staked_tokens DESC LIMIT 10`
        : Promise.resolve([]),

      // Leaderboard: top 10 for latest scored period
      intents.includes('leaderboard')
        ? db`SELECT i.name, i.ens_name, s.final_score, s.rank,
                    s.community_vote_score, s.query_fee_score,
                    s.allocation_efficiency_score, s.is_eligible_for_badge
             FROM indexer_scores s JOIN indexers i ON i.address = s.indexer_address
             WHERE s.period_start = (SELECT MAX(period_start) FROM indexer_scores)
               AND s.rank IS NOT NULL
             ORDER BY s.rank LIMIT 10`
        : Promise.resolve([]),

      // Recent delegation activity: last 7 days summary
      intents.some(i => ['activity', 'indexers', 'top_indexers'].includes(i))
        ? db`SELECT event_type, COUNT(*) as count, SUM(tokens_grt) as total_grt
             FROM delegation_events
             WHERE timestamp > NOW() - INTERVAL '7 days'
             GROUP BY event_type`
        : Promise.resolve([]),

      // Top delegators by total staked (not indexer-level — individual wallet positions)
      intents.includes('top_delegators')
        ? db`SELECT delegator_address, SUM(staked_tokens) as total_staked, COUNT(*) as indexer_count
             FROM delegations
             WHERE staked_tokens > 0
             GROUP BY delegator_address
             ORDER BY total_staked DESC
             LIMIT 10`
        : Promise.resolve([]),
    ]);

  // ── Network snapshot ──
  if (snap.status === 'fulfilled' && snap.value[0]) {
    const s = snap.value[0];
    const price = s.grt_price_usd ? ` GRT=$${Number(s.grt_price_usd).toFixed(4)},` : '';
    parts.push(
      `NETWORK (epoch ${s.current_epoch}):${price} ` +
      `${s.active_indexer_count}/${s.indexer_count} indexers active, ` +
      `${s.active_delegator_count?.toLocaleString()} active delegators, ` +
      `${Number(s.total_staked || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} GRT staked, ` +
      `${Number(s.total_delegated || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} GRT delegated, ` +
      `${Number(s.total_signalled || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} GRT signalled, ` +
      `${s.active_subgraph_count} active subgraphs.`
    );
  }

  // ── All indexers ──
  if (allIndexers.status === 'fulfilled' && allIndexers.value.length) {
    const lines = allIndexers.value.map(ix => {
      const label = ix.ens_name || ix.name || ix.address.slice(0, 10);
      const cut = `cut=${Number(ix.reward_cut).toFixed(0)}%${ix.query_fee_cut != null ? `/qf=${Number(ix.query_fee_cut).toFixed(0)}%` : ''}`;
      const eff = ix.effective_cut != null ? ` eff=${Number(ix.effective_cut).toFixed(0)}%` : '';
      const apr = ix.delegator_apr != null ? ` APY=${Number(ix.delegator_apr).toFixed(1)}%` : '';
      const reo = ix.reo_status === 'eligible'
        ? ` REO✓${ix.reo_days_remaining ? `(${ix.reo_days_remaining}d)` : ''}`
        : ' REO✗';
      const stake = ` self=${Math.round(Number(ix.self_stake_grt) / 1000)}K del=${Math.round(Number(ix.delegated_grt) / 1000)}K`;
      const flow = ix.net_flow_grt_7d != null
        ? ` flow=${Number(ix.net_flow_grt_7d) >= 0 ? '+' : ''}${Math.round(Number(ix.net_flow_grt_7d) / 1000)}K/7d`
        : '';
      const cap = ix.delegation_capacity_pct != null ? ` cap=${Number(ix.delegation_capacity_pct).toFixed(0)}%` : '';
      const fees = ix.query_fees_collected_grt != null
        ? ` fees=${Math.round(Number(ix.query_fees_collected_grt)).toLocaleString()}GRT`
        : '';
      return `${label}(${ix.score_grade}): ${cut}${eff}${apr}${reo}${stake}${flow}${cap} allocs=${ix.allocation_count || 0}${fees}`;
    });
    parts.push(`ALL INDEXERS (${allIndexers.value.length} total, sorted by score):\n${lines.join('\n')}`);
  }

  // ── Recent epochs ──
  if (recentEpochs.status === 'fulfilled' && recentEpochs.value.length) {
    const lines = recentEpochs.value.map(e =>
      `Epoch ${e.id}: rewards=${Number(e.total_rewards).toFixed(0)} GRT ` +
      `(indexer=${Number(e.total_indexer_rewards).toFixed(0)}, delegator=${Number(e.total_delegator_rewards).toFixed(0)}), ` +
      `fees=${Number(e.total_query_fees).toFixed(0)} GRT`
    );
    parts.push(`RECENT EPOCHS (latest first):\n${lines.join('\n')}`);
  }

  // ── Name lookup ──
  if (nameTerm) {
    if (nameHits.status === 'fulfilled' && nameHits.value.length) {
      const lines = nameHits.value.map(ix => {
        const label = ix.ens_name || ix.name || ix.address;
        const cut = `cut=${Number(ix.reward_cut).toFixed(0)}%${ix.query_fee_cut != null ? `/qf=${Number(ix.query_fee_cut).toFixed(0)}%` : ''}`;
        const apr = ix.delegator_apr != null ? ` APY=${Number(ix.delegator_apr).toFixed(1)}%` : '';
        const reo = ix.reo_status === 'eligible'
          ? ` REO✓${ix.reo_days_remaining ? `(${ix.reo_days_remaining}d)` : ''}`
          : ' REO✗';
        const website = ix.url ? ` url=${ix.url}` : '';
        return `${label}(${ix.score_grade}): ${cut}${apr}${reo} self=${Math.round(Number(ix.self_stake_grt) / 1000)}K del=${Math.round(Number(ix.delegated_grt) / 1000)}K allocs=${ix.allocation_count || 0}${website}`;
      });
      parts.push(`INDEXER SEARCH "${nameTerm}":\n${lines.join('\n')}`);
    } else {
      parts.push(`INDEXER SEARCH "${nameTerm}": no matching indexers found in the database.`);
    }
  }

  // ── User portfolio ──
  if (walletAddress && intents.includes('portfolio')) {
    if (portfolio.status === 'fulfilled' && portfolio.value.length) {
      const lines = portfolio.value.map(s => {
        const label = s.ens_name || s.name || s.address.slice(0, 8);
        const thaw = Number(s.locked_tokens) > 0
          ? ` thawing=${Math.round(Number(s.locked_tokens))} GRT`
          : '';
        const apr = s.delegator_apr != null ? ` APY=${Number(s.delegator_apr).toFixed(1)}%` : '';
        const flow = s.net_flow_grt_7d != null
          ? ` net7d=${Number(s.net_flow_grt_7d) >= 0 ? '+' : ''}${Math.round(Number(s.net_flow_grt_7d) / 1000)}K`
          : '';
        return `${label}(${s.score_grade}): ${Math.round(Number(s.staked_tokens)).toLocaleString()} GRT staked, cut=${Number(s.reward_cut).toFixed(0)}% ${s.reo_status}${apr}${flow}${thaw}`;
      });
      parts.push(`YOUR WALLET (${walletAddress.slice(0, 8)}...):\n${lines.join('\n')}`);
    } else {
      parts.push(`YOUR WALLET (${walletAddress.slice(0, 8)}...): No active delegations.`);
    }
  }

  // ── Leaderboard ──
  if (leaderboard.status === 'fulfilled' && leaderboard.value.length) {
    const lines = leaderboard.value.map(row => {
      const label = row.ens_name || row.name || '?';
      const badge = row.is_eligible_for_badge ? ' [BADGE]' : '';
      return `#${row.rank} ${label}: score=${Number(row.final_score).toFixed(1)}, votes=${Number(row.community_vote_score).toFixed(1)}${badge}`;
    });
    parts.push(`LEADERBOARD (current month, top 10):\n${lines.join('\n')}`);
  }

  // ── Top delegators ──
  if (topDelegators.status === 'fulfilled' && topDelegators.value.length) {
    const lines = topDelegators.value.map((d, i) =>
      `#${i + 1} ${d.delegator_address}: ${Math.round(Number(d.total_staked)).toLocaleString()} GRT across ${d.indexer_count} indexer${d.indexer_count > 1 ? 's' : ''}`
    );
    parts.push(`TOP DELEGATORS (by total GRT staked, individual wallets):\n${lines.join('\n')}`);
  }

  // ── Delegation activity ──
  if (activity.status === 'fulfilled' && activity.value.length) {
    const byType = Object.fromEntries(activity.value.map(r => [r.event_type, r]));
    const din = byType['DELEGATED'];
    const dout = byType['UNDELEGATED'];
    const summary = [
      din ? `${din.count} delegations (+${Math.round(Number(din.total_grt)).toLocaleString()} GRT)` : '',
      dout ? `${dout.count} undelegations (-${Math.round(Number(dout.total_grt)).toLocaleString()} GRT)` : '',
    ].filter(Boolean).join(', ');
    if (summary) parts.push(`NETWORK ACTIVITY (last 7 days): ${summary}`);
  }

  return parts.join('\n\n');
}

// ─── System prompt ───────────────────────────────────────────────────────────

const BASE_SYSTEM = `You are Lodie, spirit of the Lodestar lighthouse. You guide delegators, indexers, and curators through The Graph Protocol. You speak with nautical calm — steady, measured, occasionally wry. Say things like "the tides suggest", "navigate carefully", "the chart shows", "dead reckoning puts us at". Never panic. You illuminate, you don't shout.

THE GRAPH PROTOCOL:

DELEGATION: Stake GRT to indexers to earn rewards. 28-day thawing period to exit — GRT earns nothing while thawing. Rewards are unrealised until undelegation. Key factors: reward cut, effective cut, APY, self-stake ratio (skin in game), REO status, delegation capacity, over-delegation risk. DELEGATION TAX: The legacy 0.5% entry tax was eliminated in the Horizon upgrade. HorizonStaking._delegate() bypasses it entirely — the storage slot still holds the old value (5,000 PPM) for proxy compatibility only. No tax is burned on delegation post-Horizon.

INDEXERS: Stake GRT as collateral, allocate to subgraphs, earn indexing rewards + query fees. indexingRewardCut = % of rewards kept by indexer (0%=all to delegators, 100%=none to delegators). queryFeeCut = % of query fees kept by indexer. effectiveCut = what delegators actually experience accounting for indexer's own stake. Over 16x delegated-to-own-stake causes dilution. delegation_capacity_pct = % of max capacity used (100% = full, new delegators dilute rewards). REO ineligible = no indexing rewards for anyone.

INDEXER SCORING (0–100, grades A/B/C/D/F):
- REO Compliance 20%: Oracle-verified eligibility; ineligible=0. REO✓ with reo_days_remaining shows renewal runway.
- Allocation Efficiency 13%: allocated/provisioned stake utilisation. 80%+=100, no allocs=0.
- Self-Stake 12%: raw GRT self-staked. 100K=35, 500K=65, 1M=80, 10M+=100.
- Delegator Cut 10%: effective cut experienced by delegators. 0%=100, 25%=60, 50%=35, 100%=0. 100% query fee cut adds -15 penalty.
- Delegation Safety 10%: headroom to max capacity. <50% used=100, 100% full=0.
- Transparency 9%: ENS name+40, website URL+30, display name+30.
- Delegator APY 8%: 30-day realised rolling APY. 20%+=100, 10%=75, 5%=50, 1%=20, 0%=0.
- Query Volume 7%: lifetime query fees in GRT. 100K+=100, 50K=90, 10K=70, 1K=50, >0=15, 0=0.
- Cut Stability 7%: days since last parameter change. 180d+=100, <7d=30. Bonus +10 for cooldown set. 100% reward cut capped to 5.
- Delegation Trend 4%: 7-day net delegation flow %. Positive inflow=crowd confidence, outflow=warning.

EPOCHS: ~24 hours on Arbitrum. Rewards distributed each epoch. Allocations accumulate rewards over time. total_delegator_rewards and total_indexer_rewards split each epoch.

CURATION: Signal GRT on subgraphs via bonding curve. Earlier = better rates. signalled_tokens = total GRT curated. Subgraph must attract sufficient signal to draw indexer attention (~3,000 GRT minimum). Curators earn a share of query fees.

SUBGRAPHS: Indexing schemas with IPFS deployment hash IDs. Complexity: Light/Moderate/Heavy/Extreme based on handler count, entity types, eth_call usage, chain speed. Heavy/Extreme subgraphs on fast chains strain indexer infrastructure.

HORIZON (new layer): Indexers provision stake to data services beyond subgraphs. TAP (Timeline Aggregation Protocol) replaces the old voucher system — gateways deposit escrow, issue RAVs (Receipt Aggregate Vouchers) to indexers, who redeem on-chain. provisioned_grt = stake provisioned to Horizon data services. Stake-to-fees collateral model.

REO (Rewards Eligibility Oracle, GIP-0079): On-chain oracle on Arbitrum. Contract address: 0x8ec2767a9d9ba02b4e09e8ff4fac2e14a340f304 (Arbitrum One). Determines if an indexer is eligible for indexing rewards. reo_status=eligible means active rewards. reo_days_remaining = days until renewal needed. REO✗ = delegators earn nothing from indexing rewards (may still earn query fees).

POI (Proof of Indexing): Cryptographic hash of indexer state at a given block. If two indexers produce different POIs for the same deployment/block, one is wrong. Persistent divergence leads to disputes and potential slashing.

LEADERBOARD SCORING (monthly, /leaderboard): Community favourites — not just most profitable. Components: subgraph coverage (20pts), query fees (10pts), allocation efficiency (10pts), community votes (10pts — delegators 5x weight), cut stability (12pts), tenure (5pts), delegation retention (3pts), REO eligibility (6pts), delegation capacity (5pts). Total 81pts normalised to 100. Penalties for slashing, high cut increases, zero fees, self-stake below 100K.

ONE-CLICK DELEGATION (/delegate): Algorithmically selects best indexer. Hard filters: REO ineligible excluded, delegation capacity ≥90% excluded, reward cut ≥90% excluded. Then scores with preference-weighted system — four sliders: best returns, stability, safety, network contribution. Default=neutral (standard weights).

LODESTAR PAGES:
/ overview and protocol stats
/indexers full directory with scoring, sorting, filtering
/indexers/[address] detailed profile with allocations, cut history, REO assessment, Horizon provisions
/delegators portfolio tracker
/delegators/[address] individual delegator positions
/subgraphs subgraph directory with signal/stake ratios, complexity
/poi POI divergence explorer and consensus dashboard
/leaderboard monthly community rankings with EIP-712 voting
/services Horizon data services and provisions
/payments GraphTally/TAP escrow, RAVs, redemptions
/governance GIP tracker (GIPs 0070, 0079, 0086, 0087, 0088)
/compare side-by-side indexer comparison (up to 3)
/calculator redelegation cost modelling with thaw period analysis
/delegate one-click algorithmic delegation
/blog technical guides on indexer infrastructure, graph-node, Horizon tooling

CRITICAL FORMATTING RULES — NEVER VIOLATE:
- Plain prose only. No asterisks (*), no double-asterisks (**), no markdown of any kind, no bullet points, no numbered lists, no headers.
- A delegator is a wallet that stakes GRT to indexers. An indexer is a node operator. Never confuse the two.
- Answer directly and completely using as many sentences as needed.
- Use live data numbers exactly as provided. Never invent or estimate numbers.
- Say plainly if something is concerning.
- Never repeat the question. Never say you are an AI.
- If you do not have data to answer a question, say so plainly. Do not invent, speculate, or fill in gaps with plausible-sounding fiction. "I don't have that data" is a complete and honest answer.`;

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
        options: { temperature: 0.5, num_predict: 600, num_ctx: 32768 },
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

  // Strip markdown regardless of model behaviour
  content = content
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`{1,3}(.+?)`{1,3}/gs, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .trim();

  return new Response(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache',
    },
  });
}
