// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { describe, expect, it, vi, beforeEach } from 'vitest';

const readVaults = vi.fn();
const readVault = vi.fn();
const readStakePosition = vi.fn();

vi.mock('@/lib/chain', () => ({
  readVaults: (...args: unknown[]) => readVaults(...args),
  siteConfig: () => ({ ok: true, value: { network: 'mainnet', packageId: '0x1', url: 'https://example.invalid' } }),
}));

vi.mock('@/lib/stake', () => ({
  readVault: (...args: unknown[]) => readVault(...args),
}));

vi.mock('@projectx-social/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@projectx-social/sdk')>();
  return {
    ...actual,
    createClient: () => ({}),
    readStakePosition: (...args: unknown[]) => readStakePosition(...args),
  };
});

const { readBacking } = await import('@/lib/backing');

const ADDRESS = '0xda784b6c20c5995f6b719a20a26eddee5ec971c8ecec890e61c8b4634dd1715d';

function vault(id: string, over: Record<string, unknown> = {}) {
  return {
    ok: true,
    value: {
      vaultId: id,
      creator: '0x9f2b41c7d0e8a3b56419f0cd7712ab34e5f6019cbb2d4a780f1c3e5d6a7b8c90',
      handle: 'wren',
      rebateBps: 2000n,
      accepting: true,
      positionsTableId: `${id}-table`,
      ...over,
    },
  };
}

beforeEach(() => {
  readVaults.mockReset();
  readVault.mockReset();
  readStakePosition.mockReset();
});

describe('readBacking', () => {
  it('FAILS when the index cannot be read — never an empty list', async () => {
    readVaults.mockResolvedValue({ ok: false, failure: { kind: 'unreachable', detail: 'node timed out' } });

    const reading = await readBacking(ADDRESS);

    expect(reading.ok).toBe(false);
    expect((reading as { value?: unknown }).value).toBeUndefined();
  });

  it('sums only the vaults this address actually holds a position in', async () => {
    readVaults.mockResolvedValue({
      ok: true,
      value: { vaults: [{ vaultId: '0xa' }, { vaultId: '0xb' }, { vaultId: '0xc' }], truncated: false },
    });
    readVault.mockImplementation(async (id: string) => vault(id));
    readStakePosition.mockImplementation(async (_client: unknown, table: string) => {
      if (table === '0xa-table') return { ok: true, value: { principalMist: 25_000_000_000n, pendingRebateMist: 180_000_000n, rebateDebt: 0n } };
      if (table === '0xb-table') return { ok: true, value: null };
      return { ok: true, value: { principalMist: 60_000_000_000n, pendingRebateMist: 0n, rebateDebt: 0n } };
    });

    const reading = await readBacking(ADDRESS);

    expect(reading.ok).toBe(true);
    if (!reading.ok) return;
    expect(reading.value.rows.map((r) => r.vaultId)).toEqual(['0xc', '0xa']);
    expect(reading.value.totalPrincipalMist).toBe(85_000_000_000n);
    expect(reading.value.totalPendingRebateMist).toBe(180_000_000n);
    expect(reading.value.unreadable).toBe(0);
  });

  it('counts a vault it could not read instead of failing the whole page', async () => {
    readVaults.mockResolvedValue({ ok: true, value: { vaults: [{ vaultId: '0xa' }, { vaultId: '0xb' }], truncated: false } });
    readVault.mockImplementation(async (id: string) =>
      id === '0xb' ? { ok: false, failure: { kind: 'unreachable', detail: 'timeout' } } : vault(id),
    );
    readStakePosition.mockResolvedValue({ ok: true, value: { principalMist: 1_000_000_000n, pendingRebateMist: 0n, rebateDebt: 0n } });

    const reading = await readBacking(ADDRESS);

    expect(reading.ok).toBe(true);
    if (!reading.ok) return;
    expect(reading.value.rows).toHaveLength(1);
    expect(reading.value.unreadable).toBe(1);
  });

  it('carries the truncation flag, so a partial total can be labelled a floor', async () => {
    readVaults.mockResolvedValue({ ok: true, value: { vaults: [{ vaultId: '0xa' }], truncated: true } });
    readVault.mockImplementation(async (id: string) => vault(id));
    readStakePosition.mockResolvedValue({ ok: true, value: { principalMist: 5n, pendingRebateMist: 0n, rebateDebt: 0n } });

    const reading = await readBacking(ADDRESS);

    expect(reading.ok).toBe(true);
    if (!reading.ok) return;
    expect(reading.value.truncated).toBe(true);
  });

  it('treats a zero principal as no position rather than as a row', async () => {
    readVaults.mockResolvedValue({ ok: true, value: { vaults: [{ vaultId: '0xa' }], truncated: false } });
    readVault.mockImplementation(async (id: string) => vault(id));
    readStakePosition.mockResolvedValue({ ok: true, value: { principalMist: 0n, pendingRebateMist: 0n, rebateDebt: 0n } });

    const reading = await readBacking(ADDRESS);

    expect(reading.ok).toBe(true);
    if (!reading.ok) return;
    expect(reading.value.rows).toHaveLength(0);
    expect(reading.value.totalPrincipalMist).toBe(0n);
  });
});
