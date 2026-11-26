// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';
import { opaqueDetail } from './opaque';

import { cache } from 'react';
import { createHash, randomBytes } from 'node:crypto';
import { fail, ok, type Reading } from '@projectx-social/sdk';
import { db, normaliseAddress } from './db';

export const READ_SESSION_COOKIE = 'projectx_read';

export const READ_SESSION_TTL_MS = 2 * 60 * 60 * 1000;

function digestOf(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

export function cookieFromHeader(header: string | null, name: string): string | null {
  if (header === null) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return value === '' ? null : value;
  }
  return null;
}

export const READ_SESSION_SCHEME = 'Bearer';

export function bearerFromHeader(header: string | null): string | null {
  if (header === null) return null;

  const separator = header.indexOf(' ');
  if (separator === -1) return null;
  if (header.slice(0, separator).toLowerCase() !== READ_SESSION_SCHEME.toLowerCase()) return null;

  const token = header.slice(separator + 1).trim();
  if (token === '' || /\s/.test(token)) return null;
  return token;
}

export async function mintReadSession(
  address: string,
): Promise<{ token: string; expiresAtMs: number }> {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  const expiresAtMs = now + READ_SESSION_TTL_MS;

  await db().query(
    `INSERT INTO read_sessions (digest, address, expires_at_ms, created_at_ms)
     VALUES ($1, $2, $3, $4)`,
    [digestOf(token), normaliseAddress(address), expiresAtMs, now],
  );

  await db().query(
    `DELETE FROM read_sessions
     WHERE digest IN (SELECT digest FROM read_sessions WHERE expires_at_ms <= $1 LIMIT 500)`,
    [now],
  );

  return { token, expiresAtMs };
}

export async function readerFromToken(token: string | null): Promise<Reading<string | null>> {
  if (token === null) return ok(null);

  const source = 'read session';
  try {
    const { rows } = await db().query<{ address: string }>(
      'SELECT address FROM read_sessions WHERE digest = $1 AND expires_at_ms > $2',
      [digestOf(token), Date.now()],
    );
    return ok(rows[0]?.address ?? null);
  } catch (error) {
    return fail(
      'transport',
      source,
      `this session could not be read, so the reader could not be identified: ${
        opaqueDetail(source, error)
      }`,
    );
  }
}

export async function provenReaderFor(request: Request): Promise<Reading<string | null>> {
  const cookie = cookieFromHeader(request.headers.get('cookie'), READ_SESSION_COOKIE);
  if (cookie !== null) return readerFromToken(cookie);
  return readerFromToken(bearerFromHeader(request.headers.get('authorization')));
}

/*
  For a request that changes something on the strength of the session cookie: the refusal to
  return when the request was made from another origin, or null when it may go on.

  Why. The cookie is SameSite=Lax, which stops a request from another SITE and says nothing about
  another ORIGIN on this one — and weir.social has several, each a different application: the
  portal, the API, the MCP host. Until 2026-11-25 a page on any of them could POST to the routes
  that change the site — close it, mint an access code, end a session — with the administrator's
  cookie attached, and without a preflight: a "simple" content-type is enough, because a route
  reads its body without asking what type it claimed to be. The response is not readable across
  origins, but a change does not need to be read to be made.

  A browser states where a request came from and cannot be made to lie about it: Sec-Fetch-Site on
  every request it makes, and Origin on every write. Anything else — same-site, cross-site, an
  opaque `null` — is refused. Two callers are left alone, because neither can be a page somewhere
  else borrowing a cookie:

    - one that presents neither header. It is not a browser making a cross-origin request; it is a
      program holding the token itself, and has as much right to use it as it ever had.
    - one that presents its session as a Bearer token rather than a cookie. No other page can put
      that header on a request without this origin's say-so.

  The Origin is compared with the origin the request itself names, the same one every signed
  statement is bound to, so this holds wherever the site is deployed.
*/
export function crossOriginRefusal(request: Request): Response | null {
  if (cookieFromHeader(request.headers.get('cookie'), READ_SESSION_COOKIE) === null) return null;

  const site = request.headers.get('sec-fetch-site');
  const origin = request.headers.get('origin');
  const fromElsewhere =
    site !== null
      ? site !== 'same-origin' && site !== 'none'
      : origin !== null && origin !== new URL(request.url).origin;

  if (!fromElsewhere) return null;
  return Response.json({ error: 'a change to the site has to be asked for from the site' }, { status: 403 });
}

export const provenReader = cache(async (): Promise<Reading<string | null>> => {
  const { cookies } = await import('next/headers');
  const store = await cookies();
  return readerFromToken(store.get(READ_SESSION_COOKIE)?.value ?? null);
});

export async function revokeReadSessions(address: string): Promise<void> {
  await db().query('DELETE FROM read_sessions WHERE address = $1', [normaliseAddress(address)]);
}

export function readSessionCookie(input: {
  token: string;
  expiresAtMs: number;
  secure: boolean;
}): string {
  const maxAgeSeconds = Math.max(0, Math.floor((input.expiresAtMs - Date.now()) / 1000));
  return [
    `${READ_SESSION_COOKIE}=${input.token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
    ...(input.secure ? ['Secure'] : []),
  ].join('; ');
}

export function clearedReadSessionCookie(secure: boolean): string {
  return [
    `${READ_SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}
