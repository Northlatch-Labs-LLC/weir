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

vi.mock('../lib/db', () => ({
  db: () => ({
    query: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      const next = script.shift();
      if (next === undefined) throw new Error(`unscripted query: ${sql.slice(0, 40)}`);
      if (next instanceof Error) throw next;
      return { ...next, rowCount: next.rows.length };
    },
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

    const [spend, insert, sweep] = queries;
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
