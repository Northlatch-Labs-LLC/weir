// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * The two guards a machine caller needs, and the two ways each is usually got wrong.
 *
 * # What is worth asserting here
 *
 * Not "it counts" and not "it stores a key", which any implementation does. Both of these modules
 * exist because of a race, and a race is the one thing a mock cannot be asked about:
 *
 *   * A stubbed pool proves nothing about `ON CONFLICT DO NOTHING`, which IS the idempotency claim.
 *     Assert it against a stub and you have asserted that your stub returns what you told it to.
 *   * A stubbed pool proves nothing about `INSERT ... ON CONFLICT DO UPDATE ... WHERE`, which IS the
 *     quota. The property that matters — that Postgres re-evaluates the update against the latest
 *     committed row after taking its lock, so two spenders cannot both take the last token — lives
 *     entirely inside the database.
 *
 * `test/replay.test.ts` made the same call for the same reason and it is the register followed here.
 * So the SQL half of this file runs against a real, disposable PostgreSQL, and skips loudly rather
 * than passing quietly when there is none — a suite that is green because it did not run is worse
 * than one that is red.
 *
 * # The arithmetic is tested twice, deliberately
 *
 * `projectBucket` is the refill in TypeScript and the `SET` clause is the refill in SQL. That is a
 * duplication, and it is pinned rather than trusted: the case table below is asserted against BOTH,
 * so the day they disagree this file goes red. The SQL is the one that is right; the TypeScript
 * exists because a refused caller has to be told when to come back, and the SQL writes nothing on a
 * refusal.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  QUOTAS,
  msUntilAffordable,
  projectBucket,
  type BucketState,
  type Quota,
} from '../lib/rate-limit';

/* ------------------------------------------------------------------------------------------------
   The arithmetic, with no database in sight.
   ------------------------------------------------------------------------------------------------ */

const Q: Quota = { capacity: 10, msPerToken: 1_000 };

/**
 * The cases the SQL is also asserted against, further down.
 *
 * Every one of these is a way a token bucket is got wrong in the field, not a way it is got right.
 */
const REFILL_CASES: Array<{ why: string; from: BucketState; nowMs: number; tokens: number }> = [
  {
    why: 'nothing has elapsed, so nothing is earned',
    from: { tokens: 4, refilledAtMs: 1_000_000 },
    nowMs: 1_000_000,
    tokens: 4,
  },
  {
    why: 'a partial token is not a token',
    from: { tokens: 4, refilledAtMs: 1_000_000 },
    nowMs: 1_000_999,
    tokens: 4,
  },
  {
    why: 'a whole token is',
    from: { tokens: 4, refilledAtMs: 1_000_000 },
    nowMs: 1_001_000,
    tokens: 5,
  },
  {
    why: 'an idle bucket caps rather than banking credit it can spend in a burst later',
    from: { tokens: 0, refilledAtMs: 1_000_000 },
    nowMs: 1_000_000 + 500 * 1_000,
    tokens: 10,
  },
  {
    why: 'a clock that went backwards takes nothing away',
    from: { tokens: 4, refilledAtMs: 1_000_000 },
    nowMs: 900_000,
    tokens: 4,
  },
  {
    why: 'an empty bucket refills from empty',
    from: { tokens: 0, refilledAtMs: 1_000_000 },
    nowMs: 1_003_000,
    tokens: 3,
  },
];

