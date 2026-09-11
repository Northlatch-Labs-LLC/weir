// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

if (url !== null) process.env['PROJECTX_DATABASE_URL'] = url;

type IdempotencyModule = typeof import('../lib/idempotency');

let mod: IdempotencyModule | null = null;
let pool: Pool | null = null;
let appPool: Pool | null = null;

const describeSql = describe.runIf(url !== null);

const RUN = Date.now().toString(16).padStart(12, '0');
const addr = (n: number): string => `0x${RUN}${String(n).padStart(52, '0')}`;
const ROUTE = '/api/posts';

function heldOrThrow(claim: Awaited<ReturnType<IdempotencyModule['claimIdempotencyKey']>>) {
  if (claim.kind !== 'claimed') {
    throw new Error(`expected a claim, got ${claim.kind}: ${JSON.stringify(claim)}`);
  }
  return claim;
}

beforeAll(async () => {
  if (url === null) {
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

describeSql('two addresses claiming the same key string', () => {
  it('both succeed, and neither is shown the other', async () => {
    const key = `${RUN}-shared`;
    const a = addr(1);
    const b = addr(2);

    const claimA = heldOrThrow(
      await mod!.claimIdempotencyKey({ key, address: a, route: ROUTE, body: '{"who":"a"}' }),
    );
    const claimB = heldOrThrow(
      await mod!.claimIdempotencyKey({ key, address: b, route: ROUTE, body: '{"who":"b"}' }),
    );

    const rows = await pool!.query<{ address: string }>(
      'SELECT address FROM agent_requests WHERE key = $1 ORDER BY address',
      [key],
    );
    expect(rows.rowCount).toBe(2);
    expect(rows.rows.map((r) => r.address).sort()).toEqual([a, b].sort());

    await mod!.completeIdempotentRequest(claimA, 201, { who: 'a' });
    await mod!.completeIdempotentRequest(claimB, 200, { who: 'b' });

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

    const rowA = await pool!.query<{ response_body: unknown; status: number | null }>(
      'SELECT response_body, status FROM agent_requests WHERE address = $1 AND key = $2',
      [claimA.address, key],
    );
    expect(rowA.rows[0]?.status).toBeNull();
    expect(rowA.rows[0]?.response_body).toBeNull();
  });

  it('does not let one address release another address\'s claim', async () => {
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

    const rows = await pool!.query('SELECT 1 FROM agent_requests WHERE address = $1 AND key = $2', [
      first.address,
      key,
    ]);
    expect(rows.rowCount).toBe(1);

    const answered = mod!.idempotencyResponse(retry);
    expect(answered?.status).toBe(201);
    expect(answered?.headers.get('idempotency-replayed')).toBe('true');
    await expect(answered?.json()).resolves.toEqual({ id: 'p1' });
  });

  it('refuses a different body under the same key with 409', async () => {
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
    const key = `${RUN}-route`;
    const a = addr(10);
    heldOrThrow(await mod!.claimIdempotencyKey({ key, address: a, route: ROUTE, body: '{}' }));

    const elsewhere = await mod!.claimIdempotencyKey({
      key, address: a, route: '/api/comments', body: '{}',
    });
    expect(elsewhere.kind).toBe('mismatch');
  });
});

describeSql('the sweep', () => {
  it('removes only expired rows, and does not cross addresses', async () => {
    const key = `${RUN}-sweep`;
    const expiredOwner = addr(11);
    const liveOwner = addr(12);
    const t = 6_000_000_000;

    await pool!.query(
      `INSERT INTO agent_requests
         (key, address, route, request_sha256, response_body, status, created_at_ms, expires_at_ms)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
      [key, expiredOwner, ROUTE, mod!.requestDigest('{}'), '{"id":"old"}', 201, t - 10, t - 1],
    );
    const live = heldOrThrow(
      await mod!.claimIdempotencyKey({ key, address: liveOwner, route: ROUTE, body: '{}', now: t }),
    );
    await mod!.completeIdempotentRequest(live, 201, { id: 'kept' });

    heldOrThrow(
      await mod!.claimIdempotencyKey({
        key: `${RUN}-sweep-trigger`, address: addr(13), route: ROUTE, body: '{}', now: t,
      }),
    );

    const remaining = await pool!.query<{ address: string; response_body: { id: string } }>(
      'SELECT address, response_body FROM agent_requests WHERE key = $1',
      [key],
    );
    expect(remaining.rowCount).toBe(1);
    expect(remaining.rows[0]?.address).toBe(live.address);
    expect(remaining.rows[0]?.response_body.id).toBe('kept');
  });

  it('leaves an unexpired row of the sweeping address alone', async () => {
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

describeSql('the address on the claim', () => {
  it('is the normalised form, so a completion cannot miss its own row', async () => {
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

    const retry = await mod!.claimIdempotencyKey({
      key, address: shortened, route: ROUTE, body: '{}',
    });
    expect(retry).toEqual({ kind: 'replay', status: 201, body: { id: 'p1' } });
  });
});
