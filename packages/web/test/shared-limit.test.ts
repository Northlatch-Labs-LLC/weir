// @vitest-environment node
// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
//
// A ceiling that holds across instances, and a header that has to prove itself.
//
// Two defects, one file, because they are the same defect seen from two sides: the limiter believes
// things it cannot check.
//
//  1. `rateLimit` is a per-PROCESS map. Its own header says so. The consequence is that the number
//     in the code is not the number a caller meets — it is that number times however many instances
//     are warm. Seventy sequential requests to a freshly-limited route saw no refusal at all, which
//     is what "the guard is working and the ceiling is not the ceiling" looks like from outside.
//
//  2. `clientKey` trusts `cf-connecting-ip` on the strength of a boolean in the environment. A
//     boolean is a statement about the DEPLOYMENT; the question is about the REQUEST, and the two
//     differ exactly when somebody reaches the origin directly.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const query = vi.fn();

vi.mock('@/lib/db', () => ({
  db: () => ({ query: (...a: unknown[]) => query(...a) }),
  normaliseAddress: (a: string) => {
    if (!/^0x[0-9a-f]{64}$/i.test(a)) throw new Error('not an address');
    return a.toLowerCase();
  },
}));

function get(headers: Record<string, string> = {}): Request {
  return new Request('https://weir.social/api/creator/perks?handle=atlas', { headers });
}

beforeEach(() => {
  vi.resetModules();
  query.mockReset();
  delete process.env['PROJECTX_SOCIAL_BEHIND_CLOUDFLARE'];
  delete process.env['PROJECTX_SOCIAL_EDGE_SECRET'];
});

afterEach(() => {
  delete process.env['PROJECTX_SOCIAL_BEHIND_CLOUDFLARE'];
  delete process.env['PROJECTX_SOCIAL_EDGE_SECRET'];
});

describe('the shared ceiling is in the database, not in this process', () => {
  it('spends against a row rather than a map', async () => {
    query.mockResolvedValue({ rowCount: 1, rows: [{ tokens: 5 }] });
    const { sharedLimit } = await import('../lib/rate-limit');

    const refused = await sharedLimit(get(), 'read');

    expect(refused).toBeNull();
    // The point of the change: a statement was issued. A per-process map issues none, which is
    // exactly why its ceiling multiplies by the instance count.
    expect(query).toHaveBeenCalled();
    expect(String(query.mock.calls[0]?.[0] ?? '')).toMatch(/agent_quotas/i);
  });

  it('keys an anonymous caller so it cannot collide with an address', async () => {
    query.mockResolvedValue({ rowCount: 1, rows: [{ tokens: 5 }] });
    const { spendShared } = await import('../lib/rate-limit');

    await spendShared('203.0.113.9', 'read');

    const key = String((query.mock.calls[0]?.[1] as unknown[])?.[0] ?? '');
    expect(key).toBe('ip:203.0.113.9');
    // Addresses are 0x and sixty-six characters, so the two namespaces cannot meet.
    expect(key.startsWith('0x')).toBe(false);
  });

  it('refuses when the ceiling is reached, and says how long to wait', async () => {
    // rowCount 0 is the refusal: the conditional update wrote nothing.
    query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    query.mockResolvedValueOnce({ rows: [{ tokens: 0, refilled_at_ms: '1000' }] });
    const { sharedLimit } = await import('../lib/rate-limit');

    const refused = await sharedLimit(get(), 'read');

    expect(refused?.status).toBe(429);
    // Never zero: a Retry-After of 0 asks for exactly the behaviour being limited.
    expect(Number(refused?.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('fails CLOSED when the store cannot be reached', async () => {
    // A limit an attacker turns off by making Postgres unreachable is not a limit.
    query.mockRejectedValue(new Error('connection refused'));
    const { sharedLimit } = await import('../lib/rate-limit');

    const refused = await sharedLimit(get(), 'read');

    expect(refused).not.toBeNull();
    expect(refused?.status).toBe(503);
  });
});

describe('the proxy header has to prove the request came through the proxy', () => {
  it('trusts the visitor header when no secret is configured, exactly as before', async () => {
    process.env['PROJECTX_SOCIAL_BEHIND_CLOUDFLARE'] = 'true';
    const { clientKey } = await import('../lib/rate-limit');

    expect(clientKey(get({ 'cf-connecting-ip': '203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('refuses to trust it when a secret is configured and the request cannot present it', async () => {
    /*
      This is the bypass. A caller reaching the origin directly sets `cf-connecting-ip` themselves
      and mints a fresh bucket per request — the `x-forwarded-for` hole this function already closed
      once, under a different header name. Without the secret they are one shared bucket, not
      unlimited ones.
    */
    process.env['PROJECTX_SOCIAL_BEHIND_CLOUDFLARE'] = 'true';
    process.env['PROJECTX_SOCIAL_EDGE_SECRET'] = 'from-the-edge';
    const { clientKey } = await import('../lib/rate-limit');

    expect(clientKey(get({ 'cf-connecting-ip': '203.0.113.7' }))).toBe('unattributed');
  });

  it('trusts it again when the request presents the secret', async () => {
    process.env['PROJECTX_SOCIAL_BEHIND_CLOUDFLARE'] = 'true';
    process.env['PROJECTX_SOCIAL_EDGE_SECRET'] = 'from-the-edge';
    const { clientKey } = await import('../lib/rate-limit');

    const key = clientKey(get({ 'cf-connecting-ip': '203.0.113.7', 'x-edge-secret': 'from-the-edge' }));
    expect(key).toBe('203.0.113.7');
  });

  it('does not accept a near-miss secret', async () => {
    process.env['PROJECTX_SOCIAL_BEHIND_CLOUDFLARE'] = 'true';
    process.env['PROJECTX_SOCIAL_EDGE_SECRET'] = 'from-the-edge';
    const { clientKey } = await import('../lib/rate-limit');

    expect(clientKey(get({ 'cf-connecting-ip': '203.0.113.7', 'x-edge-secret': 'from-the-edg' }))).toBe(
      'unattributed',
    );
  });
});

describe('the route that could not be verified now carries the durable ceiling', () => {
  /*
    Asserted against the route source, because the behavioural tests above prove `sharedLimit`
    WORKS and prove nothing about whether anything CALLS it. A mutation removing the call from the
    route passed every other assertion in this file — which is the same shape as the wiring defect
    already recorded against the sponsor route, where a correct function was invoked by nothing.
  */
  const code = readFileSync(join(process.cwd(), 'app/api/creator/perks/route.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  it('calls sharedLimit, and not only in a comment', () => {
    expect(code).toContain('sharedLimit(');
  });

  it('calls it before it reaches the database', () => {
    const shared = code.indexOf('sharedLimit(');
    const listPerks = code.indexOf('listPerks(');
    expect(shared).toBeGreaterThan(-1);
    expect(listPerks).toBeGreaterThan(-1);
    expect(shared).toBeLessThan(listPerks);
  });

  it('keeps the cheap per-process guard as the first line', () => {
    // Two layers on purpose: the local map costs nothing and stops a naive loop against a warm
    // instance before a round trip is spent.
    const local = code.indexOf('rateLimit(');
    const shared = code.indexOf('sharedLimit(');
    expect(local).toBeGreaterThan(-1);
    expect(local).toBeLessThan(shared);
  });
});
