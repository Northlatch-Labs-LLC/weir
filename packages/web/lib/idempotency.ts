import { opaqueDetail } from './opaque';
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { createHash } from 'node:crypto';

import { db, normaliseAddress } from './db';

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

export interface IdempotencyHold {
  kind: 'claimed';
  key: string;
  address: string;
}

export type IdempotencyClaim =
  | IdempotencyHold
  /** The same caller made the same request already. Here is what they were told. */
  | { kind: 'replay'; status: number; body: unknown }
  /** The same key is held by a request OF THIS CALLER'S that has not finished. */
  | { kind: 'in-flight' }
  /** This caller's own key is held by a different request — different body, or different route. */
  | { kind: 'mismatch'; reason: string }
  /** The key or the address is not usable. */
  | { kind: 'malformed'; reason: string }
  /** The store could not be reached, so nothing can be promised. */
  | { kind: 'unavailable'; reason: string };

export function requestDigest(body: string): Buffer {
  return createHash('sha256').update(body, 'utf8').digest();
}

function keyProblem(key: string): string | null {
  if (key.trim() === '') return 'an Idempotency-Key must not be empty';
  if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    return `an Idempotency-Key must be at most ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`;
  }
  if (/[\u0000-\u001f\u007f]/.test(key)) {
    return 'an Idempotency-Key must not contain control characters';
  }
  return null;
}

export async function claimIdempotencyKey(input: {
  key: string | null;
  address: string;
  route: string;
  body: string;
  now?: number;
}): Promise<IdempotencyClaim> {
  if (input.key === null) {
    return { kind: 'malformed', reason: 'this route requires an Idempotency-Key header' };
  }
  const problem = keyProblem(input.key);
  if (problem !== null) return { kind: 'malformed', reason: problem };

  let address: string;
  try {
    address = normaliseAddress(input.address);
  } catch {
    return { kind: 'malformed', reason: 'that is not an address' };
  }

  const digest = requestDigest(input.body);
  const nowMs = input.now ?? Date.now();

  try {
    const claimed = await db().query(
      `INSERT INTO agent_requests (key, address, route, request_sha256, created_at_ms, expires_at_ms)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (address, key) DO NOTHING`,
      [input.key, address, input.route, digest, nowMs, nowMs + IDEMPOTENCY_TTL_MS],
    );

    if (claimed.rowCount === 1) {
      await sweep(nowMs);
      return { kind: 'claimed', key: input.key, address };
    }

    const held = await db().query<{
      address: string;
      route: string;
      request_sha256: Buffer;
      response_body: unknown;
      status: number | null;
    }>(
      `SELECT address, route, request_sha256, response_body, status
         FROM agent_requests WHERE address = $1 AND key = $2`,
      [address, input.key],
    );

    const row = held.rows[0];
    if (row === undefined) {
      return { kind: 'claimed', key: input.key, address };
    }

    if (row.address !== address) {
      return { kind: 'mismatch', reason: 'this Idempotency-Key is already in use' };
    }
    if (row.route !== input.route) {
      return { kind: 'mismatch', reason: 'this Idempotency-Key was used for a different route' };
    }
    if (!sameBytes(row.request_sha256, digest)) {
      return {
        kind: 'mismatch',
        reason:
          'this Idempotency-Key was used for a different request body. Reusing a key for a second ' +
          'operation has no safe answer: replaying the first response reports success for ' +
          'something that was never done, and running the second discards the key entirely.',
      };
    }

    if (row.status === null) return { kind: 'in-flight' };
    return { kind: 'replay', status: row.status, body: row.response_body };
  } catch (error) {
    return {
      kind: 'unavailable',
      reason: opaqueDetail('the idempotency ledger', error),
    };
  }
}

function sameBytes(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  let differing = 0;
  for (let i = 0; i < a.length; i += 1) differing |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return differing === 0;
}

export async function completeIdempotentRequest(
  hold: IdempotencyHold,
  status: number,
  body: unknown,
): Promise<void> {
  await db().query(
    `UPDATE agent_requests
        SET response_body = $3::jsonb, status = $4
      WHERE address = $1 AND key = $2 AND status IS NULL`,
    [hold.address, hold.key, JSON.stringify(body ?? null), status],
  );
}

export async function releaseIdempotencyClaim(hold: IdempotencyHold): Promise<void> {
  await db().query(
    'DELETE FROM agent_requests WHERE address = $1 AND key = $2 AND status IS NULL',
    [hold.address, hold.key],
  );
}

export function idempotencyResponse(claim: IdempotencyClaim): Response | null {
  switch (claim.kind) {
    case 'claimed':
      return null;

    case 'replay':
      return Response.json(claim.body, {
        status: claim.status,
        headers: { 'idempotency-replayed': 'true' },
      });

    case 'in-flight':
      return Response.json(
        {
          error:
            'a request with this Idempotency-Key is still running. Its result is not known yet, ' +
            'so this one is not being executed alongside it.',
          retryAfterSeconds: 2,
        },
        { status: 409, headers: { 'retry-after': '2' } },
      );

    case 'mismatch':
      return Response.json({ error: claim.reason }, { status: 409 });

    case 'malformed':
      return Response.json({ error: claim.reason }, { status: 400 });

    case 'unavailable':
      return Response.json(
        {
          error:
            'this request could not be recorded as idempotent, so it was not accepted. Running it ' +
            'without that record would risk doing it twice.',
          retryAfterSeconds: 5,
        },
        { status: 503, headers: { 'retry-after': '5' } },
      );
  }
}

async function sweep(nowMs: number): Promise<void> {
  try {
    await db().query(
      `DELETE FROM agent_requests
        WHERE (address, key) IN (
                SELECT address, key FROM agent_requests WHERE expires_at_ms < $1 LIMIT 500
              )`,
      [nowMs],
    );
  } catch {
    // Storage, not correctness. A failed tidy-up must never turn a claimed key into a refused one.
  }
}
