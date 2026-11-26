// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
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
    expect(query).toHaveBeenCalled();
    expect(String(query.mock.calls[0]?.[0] ?? '')).toMatch(/agent_quotas/i);
  });

  it('keys an anonymous caller so it cannot collide with an address', async () => {
    query.mockResolvedValue({ rowCount: 1, rows: [{ tokens: 5 }] });
    const { spendShared } = await import('../lib/rate-limit');

    await spendShared('203.0.113.9', 'read');

    const key = String((query.mock.calls[0]?.[1] as unknown[])?.[0] ?? '');
    expect(key).toBe('ip:203.0.113.9');
    expect(key.startsWith('0x')).toBe(false);
  });

  it('refuses when the ceiling is reached, and says how long to wait', async () => {
    // The deployment's breaker is asked first (one write, allowed), then this caller's row refuses.
    query.mockResolvedValueOnce({ rowCount: 1, rows: [{ tokens: 5 }] });
    query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    query.mockResolvedValueOnce({ rows: [{ tokens: 0, refilled_at_ms: '1000' }] });
    const { sharedLimit } = await import('../lib/rate-limit');

    const refused = await sharedLimit(get(), 'read');

    expect(refused?.status).toBe(429);
    expect(Number(refused?.headers.get('retry-after'))).toBeGreaterThan(0);
    // The caller's bucket, not the deployment's, is the one named.
    expect(((await refused?.json()) as { bucket?: string }).bucket).toBe('read');
  });

  /*
    A ceiling that holds for one address is still a ceiling per address. Since 2026-11-26 the
    shared limit consults the deployment-wide breaker before the caller's row, as quotaLimit
    always did, so that however many addresses ask, the whole has a ceiling.
  */
  it('trips the deployment’s breaker before it looks at the caller', async () => {
    // The breaker's write is refused and its row is empty: the deployment is over its ceiling.
    query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    query.mockResolvedValueOnce({ rows: [{ tokens: 0, refilled_at_ms: '1000' }] });
    const { sharedLimit } = await import('../lib/rate-limit');

    const refused = await sharedLimit(get(), 'read');

    // The breaker's own answer, as quotaLimit has always given it: not this caller's fault.
    expect(refused?.status).toBe(503);
    expect(refused?.headers.get('x-weir-breaker')).toBe('read;over-ceiling');
    expect(JSON.stringify(query.mock.calls[0]?.[1])).toContain('*deployment*');
    // The caller's row was never read: the deployment was already over.
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('fails CLOSED when the store cannot be reached', async () => {
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
    const local = code.indexOf('rateLimit(');
    const shared = code.indexOf('sharedLimit(');
    expect(local).toBeGreaterThan(-1);
    expect(local).toBeLessThan(shared);
  });
});