describe('the refill arithmetic', () => {
  for (const c of REFILL_CASES) {
    it(c.why, () => {
      expect(projectBucket(c.from, Q, c.nowMs).tokens).toBe(c.tokens);
    });
  }

  it('advances the mark by whole tokens only, never to now', () => {
    /*
      The defect this pins, and it is the one that turns a limiter into an outage.

      Advancing `refilled_at_ms` to `now` discards the remainder on every call. A caller arriving
      every 999ms against a 1000ms token would then reset the clock 999ms early, for ever, and never
      earn a single token back — a bucket that empties permanently the more it is used, on the
      callers using it most legitimately.
    */
    const at = projectBucket({ tokens: 0, refilledAtMs: 1_000_000 }, Q, 1_001_999);
    expect(at.tokens).toBe(1);
    expect(at.refilledAtMs).toBe(1_001_000);
    // The leftover 999ms survives, so the next token lands 1ms later rather than 1000ms later.
    expect(projectBucket(at, Q, 1_002_000).tokens).toBe(2);
  });

  it('never tells a refused caller to come back immediately', () => {
    const projected = projectBucket({ tokens: 0, refilledAtMs: 2_000_000 }, Q, 2_000_500);
    expect(msUntilAffordable(projected, Q, 1, 2_000_500)).toBe(500);
  });

  it('prices the wait for a cost larger than one token', () => {
    const projected = projectBucket({ tokens: 1, refilledAtMs: 3_000_000 }, Q, 3_000_000);
    expect(msUntilAffordable(projected, Q, 4, 3_000_000)).toBe(3_000);
  });

  it('asks for no wait at all when the caller can already afford it', () => {
    const projected = projectBucket({ tokens: 5, refilledAtMs: 0 }, Q, 0);
    expect(msUntilAffordable(projected, Q, 1, 0)).toBe(0);
  });
});

describe('what the buckets are set to', () => {
  it('prices spending far below reading, because it is the one that costs money', () => {
    // The ordering is the design. `purchase` is what bounds a runaway agent, and a ceiling on
    // spending that is anywhere near a ceiling on reading is not bounding anything.
    expect(QUOTAS.purchase.capacity).toBeLessThan(QUOTAS.write.capacity);
    expect(QUOTAS.write.capacity).toBeLessThan(QUOTAS.read.capacity);
    expect(QUOTAS.purchase.msPerToken).toBeGreaterThan(QUOTAS.write.msPerToken);
    expect(QUOTAS.write.msPerToken).toBeGreaterThan(QUOTAS.read.msPerToken);
  });

  it('gives every bucket a burst a single request can afford', () => {
    // A capacity below one makes `quotaLimit` throw rather than refuse, which is right, and is a
    // configuration mistake worth catching here rather than at 3am on the buy path.
    for (const quota of Object.values(QUOTAS)) expect(quota.capacity).toBeGreaterThanOrEqual(1);
  });
});

/* ------------------------------------------------------------------------------------------------
   The half that needs a real database, because the property being asserted lives inside one.
   ------------------------------------------------------------------------------------------------ */

/**
 * The disposable database, or null.
 *
 * `PROJECTX_TEST_DATABASE_URL` and nothing else, and its name must end in `_test` — the same two
 * guards `test/helpers/database.ts` applies, for the same reason: what follows writes to whatever
 * it is pointed at.
 *
 * This file does NOT use that helper, and the difference is deliberate. `resetDatabase` truncates
 * every table in the schema, and these rows are scoped to addresses and keys unique to this run —
 * so nothing here can disturb another suite sharing the database, and nothing another suite does
 * can delete a row mid-assertion. That failure has already happened once in this repo, to
 * `replay.test.ts`, and the helper's own comment records it.
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
  if (app !== undefined && app.trim() === url.trim()) {
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

/**
 * A run tag, so these rows cannot collide with another suite's or with a previous run's.
 *
 * Addresses are real 32-byte hex, because `normaliseAddress` — and therefore every lookup — parses
 * them as `BigInt`. A readable placeholder would fail for a reason that has nothing to do with what
 * is being asserted.
 */
const RUN = Date.now().toString(16).padStart(12, '0');
const addr = (n: number): string => `0x${RUN}${String(n).padStart(52, '0')}`;

let pool: Pool | null = null;

