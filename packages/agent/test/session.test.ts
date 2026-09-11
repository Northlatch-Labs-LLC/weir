// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { describe, expect, it } from 'vitest';

import { generateAgentKey, openSession, readSessionCookieFrom } from '../src/index.js';

const { key } = generateAgentKey();
const BASE = 'https://example.test';
const COOKIE = 'projectx_read=COOKIEVAL; Path=/; HttpOnly; SameSite=Lax';

function respond(body: object, cookie?: string): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      ...(cookie === undefined ? {} : { 'set-cookie': cookie }),
    },
  });
}

const open = (make: () => Response) =>
  openSession({ key, baseUrl: BASE, fetchImpl: async () => make() });

describe('which credential is taken', () => {
  it('prefers the bearer when the server offers both', async () => {
    const reading = await open(() =>
      respond({ address: key.address, expiresAtMs: Date.now() + 86_400_000, token: 'TOK123' }, COOKIE),
    );
    expect(reading.ok && reading.value.kind).toBe('bearer');
  });

  it('emits exactly one space after `Bearer` and no whitespace in the credential', async () => {
    const reading = await open(() => respond({ address: key.address, token: 'TOK123' }));
    expect(reading.ok).toBe(true);
    if (reading.ok) {
      const auth = reading.value.headers()['Authorization'];
      expect(auth).toBe('Bearer TOK123');
      expect(/\s/.test((auth ?? '').slice('Bearer '.length))).toBe(false);
    }
  });

  it('falls back to the cookie when the body carries no token', async () => {
    const reading = await open(() => respond({ address: key.address }, COOKIE));
    expect(reading.ok && reading.value.kind).toBe('cookie');
    if (reading.ok) expect(reading.value.headers()['cookie']).toBe('projectx_read=COOKIEVAL');
  });

  it('REFUSES to invent a session when neither is present', async () => {
    const reading = await open(() => respond({ address: key.address }));
    expect(reading.ok).toBe(false);
    if (!reading.ok) expect(reading.failure.detail).toContain('No session was created');
  });
});

describe('reading the cookie off a response', () => {
  it('a cleared cookie reads as absent, not as an empty session', () => {
    expect(
      readSessionCookieFrom(new Headers({ 'set-cookie': 'projectx_read=; Path=/; Max-Age=0' })),
    ).toBeNull();
  });

  it('a lookalike name is not accepted', () => {
    expect(
      readSessionCookieFrom(new Headers({ 'set-cookie': 'projectx_reader=X; Path=/' })),
    ).toBeNull();
  });

  it('attributes after the first `;` are not part of the value', () => {
    expect(readSessionCookieFrom(new Headers({ 'set-cookie': COOKIE }))).toBe('COOKIEVAL');
  });
});

describe('what a failure says', () => {
  it('passes a 401 message through unmodified', async () => {
    const reading = await openSession({
      key,
      baseUrl: BASE,
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: 'this signature has expired — sign again' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
    });
    expect(reading.ok).toBe(false);
    if (!reading.ok) expect(reading.failure.detail).toBe('this signature has expired — sign again');
  });

  it('an unreachable origin is `transport`, and it is the retryable one', async () => {
    const reading = await openSession({
      key,
      baseUrl: BASE,
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    expect(reading.ok).toBe(false);
    if (!reading.ok) expect(reading.failure.kind).toBe('transport');
  });
});

describe('the credential cannot be mutated by the caller who holds it', () => {
  it('headers() hands back a fresh object each time', async () => {
    const reading = await open(() => respond({ address: key.address, token: 'TOK123' }));
    expect(reading.ok).toBe(true);
    if (reading.ok) {
      const first = reading.value.headers();
      first['Authorization'] = 'Bearer TAMPERED';
      expect(reading.value.headers()['Authorization']).toBe('Bearer TOK123');
    }
  });

  it('expiry is honoured, and a null expiry is not treated as for ever', async () => {
    const expired = await open(() =>
      respond({ address: key.address, expiresAtMs: Date.now() - 1, token: 'T' }),
    );
    expect(expired.ok && expired.value.isExpired()).toBe(true);

    const unknown = await open(() => respond({ address: key.address, token: 'T' }));
    expect(unknown.ok && unknown.value.expiresAtMs).toBeNull();
    expect(unknown.ok && unknown.value.isExpired()).toBe(false);
  });
});
