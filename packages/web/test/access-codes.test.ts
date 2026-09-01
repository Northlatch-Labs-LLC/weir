// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Access codes: shape, spending a use, the pass, and the gate's decision.
 *
 * The database is scripted per call, because redemption is two statements whose second depends on
 * the first matching nothing, and a single canned answer cannot express that.
 */
type Result = { rows: unknown[] };
let script: Array<Result | Error> = [];
const queries: Array<{ sql: string; params: unknown[] }> = [];

/*
  Transaction control is recorded and does NOT consume the script.

  Redemption became one transaction — the spend and the pass are one edit, and were two statements.
  Making BEGIN/COMMIT/ROLLBACK draw from the script would have meant rewriting every scripted
  sequence in this file to interleave them, which is a lot of churn to assert nothing. They are
  recorded in `queries` instead, so the tests below can assert the ORDER of the real statements
  against the control ones.
*/
const CONTROL = /^\s*(BEGIN|COMMIT|ROLLBACK)\s*$/i;
let released = 0;

async function run(sql: string, params: unknown[]): Promise<{ rows: unknown[]; rowCount: number }> {
  queries.push({ sql, params });
  if (CONTROL.test(sql)) return { rows: [], rowCount: 0 };
  const next = script.shift();
  if (next === undefined) throw new Error(`unscripted query: ${sql.slice(0, 40)}`);
  if (next instanceof Error) throw next;
  return { ...next, rowCount: next.rows.length };
}

vi.mock('../lib/db', () => ({
  db: () => ({
    query: run,
    connect: async () => ({
      query: run,
      release: () => {
        released += 1;
      },
    }),
  }),
  normaliseAddress: (a: string) => a.toLowerCase(),
}));

const {
  ACCESS_PASS_COOKIE,
  ACCESS_PASS_TTL_MS,
  accessPassCookie,
  generateCode,
  normaliseCode,
  passIsValid,
  passTokenFrom,
  redeemAccessCode,
  statusOf,
} = await import('../lib/access-codes');

beforeEach(() => {
  released = 0;
  script = [];
  queries.length = 0;
  // The pass cache lives on globalThis; each test starts without one.
  delete (globalThis as Record<symbol, unknown>)[Symbol.for('projectx.social.access-pass')];
});
afterEach(() => vi.restoreAllMocks());

const NOW = 1_800_000_000_000;

describe('the code itself', () => {
  it('is twelve symbols in three groups, from an alphabet without 0/O/1/I', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateCode()).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    }
    expect(new Set(Array.from({ length: 50 }, generateCode)).size).toBe(50);
  });

  it('is accepted however it was typed, and refused when it cannot be a code', () => {
    expect(normaliseCode('abcd efgh jklm')).toBe('ABCD-EFGH-JKLM');
    expect(normaliseCode('ABCDEFGHJKLM')).toBe('ABCD-EFGH-JKLM');
    expect(normaliseCode(' abcd-efgh-jklm ')).toBe('ABCD-EFGH-JKLM');
    expect(normaliseCode('ABC')).toBeNull();
    expect(normaliseCode('ABCD-EFGH-JKL0')).toBeNull(); // zero is not in the alphabet
    expect(normaliseCode('ABCD-EFGH-JKLO')).toBeNull();
  });

  it('reports its status in the order the contract of the table implies', () => {
    const base = { code: 'A', label: '', maxUses: 2, uses: 0, expiresAtMs: null, createdBy: 'x', createdAtMs: 0, revokedAtMs: null };
    expect(statusOf(base, NOW)).toBe('live');
    expect(statusOf({ ...base, uses: 2 }, NOW)).toBe('exhausted');
    expect(statusOf({ ...base, expiresAtMs: NOW - 1 }, NOW)).toBe('expired');
    expect(statusOf({ ...base, uses: 2, expiresAtMs: NOW - 1, revokedAtMs: 5 }, NOW)).toBe('revoked');
  });
});