/**
 * The statement under test, run directly.
 *
 * Copied from `spendQuota` on purpose rather than imported: `lib/rate-limit` reaches Postgres
 * through `lib/db`'s process-wide pool, and these tests need two INDEPENDENT connections held open
 * at the same time to make one wait on the other's lock. A pooled helper hands back whichever
 * connection is free and would quietly run both halves of the race on one, which passes and proves
 * the opposite of what it claims.
 *
 * The wrapper below asserts, against the module, that the two are the same statement.
 */
const SPEND = `
  INSERT INTO agent_quotas AS q (address, bucket, tokens, refilled_at_ms)
  VALUES ($1, $2, $3::int - $4::int, $5::bigint)
  ON CONFLICT (address, bucket) DO UPDATE
     SET tokens = LEAST(
           $3::bigint,
           q.tokens::bigint + (GREATEST(0, $5::bigint - q.refilled_at_ms) / $6::bigint)
         )::int - $4::int,
         refilled_at_ms =
           q.refilled_at_ms
           + (GREATEST(0, $5::bigint - q.refilled_at_ms) / $6::bigint) * $6::bigint
   WHERE LEAST(
           $3::bigint,
           q.tokens::bigint + (GREATEST(0, $5::bigint - q.refilled_at_ms) / $6::bigint)
         ) >= $4::bigint
  RETURNING q.tokens`;

const describeSql = describe.runIf(url !== null);

beforeAll(async () => {
  if (url === null) {
    // Loud, in the run output, rather than a silent skip. A guard nobody ran is not a guard.
    console.warn(
      'quotas.test.ts: PROJECTX_TEST_DATABASE_URL is unset, so the concurrency assertions — the ' +
        'only ones that can prove this table works — did NOT run.',
    );
    return;
  }
  pool = new Pool({ connectionString: url, max: 8 });
  // The migrations themselves, so this file also proves they apply and re-apply. Both are written
  // with IF NOT EXISTS and DROP CONSTRAINT IF EXISTS, so running them here is a no-op on a database
  // that already has them.
  for (const file of ['024_agent_requests.sql', '025_quotas.sql']) {
    await pool.query(readFileSync(join(process.cwd(), 'db', file), 'utf8'));
  }
});

afterAll(async () => {
  if (pool === null) return;
  await pool.query('DELETE FROM agent_quotas WHERE address LIKE $1', [`0x${RUN}%`]);
  await pool.query('DELETE FROM agent_requests WHERE key LIKE $1', [`${RUN}-%`]);
  await pool.end();
});

/** One spend, on the shared pool. Returns the remaining tokens, or null when refused. */
async function spend(
  address: string,
  bucket: string,
  quota: Quota,
  nowMs: number,
  cost = 1,
): Promise<number | null> {
  const result = await pool!.query<{ tokens: number }>(SPEND, [
    address,
    bucket,
    quota.capacity,
    cost,
    nowMs,
    quota.msPerToken,
  ]);
  return result.rowCount === 1 ? (result.rows[0]?.tokens ?? 0) : null;
}

describeSql('the statement in the file is the statement being tested', () => {
  it('matches `spendQuota` character for character, ignoring layout', () => {
    /*
      The trap this closes. The race below cannot use `spendQuota`, because it needs two connections
      held open simultaneously and `lib/db` pools them — so it runs a copy. A copy that drifts is a
      test which proves a statement the application does not run, which is worse than no test at
      all, because it reads like proof.
    */
    const source = readFileSync(join(process.cwd(), 'lib', 'rate-limit.ts'), 'utf8');
    const flatten = (s: string): string => s.replace(/\s+/g, ' ').trim();
    expect(flatten(source)).toContain(flatten(SPEND));
  });
});

