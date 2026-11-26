// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
//
// The site is served through Cloudflare, and on 2026-11-25 an external scan reached the server
// without passing it three ways: the host the platform gives every project
// (projectx-social.vercel.app), a platform address with weir.social in the handshake, and — on
// that path — a client-chosen cf-connecting-ip. The edge's per-address limits (the scan measured
// 81 of 210 refused through Cloudflare and 0 of 210 around it) and any rule at the edge were left
// behind. No account or authorisation was reached that way; what was lost was the edge itself.
//
// An address cannot be hidden from somebody who can ask for it by name. What the server can do is
// serve nobody but the edge — and the order in which that is safe to switch on is the whole design:
// it does nothing until asked, and nothing if asked before the edge is known to present its secret.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const web = join(import.meta.dirname, '..');
const { edgeRequiredRefusal } = await import('../lib/rate-limit');
const { isSchedulerReached } = await import('../lib/front-door');
const { proxy } = await import('../proxy');

const SECRET = 'a-shared-secret-known-to-the-edge';
/** Every way the scan reached the server without the edge. None carries the secret. */
const AROUND_THE_EDGE: readonly [string, string][] = [
  ['the host the platform gives the project', 'https://projectx-social.vercel.app/feed'],
  ['the same host, with a client-chosen address for the limiter', 'https://projectx-social.vercel.app/api/deployment'],
  ['a platform address asked for by the site’s own name', 'https://76.76.21.21/'],
];

afterEach(() => vi.unstubAllEnvs());