describe('redeeming', () => {
  it('spends one use with a single conditional UPDATE and issues a pass stored as a digest', async () => {
    script = [{ rows: [{ expires_at_ms: null }] }, { rows: [] }, { rows: [] }];
    const outcome = await redeemAccessCode('abcd-efgh-jklm', NOW);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    // Control statements are recorded too, so the real ones are selected rather than counted off
    // by position — an index that shifts when a BEGIN appears is a test about the wrong thing.
    const [spend, insert, sweep] = queries.filter((q) => !CONTROL.test(q.sql));
    expect(spend!.sql).toMatch(/UPDATE access_codes SET uses = uses \+ 1/);
    expect(spend!.sql).toMatch(/uses < max_uses/);
    expect(spend!.params).toEqual(['ABCD-EFGH-JKLM', NOW]);

    expect(insert!.sql).toMatch(/INSERT INTO access_passes/);
    expect(insert!.params[0]).toBeInstanceOf(Buffer);
    expect((insert!.params[0] as Buffer).length).toBe(32);
    expect(insert!.params[1]).toBe('ABCD-EFGH-JKLM');
    expect(insert!.params[3]).toBe(NOW + ACCESS_PASS_TTL_MS);
    expect(outcome.expiresAtMs).toBe(NOW + ACCESS_PASS_TTL_MS);
    expect(outcome.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sweep!.sql).toMatch(/DELETE FROM access_passes/);
  });

  it('spends the use and issues the pass in ONE transaction', async () => {
    /*
      The defect. The UPDATE is atomic on its own — `uses < max_uses` in the WHERE means two callers
      racing for the last use cannot both take it. What was wrong is what happened after: the spend
      committed, and the pass was a separate statement. An instance frozen or killed between them
      left a use permanently consumed from a code with a hard ceiling and no pass to show for it,
      with no compensating delete and nothing to reconcile it.

      On a single-use code handed to one person, that is that person locked out for good.
    */
    script = [{ rows: [{ expires_at_ms: null }] }, { rows: [] }, { rows: [] }];
    await redeemAccessCode('abcd-efgh-jklm', NOW);

    const order = queries.map((q) => (CONTROL.test(q.sql) ? q.sql.trim().toUpperCase() : q.sql.slice(0, 24)));
    const begin = order.indexOf('BEGIN');
    const commit = order.indexOf('COMMIT');
    const spend = order.findIndex((sql) => sql.startsWith('UPDATE access_codes'));
    const insert = order.findIndex((sql) => sql.includes('INSERT INTO access_pa'));

    expect(begin).toBeGreaterThan(-1);
    expect(commit).toBeGreaterThan(-1);
    // Both writes strictly inside, and in that order.
    expect(spend).toBeGreaterThan(begin);
    expect(insert).toBeGreaterThan(spend);
    expect(commit).toBeGreaterThan(insert);
  });

  it('sweeps OUTSIDE the transaction, because housekeeping is not a redemption', async () => {
    script = [{ rows: [{ expires_at_ms: null }] }, { rows: [] }, { rows: [] }];
    await redeemAccessCode('abcd-efgh-jklm', NOW);

    const order = queries.map((q) => q.sql.trim().toUpperCase());
    const commit = order.indexOf('COMMIT');
    const sweep = order.findIndex((sql) => sql.startsWith('DELETE FROM ACCESS_PASSES'));

    expect(sweep).toBeGreaterThan(commit);
  });

  it('undoes the spend when the pass cannot be written', async () => {
    /*
      The whole point of the transaction, asserted from the failure side: a redemption that could
      not issue a pass must not have cost the caller a use. Before this it did, permanently.
    */
    script = [{ rows: [{ expires_at_ms: null }] }, new Error('connection terminated')];

    await expect(redeemAccessCode('abcd-efgh-jklm', NOW)).rejects.toThrow('connection terminated');

    const order = queries.map((q) => q.sql.trim().toUpperCase());
    expect(order).toContain('ROLLBACK');
    expect(order).not.toContain('COMMIT');
  });

  it('rolls back rather than committing when nothing was spent', async () => {
    // An exhausted code writes nothing. Committing an empty transaction would work and would make
    // the two outcomes indistinguishable in a log.
    script = [{ rows: [] }, { rows: [{ revoked_at_ms: null, expires_at_ms: null, uses: 3, max_uses: 3 }] }];

    const outcome = await redeemAccessCode('abcd-efgh-jklm', NOW);

    expect(outcome).toEqual({ ok: false, reason: 'exhausted' });
    expect(queries.map((q) => q.sql.trim().toUpperCase())).toContain('ROLLBACK');
  });

  it('always returns the client, on every path', async () => {
    // A connection kept on a failure is a connection the pool never gets back, and the pool is three.
    script = [{ rows: [] }, { rows: [{ revoked_at_ms: null, expires_at_ms: null, uses: 3, max_uses: 3 }] }];
    await redeemAccessCode('abcd-efgh-jklm', NOW);
    expect(released).toBe(1);

    released = 0;
    script = [{ rows: [{ expires_at_ms: null }] }, new Error('boom')];
    await redeemAccessCode('abcd-efgh-jklm', NOW).catch(() => undefined);
    expect(released).toBe(1);
  });

  it('caps the pass at the code\'s own expiry', async () => {
    const soon = NOW + 1000;
    script = [{ rows: [{ expires_at_ms: String(soon) }] }, { rows: [] }, { rows: [] }];
    const outcome = await redeemAccessCode('ABCD-EFGH-JKLM', NOW);
    expect(outcome.ok && outcome.expiresAtMs).toBe(soon);
  });

  it('says why when it refuses, without spending anything', async () => {
    const refused = async (row: Record<string, unknown> | undefined) => {
      script = [{ rows: [] }, { rows: row === undefined ? [] : [row] }];
      const outcome = await redeemAccessCode('ABCD-EFGH-JKLM', NOW);
      expect(outcome.ok).toBe(false);
      expect(queries.some((q) => /INSERT/.test(q.sql))).toBe(false);
      queries.length = 0;
      return outcome.ok ? null : outcome.reason;
    };
    expect(await refused(undefined)).toBe('unknown');
    expect(await refused({ revoked_at_ms: '1', expires_at_ms: null, uses: 0, max_uses: 1 })).toBe('revoked');
    expect(await refused({ revoked_at_ms: null, expires_at_ms: String(NOW - 1), uses: 0, max_uses: 1 })).toBe('expired');
    expect(await refused({ revoked_at_ms: null, expires_at_ms: null, uses: 3, max_uses: 3 })).toBe('exhausted');
  });

  it('touches nothing for input that cannot be a code', async () => {
    const outcome = await redeemAccessCode('nope', NOW);
    expect(outcome).toEqual({ ok: false, reason: 'malformed' });
    expect(queries).toHaveLength(0);
  });
});

