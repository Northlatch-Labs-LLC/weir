// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bcs } from '@mysten/sui/bcs';
import {
  decodeStakeVault,
  POSITION_BCS_FIELDS,
  ACC_SCALE,
  claimableRebateMist,
  STAKED_SUI_BYTES,
  STAKE_VAULT_BCS_FIELDS,
} from '../src/stakevault.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCES = resolve(HERE, '../../../sui-contracts/sources');

function moveSource(module: string): string {
  return readFileSync(resolve(SOURCES, `${module}.move`), 'utf8');
}

function constantOf(source: string, name: string): bigint {
  const match = new RegExp(`const\\s+${name}\\s*:\\s*\\w+\\s*=\\s*([0-9_]+)\\s*;`).exec(source);
  if (match?.[1] === undefined) {
    throw new Error(`constant ${name} not found in the Move source — renamed or removed`);
  }
  return BigInt(match[1].replace(/_/g, ''));
}

describe('the daemon mirrors the ladder constants', () => {
  const ladder = moveSource('stake_ladder');

  it('the one-rung-per-epoch rule still reads `> current_epoch`', () => {
    expect(ladder).toContain('stake_activation_epoch() > current_epoch');
  });
});

describe('the StakeVault BCS layout matches the Move struct', () => {
  it('declares the same fields in the same order', () => {
    const source = moveSource('stake_vault');
    const body = /public struct StakeVault has key \{([\s\S]*?)\n\}/.exec(source)?.[1];
    expect(body, 'could not find `public struct StakeVault` — renamed or reshaped').toBeDefined();

    const fields = [...body!.matchAll(/^\s{4}([a-z_][a-z0-9_]*)\s*:/gm)].map((m) => m[1]!);
    expect(fields).toEqual([...STAKE_VAULT_BCS_FIELDS]);
  });
});

describe('the decoder reads a synthetic vault correctly', () => {
  function encode(options: {
    id: string;
    tranches: Array<{ epoch: bigint; principal: bigint }>;
    liquid: bigint;
    totalPrincipal: bigint;
  }): Uint8Array {
    const StakedSui = bcs.struct('StakedSui', {
      id: bcs.Address,
      poolId: bcs.Address,
      stakeActivationEpoch: bcs.u64(),
      principal: bcs.u64(),
    });
    const Vault = bcs.struct('StakeVault', {
      id: bcs.Address,
      version: bcs.u64(),
      platform: bcs.Address,
      creator: bcs.Address,
      creatorAccount: bcs.Address,
      feeBpsSnapshot: bcs.u64(),
      rebateBps: bcs.u64(),
      validator: bcs.Address,
      totalPrincipal: bcs.u64(),
      positions: bcs.struct('Table', { id: bcs.Address, size: bcs.u64() }),
      tranches: bcs.vector(StakedSui),
      liquid: bcs.u64(),
      creatorYield: bcs.u64(),
      platformYield: bcs.u64(),
      rebatePool: bcs.u64(),
      accRebatePerUnit: bcs.u128(),
      accepting: bcs.bool(),
      lifetimeYield: bcs.u64(),
      harvests: bcs.u64(),
    });

    const pad = (n: number) => `0x${String(n).repeat(1).padStart(64, '0')}`;
    return Vault.serialize({
      id: options.id,
      version: 1n,
      platform: pad(2),
      creator: pad(3),
      creatorAccount: pad(4),
      feeBpsSnapshot: 290n,
      rebateBps: 500n,
      validator: pad(5),
      totalPrincipal: options.totalPrincipal,
      positions: { id: pad(6), size: 2n },
      tranches: options.tranches.map((t) => ({
        id: pad(7),
        poolId: pad(8),
        stakeActivationEpoch: t.epoch,
        principal: t.principal,
      })),
      liquid: options.liquid,
      creatorYield: 111n,
      platformYield: 222n,
      rebatePool: 333n,
      accRebatePerUnit: 444n,
      accepting: true,
      lifetimeYield: 555n,
      harvests: 7n,
    }).toBytes();
  }

  const VAULT = `0x${'a'.repeat(64)}`;

  const MIN_STAKE_MIST = 1_000_000_000n;

  it('recovers tranche activation epochs and principal', () => {
    const bytes = encode({
      id: VAULT,
      tranches: [
        { epoch: 1209n, principal: 5n * MIN_STAKE_MIST },
        { epoch: 1215n, principal: 3n * MIN_STAKE_MIST },
      ],
      liquid: 2n * MIN_STAKE_MIST,
      totalPrincipal: 10n * MIN_STAKE_MIST,
    });

    const reading = decodeStakeVault(bytes, VAULT);
    expect(reading.ok).toBe(true);
    if (!reading.ok) return;

    expect(reading.value.tranches).toEqual([
      { activationEpoch: 1209n, principalMist: 5n * MIN_STAKE_MIST },
      { activationEpoch: 1215n, principalMist: 3n * MIN_STAKE_MIST },
    ]);
    expect(reading.value.liquidMist).toBe(2n * MIN_STAKE_MIST);
    expect(reading.value.totalPrincipalMist).toBe(10n * MIN_STAKE_MIST);
    expect(reading.value.lifetimeYieldMist).toBe(555n);
    expect(reading.value.harvests).toBe(7n);
    expect(reading.value.accepting).toBe(true);
  });

  it('handles an empty ladder', () => {
    const bytes = encode({ id: VAULT, tranches: [], liquid: 0n, totalPrincipal: 0n });
    const reading = decodeStakeVault(bytes, VAULT);
    expect(reading.ok).toBe(true);
    if (reading.ok) expect(reading.value.tranches).toEqual([]);
  });

  it('one StakedSui serialises to 80 bytes', () => {
    const one = encode({
      id: VAULT,
      tranches: [{ epoch: 1n, principal: 1n }],
      liquid: 0n,
      totalPrincipal: 0n,
    });
    const none = encode({ id: VAULT, tranches: [], liquid: 0n, totalPrincipal: 0n });
    expect(one.length - none.length).toBe(STAKED_SUI_BYTES);
  });

  it('refuses a buffer whose id is not the vault we asked for', () => {
    const bytes = encode({ id: `0x${'b'.repeat(64)}`, tranches: [], liquid: 0n, totalPrincipal: 0n });
    const reading = decodeStakeVault(bytes, VAULT);
    expect(reading.ok).toBe(false);
    if (!reading.ok) expect(reading.failure.kind).toBe('malformed');
  });

  it('refuses a truncated buffer rather than inventing zeros', () => {
    const bytes = encode({ id: VAULT, tranches: [], liquid: 0n, totalPrincipal: 0n });
    const reading = decodeStakeVault(bytes.slice(0, 40), VAULT);
    expect(reading.ok).toBe(false);
  });
});