describe('edgeRequiredRefusal', () => {
  it('does nothing until the deployment asks for it, whatever arrives', () => {
    vi.stubEnv('PROJECTX_SOCIAL_BEHIND_CLOUDFLARE', 'true');
    vi.stubEnv('PROJECTX_SOCIAL_EDGE_SECRET', SECRET);
    vi.stubEnv('PROJECTX_SOCIAL_REQUIRE_EDGE', '');
    for (const [, url] of AROUND_THE_EDGE) {
      expect(edgeRequiredRefusal(new Request(url, { headers: { 'cf-connecting-ip': '1.2.3.4' } })), url).toBeNull();
    }
    delete process.env['PROJECTX_SOCIAL_REQUIRE_EDGE'];
    expect(edgeRequiredRefusal(new Request('https://projectx-social.vercel.app/feed'))).toBeNull();
  });

  it('refuses a request that did not come through the edge, on each of the paths the scan took', () => {
    vi.stubEnv('PROJECTX_SOCIAL_BEHIND_CLOUDFLARE', 'true');
    vi.stubEnv('PROJECTX_SOCIAL_EDGE_SECRET', SECRET);
    vi.stubEnv('PROJECTX_SOCIAL_REQUIRE_EDGE', 'true');
    for (const [how, url] of AROUND_THE_EDGE) {
      const refusal = edgeRequiredRefusal(new Request(url, { headers: { 'cf-connecting-ip': '1.2.3.4' } }));
      expect(refusal, how).not.toBeNull();
      expect(refusal?.status, how).toBe(403);
      expect(refusal?.headers.get('cache-control'), how).toBe('no-store');
    }
  });

  it('refuses a wrong secret, and a secret of the right length that differs in one character', () => {
    vi.stubEnv('PROJECTX_SOCIAL_BEHIND_CLOUDFLARE', 'true');
    vi.stubEnv('PROJECTX_SOCIAL_EDGE_SECRET', SECRET);
    vi.stubEnv('PROJECTX_SOCIAL_REQUIRE_EDGE', 'true');
    const wrong = new Request('https://weir.social/feed', { headers: { 'x-edge-secret': 'not-the-secret' } });
    expect(edgeRequiredRefusal(wrong)?.status).toBe(403);
    const almost = SECRET.slice(0, -1) + (SECRET.endsWith('e') ? 'f' : 'e');
    expect(edgeRequiredRefusal(new Request('https://weir.social/feed', { headers: { 'x-edge-secret': almost } }))?.status).toBe(403);
  });

  it('lets through a request that carries the secret, whoever the edge says it came from', () => {
    vi.stubEnv('PROJECTX_SOCIAL_BEHIND_CLOUDFLARE', 'true');
    vi.stubEnv('PROJECTX_SOCIAL_EDGE_SECRET', SECRET);
    vi.stubEnv('PROJECTX_SOCIAL_REQUIRE_EDGE', 'true');
    for (const visitor of ['203.0.113.9', '2001:db8::1', '']) {
      const request = new Request('https://weir.social/explore', {
        headers: { 'x-edge-secret': SECRET, ...(visitor === '' ? {} : { 'cf-connecting-ip': visitor }) },
      });
      expect(edgeRequiredRefusal(request), visitor).toBeNull();
    }
  });

  it('refuses nobody when asked without the two settings that make the question answerable', () => {
    vi.stubEnv('PROJECTX_SOCIAL_REQUIRE_EDGE', 'true');
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      // Not declared to be behind an edge at all.
      vi.stubEnv('PROJECTX_SOCIAL_BEHIND_CLOUDFLARE', '');
      vi.stubEnv('PROJECTX_SOCIAL_EDGE_SECRET', SECRET);
      expect(edgeRequiredRefusal(new Request('https://weir.social/feed'))).toBeNull();

      // Behind one, with no secret to show.
      vi.stubEnv('PROJECTX_SOCIAL_BEHIND_CLOUDFLARE', 'true');
      vi.stubEnv('PROJECTX_SOCIAL_EDGE_SECRET', '');
      expect(edgeRequiredRefusal(new Request('https://weir.social/feed'))).toBeNull();

      expect(warn).toHaveBeenCalled();
      expect(String(warn.mock.calls[0]?.[0])).toMatch(/Nothing is being refused/);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('the proxy asks first', () => {
  const source = readFileSync(join(web, 'proxy.ts'), 'utf8');

  it('refuses before it reads the site mode or anyone’s session', () => {
    const asked = source.indexOf('edgeRequiredRefusal(request)');
    expect(asked).toBeGreaterThan(-1);
    expect(asked).toBeLessThan(source.indexOf('readSiteMode()'));
    expect(asked).toBeLessThan(source.indexOf('provenReaderFor(request)'));
  });

  it('exempts exactly the route the scheduler reaches, and nothing else under it', () => {
    expect(isSchedulerReached('/api/cron/daemon')).toBe(true);
    for (const other of ['/api/cron/', '/api/cron/daemon/x', '/api/cron/other', '/api/cron', '/api/']) {
      expect(isSchedulerReached(other), other).toBe(false);
    }
    expect(source.indexOf('isSchedulerReached(pathname)')).toBeLessThan(source.indexOf('edgeRequiredRefusal(request)'));
  });

  it('at the route itself: the whole site is refused around the edge, and served through it', async () => {
    vi.stubEnv('PROJECTX_SOCIAL_BEHIND_CLOUDFLARE', 'true');
    vi.stubEnv('PROJECTX_SOCIAL_EDGE_SECRET', SECRET);
    vi.stubEnv('PROJECTX_SOCIAL_REQUIRE_EDGE', 'true');

    const around = await proxy(new NextRequest('https://projectx-social.vercel.app/explore', { headers: { 'cf-connecting-ip': '1.2.3.4' } }));
    expect(around.status).toBe(403);

    // /explore is always open, so through the edge it is let through, with the document policy.
    const through = await proxy(new NextRequest('https://weir.social/explore', { headers: { 'x-edge-secret': SECRET } }));
    expect(through.status).toBe(200);
    expect(through.headers.get('content-security-policy')).toContain("default-src 'self'");

    // The scheduler's route carries no secret and is served anyway.
    const cron = await proxy(new NextRequest('https://projectx-social.vercel.app/api/cron/daemon'));
    expect(cron.status).not.toBe(403);
  });
});
