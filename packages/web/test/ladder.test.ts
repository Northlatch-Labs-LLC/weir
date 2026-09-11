// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

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
    expect(move).toContain('const RUNGS: u64 = LADDER_DEPTH + 1;');
    expect(RUNGS).toBe(LADDER_DEPTH + 1n);
  });
});

describe('rungSize', () => {
  it('floors at the minimum stake, exactly as the contract does', () => {
    expect(rungSize(2n * MIN_STAKE_MIST)).toBe(MIN_STAKE_MIST);
  });

  it('divides evenly once there is enough to divide', () => {
    expect(rungSize(14n * MIN_STAKE_MIST)).toBe(2n * MIN_STAKE_MIST);
  });

  it('uses integer division, never a float', () => {
    expect(rungSize(10n * MIN_STAKE_MIST)).toBe(1_428_571_428n);
  });
});

describe('ladderHealth', () => {
  it('calls a sub-minimum balance idle, and says what it is short by', () => {
    const health = ladderHealth(500_000_000n);
    expect(health.kind).toBe('idle');
    if (health.kind === 'idle') expect(health.shortfallMist).toBe(500_000_000n);
  });

  it('treats exactly the minimum as able to stake', () => {
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
