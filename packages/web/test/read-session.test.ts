// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * The read session: what it proves, what it stores, and how it fails.
 *
 * `test/read-authentication.test.ts` pins the *rule* — no call site may resolve entitlements for an
 * address it did not prove. This file pins the primitive that rule now depends on.
 *
 * Three properties matter more than the rest, and each has a test whose failure would be a real
 * vulnerability rather than a cosmetic regression:
 *
 *   1. The token never reaches the database. A row holds `sha256(token)`, so a dump of
 *      `read_sessions` lets nobody impersonate anybody.
 *   2. Expiry is enforced in the query, not by the sweep. The sweep is an optimisation; an unswept
 *      row must never grant anything.
 *   3. Every failure resolves to anonymous. A session that cannot be read locks paid content — it
 *      must never throw past the caller, and must never resolve to an address.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

/** Every call the module made, in order, so a test can assert on the SQL *and* its parameters. */
const queries: Array<{ sql: string; params: unknown[] }> = [];
/** What the next `SELECT` resolves to. Set per test. */
let rows: Array<{ address: string }> = [];
/** When set, the pool throws — standing in for a database that cannot be reached. */
let failure: Error | null = null;

vi.mock('../lib/db', () => ({
  db: () => ({
    query: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      if (failure !== null) throw failure;
      return { rows, rowCount: rows.length };
    },
  }),
  // The real one lower-cases and 0x-prefixes. Kept faithful because the address a session is
  // stored under has to match the one every other table compares against.
  normaliseAddress: (address: string) => address.toLowerCase(),
}));

const {
  READ_SESSION_COOKIE,
  READ_SESSION_TTL_MS,
  clearedReadSessionCookie,
  cookieFromHeader,
  mintReadSession,
  provenReaderFor,
  readSessionCookie,
  readerFromToken,
} = await import('../lib/read-session');

/** A real-shaped Sui address. Synthetic — it belongs to nobody. */
const ADDRESS = '0x4b4c42830332b3cf39813a25594c19efea260d33c8913ed37f4880344b7726db';

beforeEach(() => {
  queries.length = 0;
  rows = [];
  failure = null;
});

describe('reading the cookie off a request', () => {
  it('finds the session among other cookies', () => {
    expect(cookieFromHeader(`a=1; ${READ_SESSION_COOKIE}=tok3n; b=2`, READ_SESSION_COOKIE)).toBe(
      'tok3n',
    );
  });

  it('is not fooled by a name that merely starts the same', () => {
    /*
      `projectx_read` is a prefix of `projectx_reader`. A parser matching on `startsWith` would read
      the wrong cookie — and an attacker who can set any cookie on this origin chooses the name.
    */
    expect(cookieFromHeader('projectx_reader=wrong', READ_SESSION_COOKIE)).toBeNull();
  });

  it('keeps a value containing an equals sign intact', () => {
    // base64url has no `=`, but padded base64 does, and a future value might. Splitting on every
    // `=` rather than the first would silently truncate the token.
    expect(cookieFromHeader(`${READ_SESSION_COOKIE}=ab=cd==`, READ_SESSION_COOKIE)).toBe('ab=cd==');
  });

  it.each([
    ['no header at all', null],
    ['a header without this cookie', 'other=1'],
    ['the cookie present but empty', `${READ_SESSION_COOKIE}=`],
    ['a malformed fragment', 'novalue'],
  ])('yields nothing for %s', (_label, header) => {
    expect(cookieFromHeader(header, READ_SESSION_COOKIE)).toBeNull();
  });
});

describe('resolving a token to an address', () => {
  it('never sends the token to the database', async () => {
    rows = [{ address: ADDRESS }];
    await readerFromToken('the-secret-token');

    const [first] = queries;
    expect(first?.sql).toContain('FROM read_sessions');
    // The digest, not the token. A dump of this table must not be usable as a set of credentials.
    expect(first?.params[0]).toEqual(createHash('sha256').update('the-secret-token').digest());
    expect(JSON.stringify(first?.params)).not.toContain('the-secret-token');
  });

  it('makes the database enforce expiry rather than trusting the sweep', async () => {
    rows = [{ address: ADDRESS }];
    await readerFromToken('t');

    const [first] = queries;
    expect(first?.sql).toContain('expires_at_ms >');
    // Compared against now, so a row the bounded sweep has not yet reached still grants nothing.
    expect(first?.params[1]).toBeTypeOf('number');
    expect(Math.abs((first?.params[1] as number) - Date.now())).toBeLessThan(5_000);
  });

  it('returns the address when the session is live', async () => {
    rows = [{ address: ADDRESS }];
    const reading = await readerFromToken('t');
    expect(reading.ok).toBe(true);
    expect(reading.ok && reading.value).toBe(ADDRESS);
  });

  it.each([
    ['there is no token', null],
    ['the token is unknown or expired', 'nonexistent'],
  ])('answers anonymous — completely and certainly — when %s', async (_label, token) => {
    const reading = await readerFromToken(token);
    // `ok`, not a failure: we looked (or knew without looking) and the answer is nobody. A caller
    // may show a paywall on this, and on nothing else.
    expect(reading.ok).toBe(true);
    expect(reading.ok && reading.value).toBeNull();
  });

  it('asks the database nothing when there is no token', async () => {
    await readerFromToken(null);
    // Not merely correct — an unauthenticated request must not cost a query, or the read budget
    // becomes something an anonymous caller can exhaust for everybody.
    expect(queries).toHaveLength(0);
  });

  it('reports a failed lookup as a failure, never as anonymity', async () => {
    /*
      The distinction this type exists for, and the defect this test was written after.

      Collapsing these to `null` makes an outage indistinguishable from "you did not buy this" —
      and the caller, having no way to tell, shows a paywall to somebody who already paid. This
      application has made that exact mistake once before, with `truncated`.

      It still fails closed: `fold(reading, v => v, () => null)` at every call site grants nothing.
      What the failure buys is the caller's ability to answer 503 rather than 403.
    */
    failure = new Error('connection terminated');
    const reading = await readerFromToken('t');

    expect(reading.ok).toBe(false);
    expect(!reading.ok && reading.failure.kind).toBe('transport');
    /*
      The detail must NOT carry the driver's message.

      This assertion used to require that it did — `toContain('connection terminated')` — which made
      a leak into a guarantee: `pg` exceptions name tables, columns, constraints, hosts and ports,
      and twenty-four routes return `failure.detail` verbatim to anonymous callers. The property
      this test exists for is the KIND, which is what lets a caller answer 503 rather than 403; the
      driver's text was never part of that and is now in the log instead.
    */
    expect(!reading.ok && reading.failure.detail).not.toContain('connection terminated');
    expect(!reading.ok && reading.failure.detail).toContain('logs');
  });

  it('does not throw when the database cannot be reached', async () => {
    // A throw here would 500 the whole page rather than locking one post, and any caller that
    // caught it would be deciding entitlement inside a catch block.
    failure = new Error('connection terminated');
    await expect(readerFromToken('t')).resolves.toBeDefined();
  });
});

