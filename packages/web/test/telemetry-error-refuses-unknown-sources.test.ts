// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const recordFailure = vi.fn();

vi.mock('@/lib/rate-limit', () => ({
 spendQuota: async () => ({ allowed: true, remaining: 1 }), tripBreaker: async () => ({ tripped: false }),  simulateLimit: async () => null, rateLimit: () => null, sharedLimit: async () => null, clientKey: () => 'x' }));
// Only the insert is replaced. The shaping of the text (oneLine) is the route's own behaviour and
// is under test, so it stays real.
vi.mock('@/lib/error-log', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  recordFailure: (...a: unknown[]) => recordFailure(...a),
}));

const report = (await import('../app/api/telemetry/error/route')).POST;

function post(body: unknown): Request {
  return new Request('https://weir.social/api/telemetry/error', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

afterEach(() => vi.clearAllMocks());

/*
  The alarm pages on how fast error_events grows, and this endpoint answers to no session, so a
  source any caller can type is one address away from manufactured pages. The route now accepts the
  one literal its only sender posts and refuses everything else before the table is touched.
*/
describe('the crash endpoint records only the source its one sender uses', () => {
  it('the report global-error.tsx sends is recorded untouched', async () => {
    const response = await report(
      post({ source: 'browser crash', detail: 'Minified React error #185', route: '/studio' }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ recorded: true });
    expect(recordFailure).toHaveBeenCalledWith({
      source: 'browser crash',
      detail: 'Minified React error #185',
      route: '/studio',
    });
  });

  it.each([
    ['a made-up source', { source: 'checkout', detail: 'x' }],
    ['the old default for a missing source', { detail: 'x' }],
    ['a non-string source', { source: 42, detail: 'x' }],
    ['a near-miss of the literal', { source: 'browser-crash', detail: 'x' }],
    ['a server writer that never passes through http', { source: 'console.error', detail: 'x' }],
  ])('%s is a 400 and nothing reaches the table', async (_, body) => {
    const response = await report(post(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'unknown source' });
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it('a long detail is trimmed to one crash message worth, not rejected', async () => {
    const response = await report(post({ source: 'browser crash', detail: 'a'.repeat(600) }));
    expect(response.status).toBe(200);
    expect(recordFailure).toHaveBeenCalledWith({ source: 'browser crash', detail: 'a'.repeat(500) });
  });

  /*
    A crash message is a sentence. Anything else — a number, an object, a missing field — is not
    the sender this route exists for, and was recorded as the words "no detail" until 2026-11-25,
    which let any caller add a row without sending a message at all.
  */
  it.each([
    ['a number', 61],
    ['an object', { img: '<img src=x onerror=alert(61)>' }],
    ['nothing', undefined],
  ])('a detail that is %s is a 400, not a row', async (_, detail) => {
    const response = await report(post({ source: 'browser crash', detail, route: '/studio' }));
    expect(response.status).toBe(400);
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it.each(['feed', '//evil.example', '/\\evil.example', '/feed?token=x', '/feed#x', '/fe ed'])(
    'a route that is not one path (%s) is a 400, not a row',
    async (route) => {
      const response = await report(post({ source: 'browser crash', detail: 'x', route }));
      expect(response.status).toBe(400);
      expect(recordFailure).not.toHaveBeenCalled();
    },
  );

  it('stores what a person can read on one line: no carriage returns, no escape sequences, no NUL', async () => {
    const response = await report(
      post({ source: 'browser crash', detail: 'l1\r\nl2\r\n[FAKE] forged entry\u001b[31m\u0000', route: '/studio' }),
    );
    expect(response.status).toBe(200);
    expect(recordFailure).toHaveBeenCalledWith({
      source: 'browser crash',
      detail: 'l1 l2 [FAKE] forged entry[31m',
      route: '/studio',
    });
  });

  it('the allowlist is the literal global-error.tsx posts, so a real report cannot be dropped', () => {
    const sender = readFileSync(join(import.meta.dirname, '../app/global-error.tsx'), 'utf8');
    expect(sender).toContain("source: 'browser crash'");
  });
});
