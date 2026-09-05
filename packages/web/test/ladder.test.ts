// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * The ladder arithmetic, and the constants it is copied from.
 *
 * # Why the constants are read out of the Move source
 *
 * `MIN_STAKE_MIST`, `LADDER_DEPTH` and `RUNGS` exist in TypeScript only as copies. A stale copy
 * does not throw — it puts a confident number on a screen that the chain disagrees with, which is
 * the worst shape a defect can take on a page about somebody's money. The tier constants are
 * already pinned this way; these were not, and the interface said nothing at all about either
 * threshold.
 *
 * # What the thresholds mean, restated
 *
 * Below one SUI nothing can be delegated, so the deposit earns nothing, for ever, silently. Below
 * seven the rung floors to one SUI and the ladder cannot be filled, so yield arrives in bursts
 * rather than each epoch. Neither is a fault; both are worth saying out loud before somebody
 * chooses an amount.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FULL_LADDER_MIST,
  LADDER_DEPTH,
  MIN_STAKE_MIST,
  RUNGS,
  ladderHealth,
  rungSize,
  sui,
} from '../lib/ladder';

const move = readFileSync(
  join(import.meta.dirname, '../../../sui-contracts/sources/stake_ladder.move'),
  'utf8',
);

/** `const NAME: u64 = 1_000_000_000;` → `1000000000n`. */
function declared(name: string): bigint {
  const match = move.match(new RegExp(`const ${name}: u64 = ([0-9_]+)`));
  if (match?.[1] === undefined) throw new Error(`${name} is not declared in stake_ladder.move`);
  return BigInt(match[1].replace(/_/g, ''));
}

describe('constants mirrored from stake_ladder.move', () => {
  it('matches MIN_STAKE_MIST', () => {
    expect(MIN_STAKE_MIST).toBe(declared('MIN_STAKE_MIST'));
  });

  it('matches LADDER_DEPTH', () => {
    expect(LADDER_DEPTH).toBe(declared('LADDER_DEPTH'));
  });

  it('derives RUNGS the way the contract does', () => {
    // `const RUNGS: u64 = LADDER_DEPTH + 1;` — an expression, so it is checked by construction
    // rather than parsed. What matters is that the relationship is the same one.
    expect(move).toContain('const RUNGS: u64 = LADDER_DEPTH + 1;');
    expect(RUNGS).toBe(LADDER_DEPTH + 1n);
  });
});

describe('rungSize', () => {
  it('floors at the minimum stake, exactly as the contract does', () => {
    // 2 SUI over seven rungs is 0.28 SUI each, which Sui would refuse — so the contract raises it.
    expect(rungSize(2n * MIN_STAKE_MIST)).toBe(MIN_STAKE_MIST);
  });

  it('divides evenly once there is enough to divide', () => {
    expect(rungSize(14n * MIN_STAKE_MIST)).toBe(2n * MIN_STAKE_MIST);
  });

  it('uses integer division, never a float', () => {
    /*
      10 SUI over seven rungs is 1.428571428571… — above the minimum, so the even split wins and the
      remainder is truncated rather than rounded. Truncating is what `u64` does, and it matters:
      rounding up would size every rung slightly beyond what the vault holds.
    */
    expect(rungSize(10n * MIN_STAKE_MIST)).toBe(1_428_571_428n);
  });
});

describe('ladderHealth', () => {
  it('calls a sub-minimum balance idle, and says what it is short by', () => {
    // The live case: 0.5 SUI, parked and earning nothing with nothing anywhere saying so.
    const health = ladderHealth(500_000_000n);
    expect(health.kind).toBe('idle');
    if (health.kind === 'idle') expect(health.shortfallMist).toBe(500_000_000n);
  });

  it('treats exactly the minimum as able to stake', () => {
    // A boundary worth pinning: `<` rather than `<=` is the difference between a vault that works
    // and one told it never will.
    expect(ladderHealth(MIN_STAKE_MIST).kind).toBe('partial');
  });

  it('counts the rungs a partial balance can actually build', () => {
    const health = ladderHealth(3n * MIN_STAKE_MIST);
    expect(health.kind).toBe('partial');
    if (health.kind === 'partial') {
      expect(health.rungs).toBe(3n);
      expect(health.shortfallMist).toBe(4n * MIN_STAKE_MIST);
    }
  });

  it('calls a full ladder full at exactly seven', () => {
    expect(FULL_LADDER_MIST).toBe(7n * MIN_STAKE_MIST);
    expect(ladderHealth(FULL_LADDER_MIST).kind).toBe('full');
    expect(ladderHealth(FULL_LADDER_MIST - 1n).kind).toBe('partial');
  });

  it('stays full above seven', () => {
    expect(ladderHealth(1_000n * MIN_STAKE_MIST).kind).toBe('full');
  });
});

describe('formatting', () => {
  it('renders whole and fractional SUI without a float', () => {
    expect(sui(MIN_STAKE_MIST)).toBe('1');
    expect(sui(500_000_000n)).toBe('0.5');
    expect(sui(0n)).toBe('0');
    expect(sui(1_234_567_890n)).toBe('1.2345');
  });
});
