import { opaqueDetail } from './opaque';
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * A machine may retry a write without doing it twice.
 *
 * # The ambiguity this closes
 *
 * `lib/identity.ts` spends a write signature exactly once, claiming its digest with
 * `INSERT ... ON CONFLICT DO NOTHING`, and refuses the second presentation. Against a replay
 * attacker that is correct and it stays.
 *
 * It also means a caller whose request timed out cannot safely retry. Re-sending the same bytes is
 * refused as a replay; re-signing produces a new digest, so the write happens a second time. And
 * the two worlds — first attempt committed, first attempt did not — return the identical refusal,
 * so the error cannot be used to tell them apart either.
 *
 * A person resolves this with their eyes: they reload, see whether the post is there, and act. A
 * machine has nothing to look at. **Today that ambiguity is unresolvable from the client, and it is
 * the defect this module closes.**
 *
 * The fix does not touch the signature. It adds a second identity for the *operation* — a key the
 * client chooses and, crucially, **reuses** across its own retries, which is exactly the thing a
 * signature must never be.
 *
 * # A key is identified by `(address, key)`, never by `key` alone
 *
 * This is the invariant every statement below is written to preserve, so it is stated once, here.
 *
 * The row is `PRIMARY KEY (address, key)` — see `db/024_agent_requests.sql`, whose header records
 * that the reasoning which once made `key` alone the primary key was inverted. With `key` alone the
 * namespace is GLOBAL and SHARED: address A claiming key `X` is precisely what makes `X`
 * unavailable to address B, so B receives `409` on its own legitimate retries. That is a denial of
 * service against the one mechanism whose entire job is to make retries safe, and it is reachable
 * by anybody who can send a request. The stated mitigation — "clients must choose random keys" — is
 * a client-side convention protecting a server-side invariant, which is the shape of a hole rather
 * than a fix: an adversary who observes one key, or a client with a weak generator, walks through
 * it.
 *
 * Consequently **every statement in this file names both columns.** A query keyed on `key` alone is
 * not a smaller version of the same thing. Against a composite primary key it either finds a row
 * belonging to somebody else or finds nothing at all, and each has its own way of going wrong:
 *
 *   * `SELECT ... WHERE key = $1` reads a stranger's row, and hands back their response body.
 *   * `UPDATE ... WHERE key = $1` writes this caller's answer onto a stranger's claim.
 *   * `DELETE ... WHERE key = $1` — the sweep — evicts live claims belonging to other addresses,
 *     because one expired row happened to share a key string with them.
 *
 * # Why the claim carries the address rather than the route re-deriving it
 *
 * `completeIdempotentRequest` and `releaseIdempotencyClaim` take the {@link IdempotencyHold} the
 * claim step returned, not a loose address string. The address on that object is the **normalised**
 * one — the exact bytes `claimIdempotencyKey` wrote — because the row is matched by equality on it.
 *
 * Were a route to pass the address as it arrived on the wire, `normaliseAddress` having lower-cased
 * and zero-padded it at claim time, the `UPDATE` would match zero rows, silently. The row would
 * keep `status IS NULL` for its whole twenty-four-hour life, so every retry of a request that had
 * in fact succeeded would be answered `409 in-flight` — indefinitely, from the client's point of
 * view. That failure writes nothing to any log and is indistinguishable from a request that never
 * finished. Handing the claim back is what makes it unrepresentable.
 *
 * # The shape a route uses
 *
 * ```ts
 * const raw = await request.text();
 * const claim = await claimIdempotencyKey({
 *   key: request.headers.get('idempotency-key'),
 *   address, route: '/api/posts', body: raw,
 * });
 * const answered = idempotencyResponse(claim);
 * if (answered !== null) return answered;
 * // `claim.kind` is 'claimed' here — `idempotencyResponse` returns null for nothing else.
 * // ... do the work, exactly once ...
 * await completeIdempotentRequest(claim, 201, payload);
 * ```
 *
 * The claim is taken **before** the work, never after. Claiming afterwards would leave the window
 * the whole exercise exists to close: two of the client's retries would both find no row, both run,
 * and both write.
 *
 * # Hash the bytes, not the object
 *
 * `body` must be the raw text the route read off the wire. Hashing a parsed-and-reserialised object
 * would compare `JSON.stringify` output, whose key order is the insertion order of whatever built
 * it — so a byte-identical retry from a client that rebuilt its payload would hash differently and
 * be refused as a different request. The bytes are what the client resent; the bytes are what is
 * compared.
 */

