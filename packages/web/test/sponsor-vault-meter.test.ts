// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
    const code = codeOf(route());
    const claim = code.indexOf('claimVaultSlot(');
    const sign = code.indexOf('sponsorVaultOpen(');
    expect(claim).toBeGreaterThan(-1);
    expect(sign).toBeGreaterThan(-1);
    expect(claim).toBeLessThan(sign);
  });

  it('gives the slot back when the transaction could not be built', () => {
    expect(codeOf(route())).toContain('releaseVaultSlot(');
  });
});

describe('the cap is the database, not the arithmetic', () => {
  const sql = migration();

  it('gives each address one sponsored vault, by primary key', () => {
    expect(sql).toMatch(/address\s+text\s+PRIMARY KEY/i);
  });

  it('bounds everybody with a unique slot, because addresses are free', () => {
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
    query.mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: '23505' }));
    const { claimVaultSlot } = await import('../lib/sponsor');

    const result = await claimVaultSlot({ address: '0xEF', gasBudgetMist: 20_000_000n, nowMs: 1 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('budget-exhausted');
  });
});