describeSql('spending a token', () => {
  it('hands back the remaining balance and refuses the one past empty', async () => {
    const a = addr(1);
    const quota: Quota = { capacity: 3, msPerToken: 60_000 };
    const t = 5_000_000_000;

    expect(await spend(a, 'read', quota, t)).toBe(2);
    expect(await spend(a, 'read', quota, t)).toBe(1);
    expect(await spend(a, 'read', quota, t)).toBe(0);
    expect(await spend(a, 'read', quota, t)).toBeNull();
  });

  it('keeps the buckets apart, so reading cannot exhaust the budget that bounds spending', async () => {
    const a = addr(2);
    const quota: Quota = { capacity: 2, msPerToken: 60_000 };
    const t = 5_000_000_000;

    await spend(a, 'read', quota, t);
    await spend(a, 'read', quota, t);
    expect(await spend(a, 'read', quota, t)).toBeNull();
    expect(await spend(a, 'purchase', quota, t)).toBe(1);
  });

  it('writes nothing at all when it refuses, so the accrued time is not spent', async () => {
    /*
      The subtle one. If a refusal advanced `refilled_at_ms`, a client in a tight retry loop would
      reset its own refill clock on every rejected attempt and would never earn a token back — the
      limiter would punish the retry behaviour it is trying to shape into backoff.
    */
    const a = addr(3);
    const quota: Quota = { capacity: 1, msPerToken: 10_000 };
    const t = 5_000_000_000;

    await spend(a, 'write', quota, t);
    const before = await pool!.query<{ refilled_at_ms: string }>(
      'SELECT refilled_at_ms FROM agent_quotas WHERE address = $1 AND bucket = $2',
      [a, 'write'],
    );

    // Refused, repeatedly, at a moment 9 seconds later — inside the token's refill interval.
    expect(await spend(a, 'write', quota, t + 9_000)).toBeNull();
    expect(await spend(a, 'write', quota, t + 9_500)).toBeNull();

    const after = await pool!.query<{ refilled_at_ms: string }>(
      'SELECT refilled_at_ms FROM agent_quotas WHERE address = $1 AND bucket = $2',
      [a, 'write'],
    );
    expect(after.rows[0]?.refilled_at_ms).toBe(before.rows[0]?.refilled_at_ms);
    // And the token still arrives on schedule rather than being pushed back by the refusals.
    expect(await spend(a, 'write', quota, t + 10_000)).toBe(0);
  });

  it('does not overflow on a bucket nobody has touched for a decade', async () => {
    /*
      `earned` for a ten-year-old row at 100ms a token is 3.15e9, which does not fit in `integer`.
      Casting that intermediate down — the obvious way to write this — aborts the statement with
      "integer out of range", so the limiter would fail on precisely its quietest callers.
    */
    const a = addr(4);
    const quota: Quota = { capacity: 600, msPerToken: 100 };
    const t = 5_000_000_000;

    await spend(a, 'read', quota, t);
    const decadeLater = t + 10 * 365 * 24 * 60 * 60 * 1000;
    expect(await spend(a, 'read', quota, decadeLater)).toBe(quota.capacity - 1);
  });

  it('agrees with `projectBucket` on every case the arithmetic tests use', async () => {
    /*
      The duplication, pinned. `projectBucket` is what tells a refused caller when to return, and
      the SQL is what actually decides. They are asserted against the same table of cases so that
      the day one is edited without the other, this goes red instead of the two quietly diverging
      into a client that backs off for a length of time the server does not agree with.
    */
    for (const [i, c] of REFILL_CASES.entries()) {
      const a = addr(100 + i);
      await pool!.query(
        'INSERT INTO agent_quotas (address, bucket, tokens, refilled_at_ms) VALUES ($1,$2,$3,$4)',
        [a, 'read', c.from.tokens, c.from.refilledAtMs],
      );
      // Cost 0 is not something `spendQuota` permits; here it isolates the refill from the spend,
      // so what is compared is the arithmetic and not the arithmetic minus one.
      const remaining = await spend(a, 'read', Q, c.nowMs, 0);
      expect({ why: c.why, tokens: remaining }).toEqual({ why: c.why, tokens: c.tokens });
      expect(projectBucket(c.from, Q, c.nowMs).tokens).toBe(c.tokens);
    }
  });
});

