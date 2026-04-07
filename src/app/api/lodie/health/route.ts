import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  const ollamaUrl = process.env.OLLAMA_URL;
  const hasSecret = !!process.env.OLLAMA_SECRET;

  if (!ollamaUrl) {
    return NextResponse.json({ ok: false, error: 'OLLAMA_URL not set' });
  }

  const headers: Record<string, string> = {};
  if (process.env.OLLAMA_SECRET) {
    headers['Authorization'] = `Bearer ${process.env.OLLAMA_SECRET}`;
  }

  try {
    const res = await fetch(`${ollamaUrl}/api/tags`, {
      headers,
      signal: AbortSignal.timeout(8_000),
    });
    const body = await res.text();
    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      urlPrefix: ollamaUrl.slice(0, 20) + '…',
      hasSecret,
      body: body.slice(0, 300),
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      urlPrefix: ollamaUrl.slice(0, 20) + '…',
      hasSecret,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
