// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * One session, two carriers, and no difference between them.
 *
 * `test/read-session.test.ts` pins the primitive: the token never reaches the database, expiry is
 * enforced in the query, and every failure resolves to anonymous. This file pins the property that
 * the header must not disturb any of it.
 *
 * # What would actually be a vulnerability here
 *
 * Two shapes, and each has a test whose failure is a real one rather than a cosmetic regression:
 *
 *   1. **The header taking a different path to an address than the cookie.** A second lookup, a
 *      relaxed expiry, a table the revocation does not reach — any of those makes
 *      `DELETE /api/session` a lie for one of the two carriers, and the reader who signed out
 *      because a device was lost is the person it is a lie to. So the test asserts the *SQL and its
 *      parameters* are byte-identical between the two, not merely that both return the address.
 *   2. **A browser behaving differently after the change.** The cookie decides whenever there is
 *      one, so a request with a cookie must issue exactly the queries it issued before and must not
 *      consult a header at all. Asserted by counting queries, because "it also happens to work" and
 *      "it takes the same path" are not the same claim.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

/** Every call the module made, in order, so a test can compare the SQL *and* its parameters. */
const queries: Array<{ sql: string; params: unknown[] }> = [];
let rows: Array<{ address: string }> = [];
let failure: Error | null = null;

vi.mock('../lib/db', () => ({
  db: () => ({
    query: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      if (failure !== null) throw failure;
      return { rows, rowCount: rows.length };
    },
  }),
  normaliseAddress: (address: string) => address.toLowerCase(),
}));

/*
  The mint route's two collaborators. The signature is asserted elsewhere — `test/replay.test.ts`
  signs a real statement with a real keypair — so what is stubbed here is everything except the one
  thing under test: what the route hands back once the proof has passed.
*/
vi.mock('@/lib/rate-limit', () => ({
  // The simulate-class guard: durable ceiling plus the per-process Map. Allowed here, because
  // these files are about what the route decides and not about how often it may be asked.
  simulateLimit: async () => null, rateLimit: () => null }));
vi.mock('@/lib/identity', () => ({
  verifyAction: async () => ({ ok: true, value: true, observedAtMs: Date.now() }),
}));

const { READ_SESSION_COOKIE, bearerFromHeader, provenReaderFor } = await import(
  '../lib/read-session'
);
const { POST: mintSession } = await import('../app/api/session/route');

/** A real-shaped Sui address. Synthetic — it belongs to nobody. */
const ADDRESS = '0x4b4c42830332b3cf39813a25594c19efea260d33c8913ed37f4880344b7726db';
/** base64url, 32 bytes' worth, shaped like what `mintReadSession` actually issues. */
const TOKEN = 'x7Qv0Zr9m3JkP2sT5wB8nD1gH4yL6cE0aF9uR3iO7kM';

function requestWith(headers: Record<string, string>): Request {
  return new Request('http://localhost/api/comments?postId=p1', { headers });
}

beforeEach(() => {
  queries.length = 0;
  rows = [];
  failure = null;
});

describe('reading the token off an Authorization header', () => {
  it('accepts the scheme in any case, as RFC 7235 requires', () => {
    for (const scheme of ['Bearer', 'bearer', 'BEARER', 'BeArEr']) {
      expect(bearerFromHeader(`${scheme} ${TOKEN}`)).toBe(TOKEN);
    }
  });

  it('tolerates more than one space between the scheme and the token', () => {
    expect(bearerFromHeader(`Bearer   ${TOKEN}`)).toBe(TOKEN);
    expect(bearerFromHeader(`Bearer ${TOKEN}  `)).toBe(TOKEN);
  });

  it.each([
    ['no header at all', null],
    ['another scheme', `Basic ${TOKEN}`],
    ['a scheme that merely starts the same', `Bearertoken ${TOKEN}`],
    ['a bare token with no scheme', TOKEN],
    ['the scheme with nothing after it', 'Bearer '],
    ['the scheme alone', 'Bearer'],
    ['a credential with whitespace inside it', 'Bearer abc def'],
  ])('yields nothing for %s', (_label, header) => {
    expect(bearerFromHeader(header)).toBeNull();
  });
});

