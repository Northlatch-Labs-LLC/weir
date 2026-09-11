// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

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
    expect(cookieFromHeader('projectx_reader=wrong', READ_SESSION_COOKIE)).toBeNull();
  });

  it('keeps a value containing an equals sign intact', () => {
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
    expect(first?.params[0]).toEqual(createHash('sha256').update('the-secret-token').digest());
    expect(JSON.stringify(first?.params)).not.toContain('the-secret-token');
  });

  it('makes the database enforce expiry rather than trusting the sweep', async () => {
    rows = [{ address: ADDRESS }];
    await readerFromToken('t');

    const [first] = queries;
    expect(first?.sql).toContain('expires_at_ms >');
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
    expect(reading.ok).toBe(true);
    expect(reading.ok && reading.value).toBeNull();
  });

  it('asks the database nothing when there is no token', async () => {
    await readerFromToken(null);
    expect(queries).toHaveLength(0);
  });

  it('reports a failed lookup as a failure, never as anonymity', async () => {
    failure = new Error('connection terminated');
    const reading = await readerFromToken('t');

    expect(reading.ok).toBe(false);
    expect(!reading.ok && reading.failure.kind).toBe('transport');
    expect(!reading.ok && reading.failure.detail).not.toContain('connection terminated');
    expect(!reading.ok && reading.failure.detail).toContain('logs');
  });

  it('does not throw when the database cannot be reached', async () => {
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
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('sweeps expired rows within a bound', async () => {
    await mintReadSession(ADDRESS);
    const sweep = queries.find((q) => q.sql.includes('DELETE FROM read_sessions'));
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
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain(`${READ_SESSION_COOKIE}=${token}`);
  });

  it('is marked Secure over https', () => {
    expect(readSessionCookie({ token, expiresAtMs, secure: true })).toContain('Secure');
  });

  it('omits Secure over plain http, so a development server can hold it', () => {
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
    expect(cleared).toContain('Path=/');
    expect(cleared).toContain('SameSite=Lax');
  });
});
