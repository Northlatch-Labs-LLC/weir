// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const recordFailure = vi.fn();

vi.mock('@/lib/rate-limit', () => ({
  simulateLimit: async () => null, rateLimit: () => null, clientKey: () => 'x' }));
vi.mock('@/lib/error-log', () => ({
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

  it('a long detail is trimmed to what the table stores, not rejected', async () => {
    const response = await report(post({ source: 'browser crash', detail: 'a'.repeat(9000) }));
    expect(response.status).toBe(200);
    expect(recordFailure).toHaveBeenCalledWith({ source: 'browser crash', detail: 'a'.repeat(4000) });
  });

  it('the allowlist is the literal global-error.tsx posts, so a real report cannot be dropped', () => {
    const sender = readFileSync(join(import.meta.dirname, '../app/global-error.tsx'), 'utf8');
    expect(sender).toContain("source: 'browser crash'");
  });
});