describe('the same token, presented either way', () => {
  it('resolves to the same address', async () => {
    rows = [{ address: ADDRESS }];
    const viaCookie = await provenReaderFor(
      requestWith({ cookie: `${READ_SESSION_COOKIE}=${TOKEN}` }),
    );

    rows = [{ address: ADDRESS }];
    const viaHeader = await provenReaderFor(requestWith({ authorization: `Bearer ${TOKEN}` }));

    expect(viaCookie.ok && viaCookie.value).toBe(ADDRESS);
    expect(viaHeader.ok && viaHeader.value).toBe(ADDRESS);
  });

  it('asks the database exactly the same question, with the same digest', async () => {
    /*
      The assertion that matters. Two carriers resolving to the same address could still be two
      lookups against two tables with two expiries — and then one of them is not revoked by
      `revokeReadSessions`, which is the entire reason a session is revocable at all.
    */
    rows = [{ address: ADDRESS }];
    await provenReaderFor(requestWith({ cookie: `${READ_SESSION_COOKIE}=${TOKEN}` }));
    const cookieQuery = queries[0];

    queries.length = 0;
    rows = [{ address: ADDRESS }];
    await provenReaderFor(requestWith({ authorization: `Bearer ${TOKEN}` }));
    const headerQuery = queries[0];

    expect(headerQuery?.sql).toBe(cookieQuery?.sql);
    // The digest, and only the digest. The token itself must not reach the database by either path.
    expect(headerQuery?.params[0]).toEqual(createHash('sha256').update(TOKEN).digest());
    expect(headerQuery?.params[0]).toEqual(cookieQuery?.params[0]);
    expect(JSON.stringify(headerQuery?.params)).not.toContain(TOKEN);
  });

  it('fails the same way when the database cannot be reached', async () => {
    // `fail(…)` rather than `ok(null)` on both paths: "we could not check" must never resolve to
    // anonymous, because a caller that cannot tell them apart eventually releases paid content on
    // a failed lookup.
    failure = new Error('connection refused');
    const viaCookie = await provenReaderFor(
      requestWith({ cookie: `${READ_SESSION_COOKIE}=${TOKEN}` }),
    );
    const viaHeader = await provenReaderFor(requestWith({ authorization: `Bearer ${TOKEN}` }));

    expect(viaCookie.ok).toBe(false);
    expect(viaHeader.ok).toBe(false);
    expect(!viaHeader.ok && viaHeader.failure.kind).toBe(!viaCookie.ok && viaCookie.failure.kind);
    expect(!viaHeader.ok && viaHeader.failure.source).toBe(
      !viaCookie.ok && viaCookie.failure.source,
    );
  });

  it('is anonymous, not broken, when the header names a token no live row matches', async () => {
    rows = [];
    const reading = await provenReaderFor(requestWith({ authorization: `Bearer ${TOKEN}` }));
    expect(reading.ok).toBe(true);
    expect(reading.ok && reading.value).toBeNull();
  });
});

describe('a browser is unaffected', () => {
  it('costs a request with a cookie exactly one query, as before', async () => {
    rows = [{ address: ADDRESS }];
    await provenReaderFor(requestWith({ cookie: `${READ_SESSION_COOKIE}=${TOKEN}` }));
    expect(queries).toHaveLength(1);
  });

  it('never consults the header when a cookie is present', async () => {
    /*
      The cookie is live and the header names a different token. If the header could win, or could
      be tried as a fallback, the digest below would be the header's — and a request would then be
      answered by a credential the caller did not lead with.
    */
    rows = [{ address: ADDRESS }];
    await provenReaderFor(
      requestWith({
        cookie: `${READ_SESSION_COOKIE}=${TOKEN}`,
        authorization: 'Bearer a-completely-different-token',
      }),
    );

    expect(queries).toHaveLength(1);
    expect(queries[0]?.params[0]).toEqual(createHash('sha256').update(TOKEN).digest());
  });

  it('does not fall back to the header when the cookie resolves to nobody', async () => {
    // An expired or withdrawn cookie is a complete answer. Falling through would mean two lookups
    // for one request and an answer from the credential the caller did not present first.
    rows = [];
    const reading = await provenReaderFor(
      requestWith({
        cookie: `${READ_SESSION_COOKIE}=${TOKEN}`,
        authorization: 'Bearer a-completely-different-token',
      }),
    );

    expect(queries).toHaveLength(1);
    expect(reading.ok && reading.value).toBeNull();
  });

  it('is anonymous with neither carrier, and spends no query proving it', async () => {
    const reading = await provenReaderFor(requestWith({}));
    expect(reading.ok).toBe(true);
    expect(reading.ok && reading.value).toBeNull();
    expect(queries).toHaveLength(0);
  });
});

