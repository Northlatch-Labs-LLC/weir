// @vitest-environment node
// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * The idempotency key space belongs to the address, and this file is the proof.
 *
 * # The hole being closed, stated as the thing that must not happen
 *
 * `agent_requests` once had `key` alone as its primary key. That makes the namespace GLOBAL: the
 * key `X` can be held by exactly one row on the whole platform, whoever claimed it first. So
 * address A claiming `X` is precisely what makes `X` unavailable to address B — and B, retrying its
 * own timed-out write with its own key, is answered `409`. A denial of service against the one
 * mechanism whose entire job is to make retries safe, available to anyone who can send a request.
 *
 * The mitigation offered for it was that clients should choose random keys. That is a client-side
 * convention protecting a server-side invariant, which is the shape of a hole rather than a fix.
 *
 * **The first test below is the regression that proves the hole is shut**, and it is written as the
 * attack rather than as a feature: A takes `X`, then B takes the same `X`, and both must succeed
 * and neither may be shown anything belonging to the other.
 *
 * # Why this file runs the module and not a copy of its SQL
 *
 * `test/quotas.test.ts` runs a COPY of the quota statement, because that race needs two independent
 * connections held open at once and `lib/db` pools them. It pays for that copy with a drift test.
 *
 * Nothing here needs two connections, so nothing here needs a copy. These tests call
 * `claimIdempotencyKey`, `completeIdempotentRequest` and `releaseIdempotencyClaim` themselves,
 * against a real PostgreSQL running the real `db/024_agent_requests.sql`. A transcription of the
 * queries would prove the transcription; the point of this file is to prove the module. In
 * particular the OPPORTUNISTIC SWEEP is private and is only reachable by making a successful claim,
 * which is how the last test reaches it — a copied `DELETE` could not fail the way the real one
 * would.
 *
 * # Why it skips loudly rather than passing quietly
 *
 * Same rule as `quotas.test.ts` and `replay.test.ts`. A mocked pool would assert that the mock
 * returns what it was told to. Every property here — the conflict arbiter, the row-scoped
 * `SELECT`, the row-comparison in the sweep — lives inside Postgres, so with no Postgres there is
 * nothing to assert and the file says so in the run output instead of going green.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The disposable database, or null.
 *
 * `PROJECTX_TEST_DATABASE_URL`, and its name must end in `_test` — the same two guards
 * `test/quotas.test.ts` and `test/helpers/database.ts` apply, for the same reason: what follows
 * writes to whatever it is pointed at.
 */