describe('the pass', () => {
  it('is carried in an HttpOnly, Lax cookie with a lifetime, Secure over https', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const header = accessPassCookie({ token: 'tok', expiresAtMs: NOW + 60_000, secure: true });
    expect(header).toContain(`${ACCESS_PASS_COOKIE}=tok`);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
    expect(header).toContain('Max-Age=60');
    expect(header).toContain('Secure');
    expect(accessPassCookie({ token: 'tok', expiresAtMs: NOW + 60_000, secure: false })).not.toContain('Secure');
  });

  it('is read out of the cookie header by name', () => {
    expect(passTokenFrom(`a=1; ${ACCESS_PASS_COOKIE}=abc; b=2`)).toBe('abc');
    expect(passTokenFrom('a=1')).toBeNull();
    expect(passTokenFrom(null)).toBeNull();
  });

  it('is valid only when the join finds it unexpired under an unrevoked code', async () => {
    script = [{ rows: [{ '?column?': 1 }] }];
    expect(await passIsValid('good', NOW)).toBe(true);
    const q = queries[0]!;
    expect(q.sql).toMatch(/JOIN access_codes/);
    expect(q.sql).toMatch(/revoked_at_ms IS NULL/);
    expect(q.sql).toMatch(/expires_at_ms > \$2/);
    expect(q.params[0]).toBeInstanceOf(Buffer);

    script = [{ rows: [] }];
    expect(await passIsValid('stale', NOW)).toBe(false);
  });

  it('fails closed: no token costs no query, and a database error is a refusal', async () => {
    expect(await passIsValid(null, NOW)).toBe(false);
    expect(await passIsValid('', NOW)).toBe(false);
    expect(queries).toHaveLength(0);
    script = [new Error('connection refused')];
    expect(await passIsValid('tok', NOW)).toBe(false);
  });

  it('remembers an answer briefly, so one visitor is one query and a revoke still bites', async () => {
    script = [{ rows: [{ '?column?': 1 }] }];
    expect(await passIsValid('tok', NOW)).toBe(true);
    expect(await passIsValid('tok', NOW + 1000)).toBe(true);
    expect(queries).toHaveLength(1);
    script = [{ rows: [] }];
    expect(await passIsValid('tok', NOW + 6000)).toBe(false);
    expect(queries).toHaveLength(2);
  });
});