describeSql('two instances spending the last token at the same moment', () => {
  it('lets exactly one of them have it', async () => {
    /*
      THE assertion this whole table exists for, and the one a mock cannot make.

      Two dedicated connections — not two calls on a pool, which may hand back the same one — each
      open a transaction and each try to spend the single remaining token at the same `now`. The
      second blocks on the first's row lock, and on acquiring it Postgres re-evaluates the DO UPDATE
      against the row as the first one left it, rather than against the snapshot its statement began
      with. So the affordability test the second runs sees `tokens = 0`.

      Read-then-update fails exactly here: both sessions read `tokens = 1` from their own snapshots,
      both write `0`, and two purchases happen on a budget for one.
    */
    const a = addr(5);
    const quota: Quota = { capacity: 1, msPerToken: 3_600_000 };
    const t = 5_000_000_000;

    const one = await pool!.connect();
    const two = await pool!.connect();
    try {
      await one.query('BEGIN');
      await two.query('BEGIN');

      const args = [a, 'purchase', quota.capacity, 1, t, quota.msPerToken];
      const first = await one.query(SPEND, args);
      expect(first.rowCount).toBe(1);

      // Issued while the first transaction is still open and still holding the row. This promise
      // cannot settle until that transaction ends — which is the lock doing its job.
      const blocked = two.query(SPEND, args);

      let settledEarly = false;
      await Promise.race([
        blocked.then(() => {
          settledEarly = true;
        }),
        new Promise((resolve) => setTimeout(resolve, 250)),
      ]);
      expect(settledEarly).toBe(false);

      await one.query('COMMIT');
      const second = await blocked;
      await two.query('COMMIT');

      // One token existed. One spend succeeded. The other was refused, not queued behind it.
      expect(second.rowCount).toBe(0);
    } finally {
      one.release();
      two.release();
    }

    const row = await pool!.query<{ tokens: number }>(
      'SELECT tokens FROM agent_quotas WHERE address = $1 AND bucket = $2',
      [a, 'purchase'],
    );
    expect(row.rows[0]?.tokens).toBe(0);
  });

  it('gives out exactly the capacity when a hundred requests arrive together', async () => {
    /*
      The same property at the scale an agent actually produces, and the shape that catches a
      lost update the two-connection test can miss by being too orderly.
    */
    const a = addr(6);
    const quota: Quota = { capacity: 25, msPerToken: 3_600_000 };
    const t = 5_000_000_000;

    const results = await Promise.all(
      Array.from({ length: 100 }, () => spend(a, 'purchase', quota, t)),
    );

    expect(results.filter((r) => r !== null)).toHaveLength(quota.capacity);
    // And the balances handed out are the distinct numbers 0..capacity-1, so no two callers were
    // ever told the same thing about what was left.
    expect(new Set(results.filter((r): r is number => r !== null)).size).toBe(quota.capacity);

    const row = await pool!.query<{ tokens: number }>(
      'SELECT tokens FROM agent_quotas WHERE address = $1 AND bucket = $2',
      [a, 'purchase'],
    );
    expect(row.rows[0]?.tokens).toBe(0);
  });

  it('races the very first request for an address without creating two rows', async () => {
    // Before any row exists, every concurrent request is an INSERT and they collide on the primary
    // key. One wins outright; the rest fall through to DO UPDATE, take the lock, and re-evaluate.
    const a = addr(7);
    const quota: Quota = { capacity: 5, msPerToken: 3_600_000 };
    const t = 5_000_000_000;

    const results = await Promise.all(
      Array.from({ length: 20 }, () => spend(a, 'purchase', quota, t)),
    );
    expect(results.filter((r) => r !== null)).toHaveLength(5);

    const rows = await pool!.query(
      'SELECT tokens FROM agent_quotas WHERE address = $1 AND bucket = $2',
      [a, 'purchase'],
    );
    expect(rows.rowCount).toBe(1);
  });

  it('refuses to record a negative balance even if a decrement escaped the test', async () => {
    // The table's own last word. A negative balance means the affordability check was bypassed, and
    // it aborts here rather than being read back later as a caller who owes requests.
    const a = addr(8);
    await expect(
      pool!.query(
        'INSERT INTO agent_quotas (address, bucket, tokens, refilled_at_ms) VALUES ($1,$2,-1,0)',
        [a, 'purchase'],
      ),
    ).rejects.toThrow(/agent_quotas_tokens_not_negative/);
  });
});

