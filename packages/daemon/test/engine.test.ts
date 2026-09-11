// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { describe, expect, it } from 'vitest';
import { ok, fail, type Reading } from '@projectx-social/sdk';
import { tick, MAX_VAULTS_PER_TICK, type EnginePorts } from '../src/engine.js';
import { MIN_STAKE_MIST } from '../src/domain/harvest.js';
import type { StakeVaultState } from '../src/adapters/vault.js';

function vaultState(overrides: Partial<StakeVaultState> = {}): StakeVaultState {
  return {
    vaultId: '0x1',
    version: 1n,
    accRebatePerUnit: 0n,
    tranches: [],
    liquidMist: 0n,
    totalPrincipalMist: 0n,
    creator: '0xc',
    validator: '0xv',
    accepting: true,
    creatorYieldMist: 0n,
    platformYieldMist: 0n,
    rebatePoolMist: 0n,
    lifetimeYieldMist: 0n,
    harvests: 0n,
    feeBpsSnapshot: 290n,
    rebateBps: 0n,
    positionsTableId: '0xp',
    ...overrides,
  };
}

function ports(options: {
  epoch?: Reading<bigint>;
  vaults?: Record<string, Reading<StakeVaultState>>;
  submit?: (id: string) => Reading<string>;
  onSubmit?: (id: string) => void;
}): EnginePorts {
  return {
    readEpoch: async () => options.epoch ?? ok(1000n),
    readVault: async (id) =>
      options.vaults?.[id] ?? ok(vaultState({ vaultId: id })),
    simulateAndHarvest: async (id) => {
      options.onSubmit?.(id);
      return options.submit?.(id) ?? ok(`digest-${id}`);
    },
  };
}

describe('tick', () => {
  it('harvests a vault with idle principal', async () => {
    const submitted: string[] = [];
    const result = await tick(
      ports({
        vaults: {
          '0xa': ok(
            vaultState({
              vaultId: '0xa',
              liquidMist: MIN_STAKE_MIST,
              totalPrincipalMist: MIN_STAKE_MIST,
            }),
          ),
        },
        onSubmit: (id) => submitted.push(id),
      }),
      ['0xa'],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.harvested).toHaveLength(1);
    expect(result.value.harvested[0]!.digest).toBe('digest-0xa');
    expect(submitted).toEqual(['0xa']);
  });

  it('submits nothing for a vault with nothing to do', async () => {
    const submitted: string[] = [];
    const result = await tick(ports({ onSubmit: (id) => submitted.push(id) }), ['0xa']);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.skipped).toHaveLength(1);
    expect(result.value.skipped[0]!.decision.reason).toBe('empty-vault');
    expect(submitted).toEqual([]);
  });

  it('keeps going when one vault cannot be read', async () => {
    const result = await tick(
      ports({
        vaults: {
          '0xbad': fail('transport', 'StakeVault 0xbad', 'connection refused'),
          '0xgood': ok(
            vaultState({
              vaultId: '0xgood',
              liquidMist: MIN_STAKE_MIST,
              totalPrincipalMist: MIN_STAKE_MIST,
            }),
          ),
        },
      }),
      ['0xbad', '0xgood'],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.failed).toHaveLength(1);
    expect(result.value.harvested).toHaveLength(1);
  });

  it('records an unreadable vault as unreadable, not as empty', async () => {
    const result = await tick(
      ports({ vaults: { '0xbad': fail('transport', 'StakeVault 0xbad', 'connection refused') } }),
      ['0xbad'],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.failed[0]!.decision.reason).toBe('unreadable');
    expect(result.value.failed[0]!.decision.reason).not.toBe('empty-vault');
  });

  it('still carries the real error alongside the reason', async () => {
    const result = await tick(
      ports({ vaults: { '0xbad': fail('transport', 'StakeVault 0xbad', 'connection refused') } }),
      ['0xbad'],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.failed[0]!.error).toContain('connection refused');
    expect(result.value.failed[0]!.error).toContain('transport');
  });

  it('still calls a genuinely empty vault empty', async () => {
    const result = await tick(ports({}), ['0xa']);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.skipped[0]!.decision.reason).toBe('empty-vault');
  });

  it('reports an unreadable vault as failed, never as skipped', async () => {
    const result = await tick(
      ports({ vaults: { '0xbad': fail('timeout', 'StakeVault 0xbad', 'deadline exceeded') } }),
      ['0xbad'],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.skipped).toHaveLength(0);
    expect(result.value.failed).toHaveLength(1);
    expect(result.value.failed[0]!.error).toContain('timeout');
  });

  it('records a submission failure without losing the decision', async () => {
    const result = await tick(
      ports({
        vaults: {
          '0xa': ok(
            vaultState({
              vaultId: '0xa',
              liquidMist: MIN_STAKE_MIST,
              totalPrincipalMist: MIN_STAKE_MIST,
            }),
          ),
        },
        submit: () => fail('transport', 'harvest', 'simulation failed'),
      }),
      ['0xa'],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.harvested).toHaveLength(0);
    expect(result.value.failed).toHaveLength(1);
    expect(result.value.failed[0]!.decision.act).toBe(true);
  });

  it('fails the whole tick when the epoch cannot be read', async () => {
    const result = await tick(
      ports({ epoch: fail('transport', 'current epoch', 'node unreachable') }),
      ['0xa'],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.source).toBe('current epoch');
  });
});

describe('bounds', () => {
  it('stops at the ceiling and flags the result as partial', async () => {
    const ids = Array.from({ length: MAX_VAULTS_PER_TICK + 5 }, (_, i) => `0x${i}`);
    const seen: string[] = [];
    const result = await tick(ports({ onSubmit: (id) => seen.push(id) }), ids);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.truncated).toBe(true);
    expect(result.value.skipped).toHaveLength(MAX_VAULTS_PER_TICK);
  });

  it('does not flag a complete pass as partial', async () => {
    const result = await tick(ports({}), ['0xa', '0xb']);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.truncated).toBe(false);
  });
});