function testUrl(): string | null {
  let url = process.env['PROJECTX_TEST_DATABASE_URL'];
  if (url === undefined) {
    try {
      const line = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
        .split('\n')
        .find((l) => l.startsWith('PROJECTX_TEST_DATABASE_URL='));
      url = line?.slice('PROJECTX_TEST_DATABASE_URL='.length).trim();
    } catch {
      return null;
    }
  }
  if (url === undefined || url.trim() === '') return null;

  const app = process.env['PROJECTX_DATABASE_URL'];
  if (app !== undefined && app.trim() !== '' && app.trim() === url.trim()) {
    throw new Error('PROJECTX_TEST_DATABASE_URL is the application database. Refusing to run.');
  }
  let name: string | null = null;
  try {
    name = new URL(url).pathname.replace(/^\//, '') || null;
  } catch {
    name = null;
  }
  if (name === null || !name.endsWith('_test')) {
    throw new Error(
      `Refusing to run against database "${name ?? 'unknown'}". The name must end in _test.`,
    );
  }
  return url;
}

const url = testUrl();

/*
  Pointed at the disposable database BEFORE `lib/idempotency` is imported, because `lib/db` reads
  the variable on its first `db()` call and stashes the pool on `globalThis` for the life of the
  process. Set it afterwards and the module would either throw for want of a URL or — far worse —
  bind to whatever another suite had already opened. The import is therefore dynamic and happens
  inside `beforeAll`, after this assignment.
*/
if (url !== null) process.env['PROJECTX_DATABASE_URL'] = url;

type IdempotencyModule = typeof import('../lib/idempotency');

let mod: IdempotencyModule | null = null;
/** This file's own connection, used only to look at what the module wrote. */
let pool: Pool | null = null;
/** The application pool `lib/db` handed the module, held so it can be closed and inspected. */
let appPool: Pool | null = null;

const describeSql = describe.runIf(url !== null);

/**
 * A run tag, so these rows cannot collide with another suite's or with a previous run's.
 *
 * Addresses are real 32-byte hex because `normaliseAddress` parses them as `BigInt`; a readable
 * placeholder would fail for a reason that has nothing to do with what is asserted.
 */
const RUN = Date.now().toString(16).padStart(12, '0');
const addr = (n: number): string => `0x${RUN}${String(n).padStart(52, '0')}`;
const ROUTE = '/api/posts';

/** The claim, or a failure loud enough to read. Narrows to the hold, so `.address` is reachable. */
function heldOrThrow(claim: Awaited<ReturnType<IdempotencyModule['claimIdempotencyKey']>>) {
  if (claim.kind !== 'claimed') {
    throw new Error(`expected a claim, got ${claim.kind}: ${JSON.stringify(claim)}`);
  }
  return claim;
}

beforeAll(async () => {
  if (url === null) {
    // Loud, in the run output, rather than a silent skip. A guard nobody ran is not a guard.
    console.warn(
      'idempotency-namespace.test.ts: PROJECTX_TEST_DATABASE_URL is unset, so the cross-address ' +
        'assertions — the only ones that can prove the key space is per address — did NOT run.',
    );
    return;
  }
  pool = new Pool({ connectionString: url, max: 4 });
  await pool.query(readFileSync(join(process.cwd(), 'db', '024_agent_requests.sql'), 'utf8'));
  mod = await import('../lib/idempotency');
  appPool = (await import('../lib/db')).db();

  /*
    The module reaches Postgres through `lib/db`'s process-wide pool, which was pointed at `url`
    above. Asserting it landed where intended — rather than trusting that it did — is the difference
    between these tests writing to a disposable database and writing to somebody's. The pool is
    cached on `globalThis` for the life of the process, so an earlier suite in the same worker could
    have opened it somewhere else entirely, and that would not be visible from the env var.
  */
  const where = await appPool.query<{ db: string }>('SELECT current_database() AS db');
  const name = where.rows[0]?.db ?? '';
  if (!name.endsWith('_test')) {
    throw new Error(`lib/db opened "${name}", which is not the disposable database. Refusing.`);
  }
});

afterAll(async () => {
  if (pool === null) return;
  await pool.query('DELETE FROM agent_requests WHERE key LIKE $1', [`${RUN}-%`]);
  await pool.end();
  await appPool?.end();
});

/* ------------------------------------------------------------------------------------------------
   The regression. Two addresses, one key string.
   ------------------------------------------------------------------------------------------------ */

describeSql('two addresses claiming the same key string', () => {
  it('both succeed, and neither is shown the other', async () => {
    /*
      THE HOLE, WRITTEN AS THE ATTACK. Under `PRIMARY KEY (key)` this test fails at the second
      claim: B's insert conflicts with A's row, the lookup finds a row whose address is not B's, and
      B — who has done nothing wrong and is using its own key — is handed a `409` on a write it has
      never made. That refusal is indistinguishable from the legitimate collision refusal, so the
      denial of service is also invisible.

      A pre-claims the key first, deliberately, because that ordering is the attack: the adversary
      moves before the victim.
    */
    const key = `${RUN}-shared`;
    const a = addr(1);
    const b = addr(2);

    const claimA = heldOrThrow(
      await mod!.claimIdempotencyKey({ key, address: a, route: ROUTE, body: '{"who":"a"}' }),
    );
    const claimB = heldOrThrow(
      await mod!.claimIdempotencyKey({ key, address: b, route: ROUTE, body: '{"who":"b"}' }),
    );

    // Two rows, one key string, two namespaces.
    const rows = await pool!.query<{ address: string }>(
      'SELECT address FROM agent_requests WHERE key = $1 ORDER BY address',
      [key],
    );
    expect(rows.rowCount).toBe(2);
    expect(rows.rows.map((r) => r.address).sort()).toEqual([a, b].sort());

    // Each completes with its own answer.
    await mod!.completeIdempotentRequest(claimA, 201, { who: 'a' });
    await mod!.completeIdempotentRequest(claimB, 200, { who: 'b' });

    // And each retry is given its own answer back, not the other's.
    const retryA = await mod!.claimIdempotencyKey({
      key, address: a, route: ROUTE, body: '{"who":"a"}',
    });
    const retryB = await mod!.claimIdempotencyKey({
      key, address: b, route: ROUTE, body: '{"who":"b"}',
    });
    expect(retryA).toEqual({ kind: 'replay', status: 201, body: { who: 'a' } });
    expect(retryB).toEqual({ kind: 'replay', status: 200, body: { who: 'b' } });
  });

  it('does not let one address complete another address\'s claim', async () => {
    /*
      The completion is `UPDATE ... WHERE address = $1 AND key = $2`. Keyed on `key` alone it would
      write B's response body onto A's row, and A's retry would then be handed an answer to a
      request A never made — which is the same defect as a leaked response, arriving through the
      write path instead of the read path.
    */
    const key = `${RUN}-complete`;
    const a = addr(3);
    const b = addr(4);
    const claimA = heldOrThrow(
      await mod!.claimIdempotencyKey({ key, address: a, route: ROUTE, body: '{}' }),
    );
    const claimB = heldOrThrow(
      await mod!.claimIdempotencyKey({ key, address: b, route: ROUTE, body: '{}' }),
    );

    await mod!.completeIdempotentRequest(claimB, 200, { who: 'b' });

    // A is untouched: still in flight, no body, no status.
    const rowA = await pool!.query<{ response_body: unknown; status: number | null }>(
      'SELECT response_body, status FROM agent_requests WHERE address = $1 AND key = $2',
      [claimA.address, key],
    );
    expect(rowA.rows[0]?.status).toBeNull();
    expect(rowA.rows[0]?.response_body).toBeNull();
  });

  it('does not let one address release another address\'s claim', async () => {
    /*
      The most dangerous statement in the module. On `key` alone, `releaseIdempotencyClaim` is a
      one-request primitive for deleting a stranger's unfinished claim — after which that stranger's
      retry is allowed to execute its operation a second time. That is the exact outcome the module
      exists to prevent, delivered by its own cleanup path.

      B releases with B's own hold; A's row must still be there.
    */
    const key = `${RUN}-release`;
    const a = addr(5);
    const b = addr(6);
    const claimA = heldOrThrow(
      await mod!.claimIdempotencyKey({ key, address: a, route: ROUTE, body: '{}' }),
    );
    const claimB = heldOrThrow(
      await mod!.claimIdempotencyKey({ key, address: b, route: ROUTE, body: '{}' }),
    );

    await mod!.releaseIdempotencyClaim(claimB);

    const survivors = await pool!.query<{ address: string }>(
      'SELECT address FROM agent_requests WHERE key = $1',
      [key],
    );
    expect(survivors.rowCount).toBe(1);
    expect(survivors.rows[0]?.address).toBe(claimA.address);
  });
});

/* ------------------------------------------------------------------------------------------------
   The three answers, within one address's own namespace.
   ------------------------------------------------------------------------------------------------ */

describeSql('the same address presenting the same key twice', () => {
  it('replays the first response for the same body, and writes exactly once', async () => {
    const key = `${RUN}-same`;
    const a = addr(7);
    const body = '{"title":"one"}';

    const first = heldOrThrow(
      await mod!.claimIdempotencyKey({ key, address: a, route: ROUTE, body }),
    );
    await mod!.completeIdempotentRequest(first, 201, { id: 'p1' });

    const retry = await mod!.claimIdempotencyKey({ key, address: a, route: ROUTE, body });
    expect(retry).toEqual({ kind: 'replay', status: 201, body: { id: 'p1' } });

    // One row, one stored answer: the retry did not claim, and therefore the route did not run.
    const rows = await pool!.query('SELECT 1 FROM agent_requests WHERE address = $1 AND key = $2', [
      first.address,
      key,
    ]);
    expect(rows.rowCount).toBe(1);

    // And the replay is served as the first attempt's status, not a fresh 200.
    const answered = mod!.idempotencyResponse(retry);
    expect(answered?.status).toBe(201);
    expect(answered?.headers.get('idempotency-replayed')).toBe('true');
    await expect(answered?.json()).resolves.toEqual({ id: 'p1' });
  });

  it('refuses a different body under the same key with 409', async () => {
    /*
      There is no honest answer to a reused key carrying a second, different operation: replaying
      the first response reports success for something that was never done, and running the second
      discards the key's whole purpose. So it is refused.
    */
    const key = `${RUN}-diff`;
    const a = addr(8);
    const first = heldOrThrow(
      await mod!.claimIdempotencyKey({ key, address: a, route: ROUTE, body: '{"title":"one"}' }),
    );
    await mod!.completeIdempotentRequest(first, 201, { id: 'p1' });

    const second = await mod!.claimIdempotencyKey({
      key, address: a, route: ROUTE, body: '{"title":"two"}',
    });
    expect(second.kind).toBe('mismatch');

    const answered = mod!.idempotencyResponse(second);
    expect(answered?.status).toBe(409);
  });

  it('answers an unfinished claim with 409 and a Retry-After', async () => {
    // Two of the caller's own attempts are in flight. The second is not executed alongside the
    // first, and it is told when to come back rather than being left to guess.
    const key = `${RUN}-inflight`;
    const a = addr(9);
    heldOrThrow(await mod!.claimIdempotencyKey({ key, address: a, route: ROUTE, body: '{}' }));

    const second = await mod!.claimIdempotencyKey({ key, address: a, route: ROUTE, body: '{}' });
    expect(second).toEqual({ kind: 'in-flight' });

    const answered = mod!.idempotencyResponse(second);
    expect(answered?.status).toBe(409);
    expect(answered?.headers.get('retry-after')).toBe('2');
    await expect(answered?.json()).resolves.toMatchObject({ retryAfterSeconds: 2 });
  });

  it('refuses the same key on a different route', async () => {
    // Returning route A's response to a call on route B would be our bug, not the client's.
    const key = `${RUN}-route`;
    const a = addr(10);
    heldOrThrow(await mod!.claimIdempotencyKey({ key, address: a, route: ROUTE, body: '{}' }));

    const elsewhere = await mod!.claimIdempotencyKey({
      key, address: a, route: '/api/comments', body: '{}',
    });
    expect(elsewhere.kind).toBe('mismatch');
  });
});

/* ------------------------------------------------------------------------------------------------
   The sweep.
   ------------------------------------------------------------------------------------------------ */

describeSql('the sweep', () => {
  it('removes only expired rows, and does not cross addresses', async () => {
    /*
      THE SECOND CROSS-ADDRESS DEFECT, and the quieter one. The sweep bounds itself with a subquery
      because `DELETE ... LIMIT` is not PostgreSQL syntax, and matching the picked rows back on
      `key` alone would make ONE expired row of address A delete every LIVE row of every other
      address that shares that key string. Those callers lose their stored responses, so their
      retries re-execute; and it is arrangeable on purpose — claim a key, let it expire, wait for
      anybody's write to fire the sweep.

      Reached through the real claim path, because the sweep is private and opportunistic. A copy of
      the `DELETE` could not fail the way the real one would.
    */
    const key = `${RUN}-sweep`;
    const expiredOwner = addr(11);
    const liveOwner = addr(12);
    const t = 6_000_000_000;

    // An expired row for one address, under a key string...
    await pool!.query(
      `INSERT INTO agent_requests
         (key, address, route, request_sha256, response_body, status, created_at_ms, expires_at_ms)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
      [key, expiredOwner, ROUTE, mod!.requestDigest('{}'), '{"id":"old"}', 201, t - 10, t - 1],
    );
    // ...and a LIVE row for a different address under the SAME key string.
    const live = heldOrThrow(
      await mod!.claimIdempotencyKey({ key, address: liveOwner, route: ROUTE, body: '{}', now: t }),
    );
    await mod!.completeIdempotentRequest(live, 201, { id: 'kept' });

    // A third address makes an unrelated claim. That is what fires the sweep, at `now = t`.
    heldOrThrow(
      await mod!.claimIdempotencyKey({
        key: `${RUN}-sweep-trigger`, address: addr(13), route: ROUTE, body: '{}', now: t,
      }),
    );

    const remaining = await pool!.query<{ address: string; response_body: { id: string } }>(
      'SELECT address, response_body FROM agent_requests WHERE key = $1',
      [key],
    );
    // The expired row is gone; the live row of the other address is untouched, answer and all.
    expect(remaining.rowCount).toBe(1);
    expect(remaining.rows[0]?.address).toBe(live.address);
    expect(remaining.rows[0]?.response_body.id).toBe('kept');
  });

  it('leaves an unexpired row of the sweeping address alone', async () => {
    // The bound is `expires_at_ms < now`, not "everything but the row I just wrote". A sweep that
    // took the caller's own live claims would re-open every window this module closes.
    const t = 6_000_000_000;
    const a = addr(14);
    const mine = heldOrThrow(
      await mod!.claimIdempotencyKey({
        key: `${RUN}-mine`, address: a, route: ROUTE, body: '{}', now: t,
      }),
    );
    heldOrThrow(
      await mod!.claimIdempotencyKey({
        key: `${RUN}-mine-2`, address: a, route: ROUTE, body: '{}', now: t + 1,
      }),
    );
    const still = await pool!.query('SELECT 1 FROM agent_requests WHERE address = $1 AND key = $2', [
      mine.address,
      `${RUN}-mine`,
    ]);
    expect(still.rowCount).toBe(1);
  });
});

/* ------------------------------------------------------------------------------------------------
   The address the caller supplies is normalised once, and the claim carries the result.
   ------------------------------------------------------------------------------------------------ */

describeSql('the address on the claim', () => {
  it('is the normalised form, so a completion cannot miss its own row', async () => {
    /*
      `normaliseAddress` zero-pads and lower-cases. If the completion were given the address as it
      arrived on the wire instead of the form that was written, its `UPDATE` would match zero rows
      — silently — and the row would sit at `status IS NULL` for twenty-four hours, answering every
      retry of a request that HAD SUCCEEDED with `409 in-flight`. Carrying the normalised address on
      the claim is what makes that unrepresentable, and this asserts it is the normalised one.
    */
    const key = `${RUN}-norm`;
    const padded = addr(15);
    const shortened = `0x${padded.replace(/^0x0*/, '').toUpperCase()}`;

    const hold = heldOrThrow(
      await mod!.claimIdempotencyKey({ key, address: shortened, route: ROUTE, body: '{}' }),
    );
    expect(hold.address).toBe(padded);

    await mod!.completeIdempotentRequest(hold, 201, { id: 'p1' });
    const row = await pool!.query<{ status: number | null }>(
      'SELECT status FROM agent_requests WHERE address = $1 AND key = $2',
      [padded, key],
    );
    expect(row.rows[0]?.status).toBe(201);

    // And the caller's odd spelling replays just as well, because it normalises to the same row.
    const retry = await mod!.claimIdempotencyKey({
      key, address: shortened, route: ROUTE, body: '{}',
    });
    expect(retry).toEqual({ kind: 'replay', status: 201, body: { id: 'p1' } });
  });
});