/* ------------------------------------------------------------------------------------------------
   Idempotency: the same key twice.
   ------------------------------------------------------------------------------------------------ */

/**
 * The claim, with the conflict arbiter the table's primary key actually is.
 *
 * `ON CONFLICT (address, key)`, not `(key)`. Against `PRIMARY KEY (address, key)` the single-column
 * arbiter is not merely narrower — Postgres refuses it outright, because no unique index matches
 * it. That is the good failure. The one this shape prevents is the shape the table used to have,
 * where a lone `key` column made the namespace global and address A's claim of a string took that
 * string away from address B.
 *
 * `test/idempotency-namespace.test.ts` asserts the cross-address behaviour against the MODULE
 * rather than against this copy. This copy stays because the tests below are about the table — the
 * conflict, the CHECK constraint, the completion guard — and it is deliberately the same statement
 * `lib/idempotency.ts` runs.
 */
const CLAIM = `
  INSERT INTO agent_requests (key, address, route, request_sha256, created_at_ms, expires_at_ms)
  VALUES ($1, $2, $3, $4, $5, $6)
  ON CONFLICT (address, key) DO NOTHING`;

const sha = (body: string): Buffer => createHash('sha256').update(body, 'utf8').digest();

async function claim(key: string, address: string, route: string, body: string): Promise<boolean> {
  const t = 5_000_000_000;
  const result = await pool!.query(CLAIM, [key, address, route, sha(body), t, t + 86_400_000]);
  return result.rowCount === 1;
}