import { createHash } from 'node:crypto';

import { db, normaliseAddress } from './db';

/**
 * How long a key is remembered.
 *
 * Longer than `SIGNATURE_WINDOW_MS` by two orders of magnitude, on purpose. A machine's backoff is
 * measured in minutes, and a ten-minute memory would expire underneath a retry that is still
 * legitimately in progress — which returns the caller to the ambiguity this exists to remove, at
 * the one moment it is hardest to notice. Twenty-four hours is what public payment APIs settle on
 * for the same reason.
 */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** Bounds on the key itself. Not a security property — see {@link claimIdempotencyKey}. */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

/**
 * A claim held by the caller who won the insert, and the handle the completion is made with.
 *
 * `address` is the NORMALISED address. It lives on this object rather than being left to the route
 * because it is half of the row's identity — see the module header on what a re-derived address
 * costs: an `UPDATE` matching nothing, and a successful request answered `in-flight` for a day.
 */
export interface IdempotencyHold {
  kind: 'claimed';
  key: string;
  address: string;
}

export type IdempotencyClaim =
  /** Nobody holds this key IN THIS ADDRESS'S NAMESPACE. The caller owns it and must do the work
   *  exactly once. */
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

/** SHA-256 of the raw request body, as it arrived. */
export function requestDigest(body: string): Buffer {
  return createHash('sha256').update(body, 'utf8').digest();
}

/**
 * Is this a key we are willing to store?
 *
 * Length and printability only. There is no entropy test here and there cannot be one — a key is
 * opaque to us — so the guard is about not storing control characters and not letting one caller
 * fill the table with a megabyte key, not about guessing. Since the namespace is per address there
 * is nothing to guess AT: a key names a row only in the namespace of the address that presents it,
 * so a guessed string reaches the guesser's own row and no other.
 */
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

/**
 * Claim the key, or say what already holds it.
 *
 * # Why the claim is an insert and not a lookup
 *
 * `ON CONFLICT DO NOTHING`, exactly as `verifyAction` claims a signature digest. Two of the
 * client's own retries race for one insert and Postgres decides; `rowCount` is 1 for exactly one of
 * them. Reading "does this key exist" and then inserting would leave a window between the two
 * statements in which both retries see nothing and both proceed — which is not a smaller version of
 * the problem, it is the same double-execution rewritten as a race, arriving under concurrency,
 * which is the condition the machine caller is defined by.
 *
 * The conflict target is `(address, key)` and it has to be. It is the table's primary key, so any
 * other target is either a different unique index or an error — naming `(key)` against this table
 * now fails at runtime, which is the good case. The bad case is the one the composite target
 * prevents: with the arbiter narrowed to `key`, address B's insert conflicts with address A's
 * unrelated row and B is refused a key it has never used.
 *
 * The read below happens only **after** losing that race, when the outcome is already settled and
 * the row is known to exist. It decides which of three answers to give, not whether to proceed —
 * and it is scoped to this address, so it can only ever read this caller's own row.
 */
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
      // Swept between the two statements — a 24-hour-old key being retried at the boundary. The
      // claim is genuinely free again; saying so is honest, and the retry is no less safe than the
      // original attempt was.
      return { kind: 'claimed', key: input.key, address };
    }

    /*
      The address comparison is now a second line rather than the only one, and it is kept
      deliberately.

      The `SELECT` above is already scoped to this address, so a row belonging to somebody else
      cannot arrive here: a claim lives in its claimant's own namespace and is only ever found by
      the pair. This comparison therefore asserts something that should be structurally
      impossible — and that is the point. It is the line that goes off if the `WHERE` clause above
      is ever narrowed back to `key` alone by an edit that reads like a simplification. Reported as
      a plain mismatch, naming nothing, because a row this caller is not entitled to must not be
      described to them.
    */
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
    /*
      Fails closed, for the same reason `verifyAction` does. A key we could not record is a key we
      cannot promise is unspent, and accepting the request anyway would make double-execution
      protection something an attacker — or a bad afternoon for the database — turns off. The
      routes that carry this were about to write to the same store regardless.
    */
    return {
      kind: 'unavailable',
      reason: opaqueDetail('the idempotency ledger', error),
    };
  }
}

