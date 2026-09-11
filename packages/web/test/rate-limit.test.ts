// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

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
    const t = 1_000_000;
    consume('k', BUDGET, t);
    consume('k', BUDGET, t + 1_000);
    consume('k', BUDGET, t + 2_000);
    expect(consume('k', BUDGET, t + 3_000).allowed).toBe(false);

    expect(consume('k', BUDGET, t + 60_500).allowed).toBe(true);
    expect(consume('k', BUDGET, t + 60_500).allowed).toBe(false);
  });

  it('never tells a refused caller to retry immediately', () => {
    const t = 1_000_000;
    for (let i = 0; i < BUDGET.limit; i += 1) consume('k', BUDGET, t);

    const refused = consume('k', BUDGET, t + 59_999);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });
});

describe('identifying the caller', () => {
  function req(headers: Record<string, string>): Request {
    return new Request('https://x/api/posts', { headers });
  }

  it('prefers the header the platform sets over the one the client can set', () => {
    expect(clientKey(req({ 'x-real-ip': '9.9.9.9', 'x-forwarded-for': '1.1.1.1' }))).toBe('9.9.9.9');
  });

  it('ignores x-forwarded-for entirely, however plausible the entry looks', () => {
    expect(clientKey(req({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3' }))).toBe('unattributed');
  });

  it('gives a rotating forwarded header no more budget than sending nothing', () => {
    const keys = ['1.1.1.1', '2.2.2.2', '3.3.3.3'].map((ip) =>
      clientKey(req({ 'x-forwarded-for': ip })),
    );
    expect(new Set(keys).size).toBe(1);
  });

  it('ignores cf-connecting-ip unless configured to be behind Cloudflare', () => {
    expect(clientKey(req({ 'cf-connecting-ip': '1.1.1.1' }))).toBe('unattributed');
    expect(clientKey(req({ 'cf-connecting-ip': '1.1.1.1', 'x-real-ip': '9.9.9.9' }))).toBe('9.9.9.9');
  });

  it('prefers cf-connecting-ip over x-real-ip once behind Cloudflare', () => {
    vi.stubEnv('PROJECTX_SOCIAL_BEHIND_CLOUDFLARE', 'true');
    expect(clientKey(req({ 'cf-connecting-ip': '1.1.1.1', 'x-real-ip': '9.9.9.9' }))).toBe('1.1.1.1');
    vi.unstubAllEnvs();
  });

  it('shares one bucket when configured as proxied but the request bypassed the proxy', () => {
    vi.stubEnv('PROJECTX_SOCIAL_BEHIND_CLOUDFLARE', 'true');
    expect(clientKey(req({ 'x-real-ip': '9.9.9.9' }))).toBe('unattributed');
    vi.unstubAllEnvs();
  });

  it('shares one bucket when nothing identifies the caller', () => {
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
    expect(BUDGETS.simulate.limit).toBeLessThan(BUDGETS.read.limit);
    expect(BUDGETS.write.limit).toBeLessThan(BUDGETS.read.limit);
  });
});

describe('the table itself', () => {
  it('stays bounded when a caller rotates through addresses', () => {
    const t = 1_000_000;
    for (let i = 0; i < 12_000; i += 1) consume(`k${i}`, BUDGET, t + i);

    for (let i = 0; i < BUDGET.limit; i += 1) consume('after', BUDGET, t);
    expect(consume('after', BUDGET, t).allowed).toBe(false);
  });
});