describeSql('the idempotency key collision path', () => {
  it('is claimed by exactly one of two simultaneous retries', async () => {
    /*
      The claim is `ON CONFLICT DO NOTHING`, exactly as `used_signatures` is, and for the same
      reason: a read of "does this key exist" followed by an insert leaves a window in which both of
      a client's own retries see nothing and both run the write. That is not a smaller version of
      the problem — it is the same double execution, arriving under concurrency, which is the
      condition a machine caller is defined by.
    */
    const key = `${RUN}-a`;
    const a = addr(9);
    const results = await Promise.all(
      Array.from({ length: 12 }, () => claim(key, a, '/api/posts', '{"title":"one"}')),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('tells the same body and a different body apart by the stored digest', async () => {
    const key = `${RUN}-b`;
    const a = addr(10);
    expect(await claim(key, a, '/api/posts', '{"title":"one"}')).toBe(true);
    expect(await claim(key, a, '/api/posts', '{"title":"one"}')).toBe(false);

    const held = await pool!.query<{ request_sha256: Buffer }>(
      'SELECT request_sha256 FROM agent_requests WHERE address = $1 AND key = $2',
      [a, key],
    );
    const stored = held.rows[0]?.request_sha256;
    // A retry: same bytes, so the caller is entitled to the first response.
    expect(stored?.equals(sha('{"title":"one"}'))).toBe(true);
    // A second, different operation on a reused key: the mismatch that must become a 409, because
    // replaying the first response would report success for something that was never done.
    expect(stored?.equals(sha('{"title":"two"}'))).toBe(false);
  });

  it('refuses a response without a status, and a status without a response', async () => {
    // Half a stored answer is unrecoverable: the first attempt is gone and cannot be asked again,
    // so a retry would be handed a blank. Refused at write time rather than discovered then.
    const a = addr(11);
    const t = 5_000_000_000;
    for (const half of [
      { body: '{"ok":true}', status: null },
      { body: null, status: 201 },
    ]) {
      await expect(
        pool!.query(
          `INSERT INTO agent_requests
             (key, address, route, request_sha256, response_body, status, created_at_ms, expires_at_ms)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,
          [
            `${RUN}-half-${String(half.status)}`,
            a,
            '/api/posts',
            sha('x'),
            half.body,
            half.status,
            t,
            t + 1,
          ],
        ),
      ).rejects.toThrow(/agent_requests_response_complete/);
    }
  });

  it('never rewrites an answer a retry may already have been given', async () => {
    // `WHERE status IS NULL`. Two attempts cannot both reach the completion step for one key, but a
    // route that calls it twice by mistake would otherwise change what a retry receives, silently,
    // after the retry has had it.
    const key = `${RUN}-c`;
    const a = addr(12);
    await claim(key, a, '/api/posts', '{}');

    const complete = `UPDATE agent_requests SET response_body = $3::jsonb, status = $4
                       WHERE address = $1 AND key = $2 AND status IS NULL`;
    expect((await pool!.query(complete, [a, key, '{"id":"first"}', 201])).rowCount).toBe(1);
    expect((await pool!.query(complete, [a, key, '{"id":"second"}', 200])).rowCount).toBe(0);

    const row = await pool!.query<{ response_body: { id: string }; status: number }>(
      'SELECT response_body, status FROM agent_requests WHERE address = $1 AND key = $2',
      [a, key],
    );
    expect(row.rows[0]?.response_body.id).toBe('first');
    expect(row.rows[0]?.status).toBe(201);
  });

  it('has the PAIR as its primary key, and refuses a lone-key arbiter', async () => {
    /*
      Asserted against the catalogue rather than against behaviour, because this is the fact every
      other guarantee in `lib/idempotency.ts` rests on. If the primary key were ever narrowed back
      to `key` alone, the module's queries would still run — they would simply start finding, and
      writing, and deleting, other addresses' rows. Nothing would go red. This does.
    */
    const pk = await pool!.query<{ columns: string[] }>(
      `SELECT array_agg(a.attname::text ORDER BY k.ord) AS columns
         FROM pg_constraint c
         JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
        WHERE c.conrelid = 'agent_requests'::regclass AND c.contype = 'p'`,
    );
    expect(pk.rows[0]?.columns).toEqual(['address', 'key']);

    // And the corollary, which is what makes a narrowed arbiter fail loudly instead of quietly:
    // there is no unique index on `key` alone for `ON CONFLICT (key)` to infer.
    await expect(
      pool!.query(
        `INSERT INTO agent_requests
           (key, address, route, request_sha256, created_at_ms, expires_at_ms)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (key) DO NOTHING`,
        [`${RUN}-arbiter`, addr(14), '/api/posts', sha('{}'), 5_000_000_000, 5_000_086_400_000],
      ),
    ).rejects.toThrow(/no unique or exclusion constraint matching/i);
  });

  it('will not release a claim that has already answered', async () => {
    // `releaseIdempotencyClaim` deletes only an unfinished claim. Deleting a completed one would
    // erase a stored response and let the next retry execute the operation a second time — the
    // exact outcome this module exists to prevent, delivered by its own cleanup path.
    const key = `${RUN}-d`;
    const a = addr(13);
    await claim(key, a, '/api/posts', '{}');
    await pool!.query(
      `UPDATE agent_requests SET response_body = $3::jsonb, status = 201
        WHERE address = $1 AND key = $2`,
      [a, key, '{"id":"kept"}'],
    );

    const release =
      'DELETE FROM agent_requests WHERE address = $1 AND key = $2 AND status IS NULL';
    expect((await pool!.query(release, [a, key])).rowCount).toBe(0);
    expect(
      (await pool!.query('SELECT 1 FROM agent_requests WHERE address = $1 AND key = $2', [a, key]))
        .rowCount,
    ).toBe(1);
  });
});