/** Byte equality over two digests, without an early exit on the first differing byte. */
function sameBytes(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  let differing = 0;
  for (let i = 0; i < a.length; i += 1) differing |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return differing === 0;
}

/**
 * Record what the first attempt answered, so a retry is given the same thing.
 *
 * Takes the {@link IdempotencyHold} the claim returned rather than a bare key, so the row is
 * addressed by the same normalised pair that wrote it, and so a route cannot supply a key without
 * the address it belongs to. On `key` alone this statement writes THIS caller's response body onto
 * whichever row happens to carry that string — which, in a shared namespace, is how one caller's
 * answer is served to another caller's retry.
 *
 * `WHERE status IS NULL` so a completed row is never rewritten. Two attempts cannot both reach here
 * for one key — only the claimant proceeds — but a route that calls this twice by mistake would
 * otherwise change the answer a retry receives, silently, after the retry may already have had it.
 */
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

/**
 * Give the key back, for a failure that provably changed nothing.
 *
 * # When a route may call this, and when it must not
 *
 * Only when it knows no side effect committed — a validation that failed before any write, a
 * transaction that rolled back whole. Then releasing is right: the operation did not happen, and
 * the client's retry should be allowed to make it happen.
 *
 * After anything has landed, or when the route cannot tell, it must NOT be called. The claim then
 * stands until it expires, and the retry is answered `in-flight` rather than being allowed to run a
 * second time. That is the deliberate default and it is the fail-closed direction: a caller told to
 * wait has lost time, a caller allowed to re-run has lost whatever the operation cost.
 *
 * Scoped to `(address, key)`, like everything else here — and on `key` alone this is the most
 * dangerous statement in the file. It would let any caller delete another address's unfinished
 * claim by naming its key, after which that address's retry is allowed to execute its operation a
 * second time: the exact outcome this module exists to prevent, handed to an attacker as a
 * one-request primitive.
 *
 * Refuses to touch a completed row, so a stored response can never be erased and replaced by a
 * second execution.
 */
export async function releaseIdempotencyClaim(hold: IdempotencyHold): Promise<void> {
  await db().query(
    'DELETE FROM agent_requests WHERE address = $1 AND key = $2 AND status IS NULL',
    [hold.address, hold.key],
  );
}

/**
 * Turn a claim into the response to return, or `null` to carry on with the work.
 *
 * Shaped like `rateLimit` — `if (answered !== null) return answered;` — because a guard returning a
 * boolean is one forgotten `return` away from executing every retry.
 */
export function idempotencyResponse(claim: IdempotencyClaim): Response | null {
  switch (claim.kind) {
    case 'claimed':
      return null;

    case 'replay':
      /*
        The first attempt's answer, verbatim, with a header saying so. The status is replayed too: a
        retry of a request that was answered `201` must see `201`, not `200`, or a client that
        branches on the status behaves differently on the retry than on the original — which is the
        inconsistency idempotency is for.
      */
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

/**
 * Sweep what can no longer matter.
 *
 * Opportunistic rather than scheduled, and bounded, exactly as the `used_signatures` sweep is: this
 * application has no cron, and a table that only grows is how a cheap guard becomes the slowest
 * statement here. Run on the claim path only, so a replay costs one statement rather than two.
 *
 * # Why the subquery selects the PAIR, and what keying it on `key` alone destroys
 *
 * The bound has to be applied by a subquery — `DELETE ... LIMIT` is not PostgreSQL syntax — so the
 * inner statement picks the rows and the outer one matches them back. Matching them back on `key`
 * alone is the defect, and it is worse than any on the claim path because it is silent and it
 * DELETES: one expired row of address A takes out every live, unexpired row of every other address
 * that happens to share that key string. Those callers' stored responses vanish, so their retries
 * re-execute; their in-flight claims vanish, so their concurrent retries run alongside the original.
 * A caller could arrange that eviction on purpose — claim a key, let it expire, and wait for
 * anybody's write to fire the sweep.
 *
 * `(address, key) IN (SELECT address, key ...)` is a row comparison against the primary key, so the
 * rows picked are exactly the rows deleted and nothing beside them is touched.
 */
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