describe('Position', () => {
  it('declares the same fields in the same order', () => {
    const body = /public struct Position has store \{([\s\S]*?)\n\}/.exec(
      readFileSync(resolve(SOURCES, 'stake_vault.move'), 'utf8'),
    )?.[1];
    expect(body, 'could not find `public struct Position`').toBeDefined();
    const fields = [...body!.matchAll(/^\s{4}([a-z_][a-z0-9_]*)\s*:/gm)].map((m) => m[1]!);
    expect(fields).toEqual([...POSITION_BCS_FIELDS]);
  });

  it('keeps principal redeemable one for one', () => {
    expect(readFileSync(resolve(SOURCES, 'stake_vault.move'), 'utf8')).toContain(
      'Always redeemable one-for-one',
    );
  });
});

describe('the rebate accumulator mirrors the contract', () => {
  it('ACC_SCALE is the Move constant, not a remembered one', () => {
    expect(constantOf(moveSource('stake_vault'), 'ACC_SCALE')).toBe(ACC_SCALE);
  });

  it('claimableRebateMist follows claimable_rebate step for step', () => {
    const source = moveSource('stake_vault');
    expect(source).toMatch(
      /let debt = position\.rebate_debt \+ carried;\s*let entitled = \(\(eligible as u128\) \* vault\.acc_rebate_per_unit\) \/ ACC_SCALE;\s*if \(entitled <= debt\) position\.pending else position\.pending \+ \(\(entitled - debt\) as u64\)/,
    );
    const position = { principalMist: 7_000_000_000n, pendingRebateMist: 3n, rebateDebt: 5n };
    const acc = 123_456_789n;
    const entitled = (position.principalMist * acc) / ACC_SCALE;
    expect(claimableRebateMist(position, acc)).toBe(position.pendingRebateMist + (entitled - position.rebateDebt));
    expect(
      claimableRebateMist({ principalMist: 0n, pendingRebateMist: 3n, rebateDebt: 5n }, acc),
    ).toBe(3n);
  });
});
