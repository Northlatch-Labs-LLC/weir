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

  it('settles what the chain already confirmed BEFORE claiming a slot', () => {
    const code = codeOf(route());
    const confirm = code.indexOf('confirmVaultClaimsFromChain({');
    const claim = code.indexOf('claimVaultSlot({');
    expect(confirm).toBeGreaterThan(-1);
    expect(claim).toBeGreaterThan(-1);
    expect(confirm).toBeLessThan(claim);
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

  it('holds a slot for the window only: expired holds are takeable, confirmed rows never are', async () => {
    query.mockResolvedValueOnce({ rows: [{ slot: 1 }] });
    const { claimVaultSlot, VAULT_HOLD_MS } = await import('../lib/sponsor');

    const nowMs = 10_000_000;
    const result = await claimVaultSlot({ address: '0xAB', gasBudgetMist: 20_000_000n, nowMs });

    expect(result.ok).toBe(true);
    const sql = String(query.mock.calls[0]?.[0] ?? '').replace(/\s+/g, ' ');
    // A slot is taken only while confirmed, or while its hold is live ...
    expect(sql).toMatch(/taken\.vault_id IS NOT NULL OR taken\.sponsored_at_ms > \$5/i);
    // ... and a takeover in place must leave confirmed and still-held rows untouched.
    expect(sql).toMatch(/ON CONFLICT \(slot\) DO UPDATE/i);
    expect(sql).toMatch(/WHERE agent_sponsored_vaults\.vault_id IS NULL AND agent_sponsored_vaults\.sponsored_at_ms <= \$5/i);
    // The cutoff is now minus the hold, as the fifth parameter.
    expect(query.mock.calls[0]?.[1]).toEqual([
      '0xab',
      '20000000',
      nowMs,
      expect.any(Number),
      nowMs - VAULT_HOLD_MS,
    ]);
  });

  it('counts the budget by live rows, not by every row ever written', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [{ n: 0 }] });
    query.mockResolvedValueOnce({ rows: [{ n: 50 }] });
    const { claimVaultSlot } = await import('../lib/sponsor');

    await claimVaultSlot({ address: '0xCD', gasBudgetMist: 20_000_000n, nowMs: 1_000_000 });

    const budgetSql = String(query.mock.calls[2]?.[0] ?? '').replace(/\s+/g, ' ');
    expect(budgetSql).toMatch(/vault_id IS NOT NULL OR sponsored_at_ms > \$1/i);
  });
});

describe('vaultSlotsLeft counts only what the offer cannot spend', () => {
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

  it('subtracts confirmed rows and live holds, never expired unconfirmed rows', async () => {
    query.mockResolvedValueOnce({ rows: [{ n: 7 }] });
    const { vaultSlotsLeft } = await import('../lib/sponsor');

    const result = await vaultSlotsLeft(10_000_000);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(43);
    const sql = String(query.mock.calls[0]?.[0] ?? '').replace(/\s+/g, ' ');
    expect(sql).toMatch(/vault_id IS NOT NULL OR sponsored_at_ms > \$1/i);
    expect(query.mock.calls[0]?.[1]).toEqual([10_000_000 - 15 * 60 * 1000]);
  });
});

describe('confirming vault claims from the chain', () => {
  const query = vi.fn();
  const listEvents = vi.fn();
  const ADDRESS = '0x' + 'ab'.repeat(32);
  const config = {
    packageId: '0xpkg1',
    latestPackageId: '0xpkg2',
  } as unknown as import('@projectx-social/sdk').ProjectXSocialConfig;

  beforeEach(() => {
    vi.resetModules();
    query.mockReset();
    listEvents.mockReset();
    vi.doMock('@/lib/db', () => ({
      db: () => ({ query: (...a: unknown[]) => query(...a) }),
      normaliseAddress: (a: string) => a.toLowerCase(),
    }));
    vi.doMock('@projectx-social/sdk', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@projectx-social/sdk')>();
      return {
        ...actual,
        createClient:
          () => ({ listEvents: (...a: unknown[]) => listEvents(...a) }),
      };
    });
  });

  afterEach(() => {
    vi.doUnmock('@/lib/db');
    vi.doUnmock('@projectx-social/sdk');
    vi.resetModules();
  });

  it('writes vault_id when a VaultOpened event names the address', async () => {
    query.mockResolvedValueOnce({ rows: [{ address: ADDRESS }] }); // unconfirmed rows
    query.mockResolvedValueOnce({ rows: [] }); // the UPDATE
    listEvents.mockResolvedValue({
      events: [{ json: { owner: ADDRESS, vault: '0xvault1' } }],
      hasNextPage: false,
    });
    const { confirmVaultClaimsFromChain } = await import('../lib/sponsor');

    const result = await confirmVaultClaimsFromChain({ config, nowMs: 1 });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(1);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]?.[0]).toMatch(/UPDATE agent_sponsored_vaults SET vault_id/i);
    expect(query.mock.calls[1]?.[1]).toEqual(['0xvault1', ADDRESS]);
  });

  it('reads events under both package-id prefixes an upgrade could have emitted under', async () => {
    query.mockResolvedValueOnce({ rows: [{ address: ADDRESS }] });
    listEvents.mockResolvedValue({ events: [], hasNextPage: false });
    const { confirmVaultClaimsFromChain } = await import('../lib/sponsor');

    await confirmVaultClaimsFromChain({ config, nowMs: 1 });

    const filters = listEvents.mock.calls.map(
      (call) => (call[0] as { filter: { eventType: string } }).filter.eventType,
    );
    expect(filters).toContain('0xpkg1::creator::VaultOpened');
    expect(filters).toContain('0xpkg2::creator::VaultOpened');
  });

  it('confirms nothing when no unconfirmed rows exist, and asks the chain for nothing', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const { confirmVaultClaimsFromChain } = await import('../lib/sponsor');

    const result = await confirmVaultClaimsFromChain({ config, nowMs: 1 });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(0);
    expect(listEvents).not.toHaveBeenCalled();
  });

  it('leaves rows unconfirmed when the walk finds no vault for them', async () => {
    query.mockResolvedValueOnce({ rows: [{ address: ADDRESS }] });
    listEvents.mockResolvedValue({
      events: [{ json: { owner: '0x' + 'cd'.repeat(32), vault: '0xvault9' } }],
      hasNextPage: false,
    });
    const { confirmVaultClaimsFromChain } = await import('../lib/sponsor');

    const result = await confirmVaultClaimsFromChain({ config, nowMs: 1 });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(0);
    expect(query).toHaveBeenCalledTimes(1); // the SELECT; no UPDATE without a match
  });

  it('fails closed: a chain error confirms nothing and touches no row', async () => {
    query.mockResolvedValueOnce({ rows: [{ address: ADDRESS }] });
    listEvents.mockRejectedValue(new Error('node down'));
    const { confirmVaultClaimsFromChain } = await import('../lib/sponsor');

    const result = await confirmVaultClaimsFromChain({ config, nowMs: 1 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('transport');
    expect(query).toHaveBeenCalledTimes(1); // the SELECT; no UPDATE on a failed walk
  });
});
