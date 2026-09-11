// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

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

const Q: Quota = { capacity: 10, msPerToken: 1_000 };

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
    const at = projectBucket({ tokens: 0, refilledAtMs: 1_000_000 }, Q, 1_001_999);
    expect(at.tokens).toBe(1);
    expect(at.refilledAtMs).toBe(1_001_000);
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
    expect(QUOTAS.purchase.capacity).toBeLessThan(QUOTAS.write.capacity);
    expect(QUOTAS.write.capacity).toBeLessThan(QUOTAS.read.capacity);
    expect(QUOTAS.purchase.msPerToken).toBeGreaterThan(QUOTAS.write.msPerToken);
    expect(QUOTAS.write.msPerToken).toBeGreaterThan(QUOTAS.read.msPerToken);
  });

  it('gives every bucket a burst a single request can afford', () => {
    for (const quota of Object.values(QUOTAS)) expect(quota.capacity).toBeGreaterThanOrEqual(1);
  });
});

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

const RUN = Date.now().toString(16).padStart(12, '0');
const addr = (n: number): string => `0x${RUN}${String(n).padStart(52, '0')}`;

let pool: Pool | null = null;

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
    console.warn(
      'quotas.test.ts: PROJECTX_TEST_DATABASE_URL is unset, so the concurrency assertions — the ' +
        'only ones that can prove this table works — did NOT run.',
    );
    return;
  }
  pool = new Pool({ connectionString: url, max: 8 });
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
    const a = addr(3);
    const quota: Quota = { capacity: 1, msPerToken: 10_000 };
    const t = 5_000_000_000;

    await spend(a, 'write', quota, t);
    const before = await pool!.query<{ refilled_at_ms: string }>(
      'SELECT refilled_at_ms FROM agent_quotas WHERE address = $1 AND bucket = $2',
      [a, 'write'],
    );

    expect(await spend(a, 'write', quota, t + 9_000)).toBeNull();
    expect(await spend(a, 'write', quota, t + 9_500)).toBeNull();

    const after = await pool!.query<{ refilled_at_ms: string }>(
      'SELECT refilled_at_ms FROM agent_quotas WHERE address = $1 AND bucket = $2',
      [a, 'write'],
    );
    expect(after.rows[0]?.refilled_at_ms).toBe(before.rows[0]?.refilled_at_ms);
    expect(await spend(a, 'write', quota, t + 10_000)).toBe(0);
  });

  it('does not overflow on a bucket nobody has touched for a decade', async () => {
    const a = addr(4);
    const quota: Quota = { capacity: 600, msPerToken: 100 };
    const t = 5_000_000_000;

    await spend(a, 'read', quota, t);
    const decadeLater = t + 10 * 365 * 24 * 60 * 60 * 1000;
    expect(await spend(a, 'read', quota, decadeLater)).toBe(quota.capacity - 1);
  });

  it('agrees with `projectBucket` on every case the arithmetic tests use', async () => {
    for (const [i, c] of REFILL_CASES.entries()) {
      const a = addr(100 + i);
      await pool!.query(
        'INSERT INTO agent_quotas (address, bucket, tokens, refilled_at_ms) VALUES ($1,$2,$3,$4)',
        [a, 'read', c.from.tokens, c.from.refilledAtMs],
      );
      const remaining = await spend(a, 'read', Q, c.nowMs, 0);
      expect({ why: c.why, tokens: remaining }).toEqual({ why: c.why, tokens: c.tokens });
      expect(projectBucket(c.from, Q, c.nowMs).tokens).toBe(c.tokens);
    }
  });
});

describeSql('two instances spending the last token at the same moment', () => {
  it('lets exactly one of them have it', async () => {
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
    const a = addr(6);
    const quota: Quota = { capacity: 25, msPerToken: 3_600_000 };
    const t = 5_000_000_000;

    const results = await Promise.all(
      Array.from({ length: 100 }, () => spend(a, 'purchase', quota, t)),
    );

    expect(results.filter((r) => r !== null)).toHaveLength(quota.capacity);
    expect(new Set(results.filter((r): r is number => r !== null)).size).toBe(quota.capacity);

    const row = await pool!.query<{ tokens: number }>(
      'SELECT tokens FROM agent_quotas WHERE address = $1 AND bucket = $2',
      [a, 'purchase'],
    );
    expect(row.rows[0]?.tokens).toBe(0);
  });

  it('races the very first request for an address without creating two rows', async () => {
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
    const a = addr(8);
    await expect(
      pool!.query(
        'INSERT INTO agent_quotas (address, bucket, tokens, refilled_at_ms) VALUES ($1,$2,-1,0)',
        [a, 'purchase'],
      ),
    ).rejects.toThrow(/agent_quotas_tokens_not_negative/);
  });
});

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
    expect(stored?.equals(sha('{"title":"one"}'))).toBe(true);
    expect(stored?.equals(sha('{"title":"two"}'))).toBe(false);
  });

  it('refuses a response without a status, and a status without a response', async () => {
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
    const pk = await pool!.query<{ columns: string[] }>(
      `SELECT array_agg(a.attname::text ORDER BY k.ord) AS columns
         FROM pg_constraint c
         JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
        WHERE c.conrelid = 'agent_requests'::regclass AND c.contype = 'p'`,
    );
    expect(pk.rows[0]?.columns).toEqual(['address', 'key']);

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
