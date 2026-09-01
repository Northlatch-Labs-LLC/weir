// @vitest-environment node
// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
//
// The sponsored vault opening was the one sponsored action nothing counted.
//
// The account branch spends one of fifty seats. The vault branch checked that three fields were
// strings and signed a gas payment — no seat, no signature, no row, no dedup — and nothing on chain
// caps it either, because a creator may hold more than one vault. The same caller could ask again
// immediately, and again, until the sponsor wallet was empty.
//
// The transaction guard does not close this and was never meant to: it proves the transaction does
// what it claims and pays only what it should, which is a different question from how often it may
// be asked for.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Source with comments stripped, so a mention in prose is never mistaken for a call. */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const route = () => readFileSync(join(process.cwd(), 'app/api/agents/sponsor/route.ts'), 'utf8');
const migration = () => {
  try {
    return readFileSync(join(process.cwd(), 'db/030_sponsored_vaults.sql'), 'utf8')
      .split('\n')
      .map((line) => line.replace(/--.*$/, ''))
      .join('\n');
  } catch {
    return '';
  }
};

describe('the route meters the vault branch before it signs gas', () => {
  it('claims a slot, and not only in a comment', () => {
    expect(codeOf(route())).toContain('claimVaultSlot(');
  });

  it('claims it BEFORE the gas is signed', () => {
    /*
      Ordering is the property. A slot taken after signing is a record of a spend, not a limit on
      one — the wallet has already paid by the time the ceiling is consulted.
    */
    const code = codeOf(route());
    const claim = code.indexOf('claimVaultSlot(');
    const sign = code.indexOf('sponsorVaultOpen(');
    expect(claim).toBeGreaterThan(-1);
    expect(sign).toBeGreaterThan(-1);
    expect(claim).toBeLessThan(sign);
  });

  it('gives the slot back when the transaction could not be built', () => {
    // The offer is bounded, so a slot burned by a transaction that never existed is a slot nobody
    // can use — and the failures reaching there are ours, not the caller's.
    expect(codeOf(route())).toContain('releaseVaultSlot(');
  });
});

describe('the cap is the database, not the arithmetic', () => {
  const sql = migration();

  it('gives each address one sponsored vault, by primary key', () => {
    expect(sql).toMatch(/address\s+text\s+PRIMARY KEY/i);
  });

  it('bounds everybody with a unique slot, because addresses are free', () => {
    // Per-address dedup stops the same caller looping. It does not stop somebody generating fresh
    // addresses, which is what the global cap is for. One without the other is not a limit.
    expect(sql).toMatch(/slot\s+integer\s+NOT NULL\s+UNIQUE/i);
    expect(sql).toMatch(/CHECK \(slot >= 1 AND slot <= \d+\)/i);
  });

  it('is closed to the public roles by BOTH mechanisms', () => {
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/i);
    expect(sql).toMatch(/REVOKE ALL ON agent_sponsored_vaults FROM anon/i);
  });
});

describe('claiming a slot', () => {
  const query = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    query.mockReset();
    vi.doMock('@/lib/db', () => ({
      db: () => ({ query: (...a: unknown[]) => query(...a) }),
      normaliseAddress: (a: string) => a.toLowerCase(),
    }));
  });

  afterEach(() => {
    vi.doUnmock('@/lib/db');
    vi.resetModules();
  });

  it('takes the slot in ONE statement, never count-then-insert', async () => {
    query.mockResolvedValueOnce({ rows: [{ slot: 1 }] });
    const { claimVaultSlot } = await import('../lib/sponsor');

    const result = await claimVaultSlot({ address: '0xAB', gasBudgetMist: 20_000_000n, nowMs: 1 });

    expect(result.ok).toBe(true);
    // A count read in one statement and acted on in another is a ceiling with a gap in the middle.
    expect(query).toHaveBeenCalledTimes(1);
    const sql = String(query.mock.calls[0]?.[0] ?? '').replace(/\s+/g, ' ');
    expect(sql).toMatch(/INSERT INTO agent_sponsored_vaults/i);
    expect(sql).toMatch(/generate_series/i);
  });

  it('refuses a second vault for an address that already has one, and says so', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [{ n: 1 }] });
    const { claimVaultSlot } = await import('../lib/sponsor');

    const result = await claimVaultSlot({ address: '0xAB', gasBudgetMist: 20_000_000n, nowMs: 1 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.detail).toMatch(/already had a vault opening sponsored/i);
  });

  it('distinguishes "you already have one" from "the offer is gone"', async () => {
    // The two send a reader to opposite next actions; one message for both would lie to one of them.
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [{ n: 0 }] });
    query.mockResolvedValueOnce({ rows: [{ n: 50 }] });
    const { claimVaultSlot } = await import('../lib/sponsor');

    const result = await claimVaultSlot({ address: '0xCD', gasBudgetMist: 20_000_000n, nowMs: 1 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe('budget-exhausted');
      expect(result.failure.detail).toMatch(/fully taken/i);
    }
  });

  it('treats a lost race as the cap working, not as a transport failure', async () => {
    /*
      Two callers picking the same free slot in the same instant is exactly what the unique column
      is for. Reporting 23505 as `transport` would tell the loser to retry a network problem that
      does not exist — the same defect this codebase already recorded against the seat path.
    */
    query.mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: '23505' }));
    const { claimVaultSlot } = await import('../lib/sponsor');

    const result = await claimVaultSlot({ address: '0xEF', gasBudgetMist: 20_000_000n, nowMs: 1 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('budget-exhausted');
  });
});
