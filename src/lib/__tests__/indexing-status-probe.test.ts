import { describe, it, expect } from 'vitest';
import { classifyServeResponse, withServeProbe, type IndexerStatusResult } from '../indexing-status';

const JSON_CT = 'application/json';

describe('classifyServeResponse', () => {
  it('treats 402 Payment Required as alive (serving stack up, needs a receipt)', () => {
    expect(classifyServeResponse(402, JSON_CT, '')).toBe('alive_paid');
    expect(classifyServeResponse(402, 'text/plain', 'Payment Required')).toBe('alive_paid');
  });

  it('treats a 200 with JSON (data or GraphQL errors) as alive', () => {
    expect(classifyServeResponse(200, JSON_CT, '{"data":{"_meta":{"block":{"number":1}}}}')).toBe('alive_paid');
    expect(classifyServeResponse(200, JSON_CT, '{"errors":[{"message":"bad query"}]}')).toBe('alive_paid');
  });

  it('treats a 200 that returns HTML or non-JSON as broken (proxy / landing page)', () => {
    expect(classifyServeResponse(200, 'text/html', '<!doctype html><html>...')).toBe('broken');
    expect(classifyServeResponse(200, JSON_CT, 'OK')).toBe('broken');
    expect(classifyServeResponse(200, JSON_CT, '   <html>')).toBe('broken');
  });

  it('reads a missing-receipt 4xx as alive across phrasings', () => {
    expect(classifyServeResponse(400, JSON_CT, '{"error":"No valid receipt provided"}')).toBe('alive_paid');
    expect(classifyServeResponse(401, 'text/plain', 'payment is required')).toBe('alive_paid');
    expect(classifyServeResponse(400, JSON_CT, '{"message":"TAP receipt missing"}')).toBe('alive_paid');
    expect(classifyServeResponse(400, JSON_CT, '{"message":"free queries exhausted"}')).toBe('alive_paid');
  });

  it('reads the iExec case — a bare 400 with no payment indicator — as broken', () => {
    expect(classifyServeResponse(400, JSON_CT, '{"error":"BadResponse"}')).toBe('broken');
    expect(classifyServeResponse(400, 'text/plain', 'Bad Request')).toBe('broken');
  });

  it('treats 5xx, 404, and HTML error pages as broken', () => {
    expect(classifyServeResponse(500, JSON_CT, '{"error":"boom"}')).toBe('broken');
    expect(classifyServeResponse(502, 'text/html', '<html>502 Bad Gateway</html>')).toBe('broken');
    expect(classifyServeResponse(404, JSON_CT, '{"error":"deployment not found"}')).toBe('broken');
    expect(classifyServeResponse(503, 'text/html', '<html>maintenance</html>')).toBe('broken');
  });

  it('does not let an HTML body sneak through on a payment-shaped 4xx', () => {
    // An HTML 402 page is still the serving stack signalling payment; but an HTML
    // 400 mentioning "payment" is a proxy page, not the indexer-service — broken.
    expect(classifyServeResponse(400, 'text/html', '<html>payment required</html>')).toBe('broken');
  });
});

describe('withServeProbe', () => {
  const base: IndexerStatusResult = {
    indexerId: '0xabc',
    indexerName: 'test',
    url: 'https://indexer.example',
    allocatedTokens: '0',
    status: 'synced',
  };

  it('maps alive_paid → servable true, everything else false', () => {
    expect(withServeProbe(base, 'alive_paid')).toMatchObject({ serveProbe: 'alive_paid', servable: true });
    expect(withServeProbe(base, 'broken')).toMatchObject({ serveProbe: 'broken', servable: false });
    expect(withServeProbe(base, 'unreachable')).toMatchObject({ serveProbe: 'unreachable', servable: false });
  });
});
