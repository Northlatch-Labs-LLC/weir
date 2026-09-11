// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { fail, ok, type Reading } from '@projectx-social/sdk';
import type { AgentKey } from './keys.js';
import { signAction } from './statements.js';

export const READ_SESSION_COOKIE = 'projectx_read';

export const BEARER_FIELDS = ['token'] as const;

export interface SessionCredential {
  readonly kind: 'bearer' | 'cookie';
  readonly address: string;
  readonly expiresAtMs: number | null;
  headers: () => Record<string, string>;
  isExpired: (nowMs?: number) => boolean;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function openSession(input: {
  key: AgentKey;
  baseUrl: string;
  fetchImpl?: FetchLike;
}): Promise<Reading<SessionCredential>> {
  const source = 'read session';
  const doFetch = input.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
  if (doFetch === undefined) {
    return fail('unconfigured', source, 'no fetch implementation is available in this runtime.');
  }

  const signed = await signAction(input.key.keypair, { kind: 'read-content' }, input.baseUrl);

  let response: Response;
  try {
    response = await doFetch(`${input.baseUrl}/api/session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-weir-bearer': '1',
      },
      body: JSON.stringify({
        address: signed.address,
        signature: signed.signature,
        timestampMs: signed.timestampMs,
      }),
    });
  } catch (error) {
    return fail(
      'transport',
      source,
      `could not reach ${input.baseUrl}/api/session: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const body = await readJson(response);

  if (!response.ok) {
    const detail =
      typeof body?.['error'] === 'string' ? body['error'] : `HTTP ${response.status}`;
    return fail(response.status === 401 ? 'malformed' : 'transport', source, detail);
  }

  const address = typeof body?.['address'] === 'string' ? body['address'] : signed.address;
  const expiresAtMs =
    typeof body?.['expiresAtMs'] === 'number' && Number.isFinite(body['expiresAtMs'])
      ? body['expiresAtMs']
      : null;

  const bearer = bearerFrom(body);
  if (bearer !== null) {
    return ok(credential('bearer', { Authorization: `Bearer ${bearer}` }, address, expiresAtMs));
  }

  const cookie = readSessionCookieFrom(response.headers);
  if (cookie !== null) {
    return ok(
      credential('cookie', { cookie: `${READ_SESSION_COOKIE}=${cookie}` }, address, expiresAtMs),
    );
  }

  return fail(
    'malformed',
    source,
    `the session endpoint returned 200 but carried neither a ${READ_SESSION_COOKIE} cookie nor a ` +
      `bearer token in any of the fields this client recognises (${BEARER_FIELDS.join(', ')}). ` +
      `No session was created — continuing would read as an anonymous caller while believing it ` +
      `was authenticated.`,
  );
}

function credential(
  kind: 'bearer' | 'cookie',
  headers: Record<string, string>,
  address: string,
  expiresAtMs: number | null,
): SessionCredential {
  return {
    kind,
    address,
    expiresAtMs,
    headers: () => ({ ...headers }),
    isExpired: (nowMs: number = Date.now()) => expiresAtMs !== null && nowMs >= expiresAtMs,
  };
}

export function readSessionCookieFrom(headers: Headers): string | null {
  const all: string[] =
    typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : ((h) => (h === null ? [] : [h]))(headers.get('set-cookie'));

  for (const line of all) {
    const pair = line.split(';', 1)[0] ?? '';
    const separator = pair.indexOf('=');
    if (separator === -1) continue;
    if (pair.slice(0, separator).trim() !== READ_SESSION_COOKIE) continue;
    const value = pair.slice(separator + 1).trim();
    if (value !== '') return value;
  }
  return null;
}

function bearerFrom(body: Record<string, unknown> | null): string | null {
  if (body === null) return null;
  for (const field of BEARER_FIELDS) {
    const value = body[field];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await response.json();
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
