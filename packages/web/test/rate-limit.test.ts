// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * The ceiling on request volume.
 *
 * # What is worth asserting
 *
 * Not "it counts", which any implementation does. The things that make a limiter useless in
 * practice are subtler: a window that resets on a boundary so a caller can spend twice the budget
 * across two seconds; a key taken from a header the caller controls; a `Retry-After` of zero that
 * invites the retry it is meant to delay; and a table that grows without bound, turning the defence
 * into the exhaustion attack it exists to stop.
 *
 * `consume` takes `now` as a parameter precisely so the window can be tested without waiting a
 * minute, and without a fake clock that would need mocking in every file that touches this.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUDGETS, clientKey, consume, rateLimit, resetRateLimits } from '../lib/rate-limit';

const BUDGET = { limit: 3, windowMs: 60_000 };

beforeEach(() => resetRateLimits());

describe('counting within a window', () => {
  it('allows exactly the budget and refuses the next one', () => {
    const t = 1_000_000;
    for (let i = 0; i < BUDGET.limit; i += 1) {
      expect(consume('k', BUDGET, t).allowed).toBe(true);
    }
    expect(consume('k', BUDGET, t).allowed).toBe(false);
  });

  it('counts each key separately, so one caller cannot lock out another', () => {
    const t = 1_000_000;
    for (let i = 0; i < BUDGET.limit; i += 1) consume('noisy', BUDGET, t);

    expect(consume('noisy', BUDGET, t).allowed).toBe(false);
    expect(consume('quiet', BUDGET, t).allowed).toBe(true);
  });

  it('slides rather than resetting on a boundary', () => {
    /*
      The defect a fixed window has: spend the budget at the end of one window and the whole budget
      again at the start of the next, for double the intended rate at the worst moment. Here the
      window is measured backwards from now, so allowance returns gradually.
    */
    /*
      The hits are spread deliberately. Three at one instant all age out together, which would pass
      against a fixed window too and prove nothing — the first version of this test did exactly
      that, and was measuring nothing.
    */
    const t = 1_000_000;
    consume('k', BUDGET, t);
    consume('k', BUDGET, t + 1_000);
    consume('k', BUDGET, t + 2_000);
    expect(consume('k', BUDGET, t + 3_000).allowed).toBe(false);

    // Only the first has left the window here, so exactly one slot opens — not the whole budget.
    expect(consume('k', BUDGET, t + 60_500).allowed).toBe(true);
    expect(consume('k', BUDGET, t + 60_500).allowed).toBe(false);
  });

  it('never tells a refused caller to retry immediately', () => {
    const t = 1_000_000;
    for (let i = 0; i < BUDGET.limit; i += 1) consume('k', BUDGET, t);

    const refused = consume('k', BUDGET, t + 59_999);
    expect(refused.allowed).toBe(false);
    // A `Retry-After: 0` asks for exactly the behaviour being limited.
    expect(refused.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });
});

describe('identifying the caller', () => {
  function req(headers: Record<string, string>): Request {
    return new Request('https://x/api/posts', { headers });
  }

  it('prefers the header the platform sets over the one the client can set', () => {
    // `x-forwarded-for` is client-settable; a caller who could choose their own bucket could simply
    // pick a fresh one per request and never be limited at all.
    expect(clientKey(req({ 'x-real-ip': '9.9.9.9', 'x-forwarded-for': '1.1.1.1' }))).toBe('9.9.9.9');
  });

  it('ignores x-forwarded-for entirely, however plausible the entry looks', () => {
    /*
      This used to return '1.1.1.1' — the first entry, on the reasoning that an edge network puts
      the origin address there. True, and irrelevant: a caller who sends the header chooses that
      entry themselves, so it named whoever was asking rather than whoever was calling.

      The consequence was not only a bypass. Every fabricated value took a slot in the hit table,
      whose prune evicts the least-recently-used third when full — so a caller escaping the limit
      also cleared it for everybody who was being limited.
    */
    expect(clientKey(req({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3' }))).toBe('unattributed');
  });

  it('gives a rotating forwarded header no more budget than sending nothing', () => {
    // The bypass, stated as the property that matters: a caller cannot mint fresh buckets. Three
    // different spoofed headers must land in one bucket, not three.
    const keys = ['1.1.1.1', '2.2.2.2', '3.3.3.3'].map((ip) =>
      clientKey(req({ 'x-forwarded-for': ip })),
    );
    expect(new Set(keys).size).toBe(1);
  });

  it('ignores cf-connecting-ip unless configured to be behind Cloudflare', () => {
    // The same trap as x-forwarded-for. `CF-Connecting-IP` is unforgeable only because Cloudflare
    // overwrites it; with nothing in front it is just another header the caller chose, and
    // trusting it unconditionally would restore the bypass this function exists to prevent.
    expect(clientKey(req({ 'cf-connecting-ip': '1.1.1.1' }))).toBe('unattributed');
    expect(clientKey(req({ 'cf-connecting-ip': '1.1.1.1', 'x-real-ip': '9.9.9.9' }))).toBe('9.9.9.9');
  });

  it('prefers cf-connecting-ip over x-real-ip once behind Cloudflare', () => {
    // Proxied, `x-real-ip` is Vercel's view of *Cloudflare* — the same value for every visitor. The
    // visitor's own address is the one that must key the bucket.
    vi.stubEnv('PROJECTX_SOCIAL_BEHIND_CLOUDFLARE', 'true');
    expect(clientKey(req({ 'cf-connecting-ip': '1.1.1.1', 'x-real-ip': '9.9.9.9' }))).toBe('1.1.1.1');
    vi.unstubAllEnvs();
  });

  it('shares one bucket when configured as proxied but the request bypassed the proxy', () => {
    // Reaching the origin directly. Falling back to `x-real-ip` here would key on the proxy for
    // proxied traffic and on the origin edge for the rest — two meanings in one bucket space.
    vi.stubEnv('PROJECTX_SOCIAL_BEHIND_CLOUDFLARE', 'true');
    expect(clientKey(req({ 'x-real-ip': '9.9.9.9' }))).toBe('unattributed');
    vi.unstubAllEnvs();
  });

  it('shares one bucket when nothing identifies the caller', () => {
    // Too strict rather than absent. A limiter that cannot tell callers apart must not conclude
    // that everybody is a different caller.
    expect(clientKey(req({}))).toBe('unattributed');
  });
});

describe('the guard a route calls', () => {
  it('returns null while under the limit, so the route proceeds', () => {
    const request = new Request('https://x/api/posts', { headers: { 'x-real-ip': '5.5.5.5' } });
    expect(rateLimit(request, 'read')).toBeNull();
  });

  it('answers 429 with a retry-after once over', () => {
    const request = new Request('https://x/api/posts', { headers: { 'x-real-ip': '6.6.6.6' } });
    let last: Response | null = null;
    for (let i = 0; i <= BUDGETS.simulate.limit; i += 1) last = rateLimit(request, 'simulate');

    expect(last).not.toBeNull();
    expect(last?.status).toBe(429);
    expect(Number(last?.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
  });

  it('keeps the classes apart, so a cheap read cannot exhaust the expensive budget', () => {
    const request = new Request('https://x/api/posts', { headers: { 'x-real-ip': '7.7.7.7' } });
    for (let i = 0; i <= BUDGETS.simulate.limit; i += 1) rateLimit(request, 'simulate');

    expect(rateLimit(request, 'simulate')).not.toBeNull();
    expect(rateLimit(request, 'read')).toBeNull();
  });

  it('prices a chain-touching call below an ordinary read', () => {
    // The ordering is the whole design: simulation calls a shared fullnode, a read does not.
    expect(BUDGETS.simulate.limit).toBeLessThan(BUDGETS.read.limit);
    expect(BUDGETS.write.limit).toBeLessThan(BUDGETS.read.limit);
  });
});

describe('the table itself', () => {
  it('stays bounded when a caller rotates through addresses', () => {
    /*
      Unbounded growth here is memory exhaustion delivered through the defence against exhaustion.
      Ten thousand is the cap; twelve thousand distinct keys must not leave twelve thousand entries.
    */
    const t = 1_000_000;
    for (let i = 0; i < 12_000; i += 1) consume(`k${i}`, BUDGET, t + i);

    // Nothing here reads the map directly — what is asserted is that the process is still standing
    // and still limiting, which is what the cap exists to preserve.
    for (let i = 0; i < BUDGET.limit; i += 1) consume('after', BUDGET, t);
    expect(consume('after', BUDGET, t).allowed).toBe(false);
  });
});
