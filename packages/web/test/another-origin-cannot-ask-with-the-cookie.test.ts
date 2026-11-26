// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
//
// A page on another origin of this site can attach the administrator's cookie to a request. The
// cookie is SameSite=Lax: that stops another site, and does nothing about portal.weir.social or
// api.weir.social, which are this site and not this origin. Until 2026-11-25 four handlers changed
// something on the strength of that cookie alone — close or open the site, mint an access code,
// revoke one, end every session — and read their body without asking what type it claimed to be,
// so no preflight stood in the way.
//
// Every handler here is driven with the administrator's cookie and with what a browser says about
// where a request came from. The effects are spies, so the claim under test is exact: was the
// change made or not.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRateLimits } from '../lib/rate-limit';

const ADMIN = '0x' + 'ab'.repeat(32);
const REFUSAL = 'a change to the site has to be asked for from the site';

const mintAccessCode = vi.fn(async (_input: unknown, _by: string) => ({ code: 'ABCD-EFGH-JKLM' }));
const revokeAccessCode = vi.fn(async (_code: string, _by: string) => undefined);
const setSiteMode = vi.fn(async (waitlistMode: boolean, _by: string) => ({
  waitlistMode,
  updatedBy: ADMIN,
  updatedAtIso: null,
  launchTarget: null,
}));
const revokeReadSessions = vi.fn(async (_address: string) => undefined);

vi.mock('@/lib/access-codes', () => ({
  listAccessCodes: async () => [],
  mintAccessCode,
  revokeAccessCode,
}));

vi.mock('@/lib/site-admin', () => ({ isSiteAdmin: async () => true }));
vi.mock('@/lib/site-mode', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  setSiteMode,
}));

// The session itself is not under test here — only where the request came from. Any request that
// presents a session at all is the administrator's.
vi.mock('@/lib/read-session', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  provenReaderFor: async (request: Request) => {
    const holds =
      request.headers.get('cookie') !== null || request.headers.get('authorization') !== null;
    return holds ? { ok: true, value: ADMIN } : { ok: true, value: null };
  },
  revokeReadSessions,
}));

const { POST: closeOrOpen } = await import('../app/api/site-mode/route');
const { POST: mint, DELETE: revoke } = await import('../app/api/access-codes/route');
const { DELETE: endSession } = await import('../app/api/session/route');

const ORIGIN = 'https://weir.social';
const COOKIE = `projectx_read=${'k'.repeat(43)}`;
const BEARER = `Bearer ${'k'.repeat(43)}`;

interface Change {
  name: string;
  path: string;
  method: 'POST' | 'DELETE';
  body: string;
  send: (request: Request) => Promise<Response>;
  effect: ReturnType<typeof vi.fn>;
}

const CHANGES: Change[] = [
  {
    name: 'POST /api/site-mode',
    path: '/api/site-mode',
    method: 'POST',
    body: JSON.stringify({ waitlistMode: true }),
    send: closeOrOpen,
    effect: setSiteMode,
  },
  {
    name: 'POST /api/access-codes',
    path: '/api/access-codes',
    method: 'POST',
    body: JSON.stringify({ label: 'a', maxUses: 1, expiresAtMs: null }),
    send: mint,
    effect: mintAccessCode,
  },
  {
    name: 'DELETE /api/access-codes',
    path: '/api/access-codes',
    method: 'DELETE',
    body: JSON.stringify({ code: 'ABCD-EFGH-JKLM' }),
    send: revoke,
    effect: revokeAccessCode,
  },
  { name: 'DELETE /api/session', path: '/api/session', method: 'DELETE', body: '', send: endSession, effect: revokeReadSessions },
];

/** What a browser puts on the request, given where the page making it lives. */
const browser = {
  sameOrigin: { cookie: COOKIE, 'sec-fetch-site': 'same-origin', origin: ORIGIN },
  anotherOriginOfThisSite: { cookie: COOKIE, 'sec-fetch-site': 'same-site', origin: 'https://portal.weir.social' },
  anotherSite: { cookie: COOKIE, 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' },
  opaqueOrigin: { cookie: COOKIE, 'sec-fetch-site': 'cross-site', origin: 'null' },
};

async function attempt(change: Change, headers: Record<string, string>): Promise<Response> {
  return change.send(
    new Request(`${ORIGIN}${change.path}`, {
      method: change.method,
      headers: { 'x-real-ip': '203.0.113.7', ...(change.body === '' ? {} : { 'content-type': 'text/plain' }), ...headers },
      body: change.body === '' ? undefined : change.body,
    }),
  );
}

async function refusedByOrigin(response: Response): Promise<boolean> {
  if (response.status !== 403) return false;
  return ((await response.json()) as { error?: string }).error === REFUSAL;
}

beforeEach(() => {
  resetRateLimits();
  vi.clearAllMocks();
});

describe.each(CHANGES)('$name, asked for with the administrator’s cookie', (change) => {
  it('is refused when the page that asked is another origin of this site', async () => {
    const response = await attempt(change, browser.anotherOriginOfThisSite);
    expect(await refusedByOrigin(response)).toBe(true);
    expect(change.effect).not.toHaveBeenCalled();
  });

  it('is refused when the page that asked is another site, or an opaque origin', async () => {
    for (const headers of [browser.anotherSite, browser.opaqueOrigin]) {
      expect(await refusedByOrigin(await attempt(change, headers))).toBe(true);
    }
    expect(change.effect).not.toHaveBeenCalled();
  });

  it('is refused on the Origin alone, for a browser that does not send Sec-Fetch-Site', async () => {
    const response = await attempt(change, { cookie: COOKIE, origin: 'https://api.weir.social' });
    expect(await refusedByOrigin(response)).toBe(true);
    expect(change.effect).not.toHaveBeenCalled();
  });

  it('still happens when the page that asked is this one', async () => {
    const response = await attempt(change, browser.sameOrigin);
    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(300);
    expect(change.effect).toHaveBeenCalled();
  });

  it('still happens for a program holding the cookie, which states no origin because it has no page', async () => {
    const response = await attempt(change, { cookie: COOKIE });
    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(300);
    expect(change.effect).toHaveBeenCalled();
  });

  it('is left alone when the session is a Bearer token: no other page can put that header on a request', async () => {
    const response = await attempt(change, { authorization: BEARER, ...browser.anotherSite, cookie: '' });
    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(300);
    expect(change.effect).toHaveBeenCalled();
  });
});

describe('the question itself', () => {
  it('is asked before the cookie is consulted, so the answer does not depend on whose cookie it is', async () => {
    // No session at all, from another origin: refused for where it came from, in those words.
    const response = await attempt(CHANGES[0]!, { 'sec-fetch-site': 'same-site', origin: 'https://portal.weir.social' });
    // Without a cookie there is nothing to borrow, so this one falls through to the address check.
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: string }).error).toBe('this address does not administer the site');
  });
});