describe('minting a session', () => {
  it('stores the digest and the address, never the token', async () => {
    const { token } = await mintReadSession(ADDRESS.toUpperCase());

    const insert = queries.find((q) => q.sql.includes('INSERT INTO read_sessions'));
    expect(insert).toBeDefined();
    expect(insert?.params[0]).toEqual(createHash('sha256').update(token).digest());
    // Normalised, so it compares against the address every other table stores.
    expect(insert?.params[1]).toBe(ADDRESS.toLowerCase());
    expect(JSON.stringify(insert?.params)).not.toContain(token);
  });

  it('expires the session a day out', async () => {
    const { expiresAtMs } = await mintReadSession(ADDRESS);
    expect(expiresAtMs - Date.now()).toBeGreaterThan(READ_SESSION_TTL_MS - 5_000);
    expect(expiresAtMs - Date.now()).toBeLessThanOrEqual(READ_SESSION_TTL_MS);
  });

  it('issues an unguessable token', async () => {
    const first = await mintReadSession(ADDRESS);
    const second = await mintReadSession(ADDRESS);

    expect(first.token).not.toBe(second.token);
    // 32 bytes as base64url. Shorter would mean the token was not what this claims to be.
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('sweeps expired rows within a bound', async () => {
    await mintReadSession(ADDRESS);
    const sweep = queries.find((q) => q.sql.includes('DELETE FROM read_sessions'));
    // Bounded, so one unlucky request does not pay for every expired row ever written.
    expect(sweep?.sql).toContain('LIMIT 500');
  });
});

describe('the proven reader behind a request', () => {
  it('is the address the cookie resolves to', async () => {
    rows = [{ address: ADDRESS }];
    const request = new Request('https://example.test/api/media/p/a', {
      headers: { cookie: `${READ_SESSION_COOKIE}=live-token` },
    });
    const reading = await provenReaderFor(request);
    expect(reading.ok && reading.value).toBe(ADDRESS);
  });

  it('ignores an address named in the query string', async () => {
    /*
      The whole defect, stated as a test. `?reader=` may still travel with a request — every link in
      the frame carries it — and it must never again decide who anybody is.

      `ok(null)` rather than a failure, deliberately: a request with no cookie is not a broken
      request, it is an anonymous one, and answering it with 503 would make every logged-out visitor
      look like an outage.
    */
    const request = new Request(`https://example.test/api/media/p/a?reader=${ADDRESS}`);
    const reading = await provenReaderFor(request);
    expect(reading.ok).toBe(true);
    expect(reading.ok && reading.value).toBeNull();
    expect(queries).toHaveLength(0);
  });
});

describe('the cookie that carries it', () => {
  const token = 'abc';
  const expiresAtMs = Date.now() + READ_SESSION_TTL_MS;

  it('is unreadable by script and not sent cross-site', () => {
    const cookie = readSessionCookie({ token, expiresAtMs, secure: true });
    // HttpOnly is what keeps an XSS from lifting it; Lax is what stops another origin spending it.
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain(`${READ_SESSION_COOKIE}=${token}`);
  });

  it('is marked Secure over https', () => {
    expect(readSessionCookie({ token, expiresAtMs, secure: true })).toContain('Secure');
  });

  it('omits Secure over plain http, so a development server can hold it', () => {
    /*
      Not a weakening. A `Secure` cookie is discarded by the browser on http, which on a local
      machine is indistinguishable from the sign-in having failed — an hour lost to a working
      system. Production is behind TLS and reports it in `x-forwarded-proto`.
    */
    expect(readSessionCookie({ token, expiresAtMs, secure: false })).not.toContain('Secure');
  });

  it('expires with the session it carries', () => {
    const cookie = readSessionCookie({ token, expiresAtMs, secure: true });
    const maxAge = Number(/Max-Age=(\d+)/.exec(cookie)?.[1]);
    expect(maxAge).toBeGreaterThan(READ_SESSION_TTL_MS / 1000 - 5);
  });

  it('clears with a matching cookie, or the browser keeps the old one', () => {
    const cleared = clearedReadSessionCookie(true);
    expect(cleared).toContain('Max-Age=0');
    // Attributes must match the cookie being replaced — a browser drops nothing on a mismatch.
    expect(cleared).toContain('Path=/');
    expect(cleared).toContain('SameSite=Lax');
  });
});