/**
 * The credential a real mint issues, carried both ways.
 *
 * Everything above works on a token this file invented. This works on the one `POST /api/session`
 * actually produces, which is what makes the equivalence a fact about the product rather than about
 * the test: the value in the body has to be the value in the `Set-Cookie`, or a machine caller is
 * holding a credential that is not the reader's session.
 */
describe('what POST /api/session hands back', () => {
  async function mint(
    /** Whether the caller asks for the bearer in the body, as a non-browser client does. */
    wantsBearer = true,
  ): Promise<{ body: Record<string, unknown>; setCookie: string }> {
    rows = [{ address: ADDRESS }];
    const response = await mintSession(
      new Request('https://weir.social/api/session', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-proto': 'https',
          ...(wantsBearer ? { 'x-weir-bearer': '1' } : {}),
        },
        body: JSON.stringify({ address: ADDRESS, signature: 'sig', timestampMs: Date.now() }),
      }),
    );
    return {
      body: (await response.json()) as Record<string, unknown>,
      setCookie: response.headers.get('set-cookie') ?? '',
    };
  }

  it('returns the token in the body TO A CALLER THAT ASKS, and the identical token in the cookie', async () => {
    const { body, setCookie } = await mint();

    expect(typeof body['token']).toBe('string');
    expect(body['token']).not.toBe('');
    expect(body['address']).toBe(ADDRESS);
    expect(typeof body['expiresAtMs']).toBe('number');

    // The cookie path is untouched: same value, same attributes as before this existed.
    expect(setCookie).toContain(`${READ_SESSION_COOKIE}=${String(body['token'])}`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Secure');
  });

  it('withholds it from a caller that does not ask, which is every browser', async () => {
    /*
      The exposure had no beneficiary. `SessionBridge` fires this POST and never reads the response
      — the cookie does the work — while script running on this origin during the exchange could
      read a day-long bearer out of the body and use it from somewhere else. `HttpOnly` stops script
      reading the stored cookie and does nothing about a body.
    */
    const { body, setCookie } = await mint(false);

    expect(body['token']).toBeUndefined();
    // The credential itself is unchanged: the browser still gets its cookie.
    expect(setCookie).toContain(`${READ_SESSION_COOKIE}=`);
    expect(setCookie).toContain('HttpOnly');
    expect(body['address']).toBe(ADDRESS);
  });

  it('authenticates that token identically through either carrier', async () => {
    const { body } = await mint();
    const token = String(body['token']);

    queries.length = 0;
    rows = [{ address: ADDRESS }];
    const viaCookie = await provenReaderFor(requestWith({ cookie: `${READ_SESSION_COOKIE}=${token}` }));
    const cookieQuery = queries[0];

    queries.length = 0;
    rows = [{ address: ADDRESS }];
    const viaHeader = await provenReaderFor(requestWith({ authorization: `Bearer ${token}` }));
    const headerQuery = queries[0];

    expect(viaCookie.ok && viaCookie.value).toBe(ADDRESS);
    expect(viaHeader.ok && viaHeader.value).toBe(ADDRESS);
    expect(headerQuery?.sql).toBe(cookieQuery?.sql);
    expect(headerQuery?.params[0]).toEqual(cookieQuery?.params[0]);
    // And what the row is keyed by is the digest the mint stored, not the token. The second
    // parameter is `Date.now()` on both paths and is compared by shape, not by value — two calls a
    // millisecond apart must not make this flake.
    expect(headerQuery?.params[0]).toEqual(createHash('sha256').update(token).digest());
    expect(headerQuery?.params[1]).toBeTypeOf('number');
  });

  it('is never cached, because the body now carries the credential too', async () => {
    rows = [{ address: ADDRESS }];
    const response = await mintSession(
      new Request('https://weir.social/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address: ADDRESS, signature: 'sig', timestampMs: Date.now() }),
      }),
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
