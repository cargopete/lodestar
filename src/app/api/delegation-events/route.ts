import { NextRequest, NextResponse } from 'next/server';

// Paolo Diomede's delegation events subgraph — discrete delegation/undelegation/withdrawal events
const SUBGRAPH_ID = '4LLzwGxX6iBgXzAe4Sp9pEUg6n5h3UTMviAYKPmuUWds';

export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json();

    const apiKey = process.env.GRAPH_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ data: { delegationEvents: [] } });
    }

    const url = `https://gateway-arbitrum.network.thegraph.com/api/${apiKey}/subgraphs/id/${SUBGRAPH_ID}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      throw new Error(`Delegation events subgraph error: ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Delegation events API error:', error);
    return NextResponse.json({ data: { delegationEvents: [] } });
  }
}
