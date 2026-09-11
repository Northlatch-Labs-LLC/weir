// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { describe, expect, it } from 'vitest';
import {
  decideHarvest,
  isMatured,
  ladderCaptureBps,
  nextActionableEpoch,
  stakedThisEpoch,
  LADDER_DEPTH,
  MAX_TRANCHES,
  MIN_STAKE_MIST,
  type Tranche,
  type VaultSnapshot,
} from '../src/domain/harvest.js';

const VAULT = '0x1111111111111111111111111111111111111111111111111111111111111111';

function tranche(activationEpoch: bigint, principalMist = 10n * MIN_STAKE_MIST): Tranche {
  return { activationEpoch, principalMist };
}

function snapshot(overrides: Partial<VaultSnapshot> = {}): VaultSnapshot {
  return {
    vaultId: VAULT,
    tranches: [],
    liquidMist: 0n,
    totalPrincipalMist: 0n,
    ...overrides,
  };
}

describe('isMatured', () => {
  it('matures at exactly activation + LADDER_DEPTH', () => {
    const t = tranche(100n);
    expect(isMatured(t, 100n + LADDER_DEPTH - 1n)).toBe(false);
    expect(isMatured(t, 100n + LADDER_DEPTH)).toBe(true);
    expect(isMatured(t, 100n + LADDER_DEPTH + 1n)).toBe(true);
  });

  it('is not matured during its own activation epoch', () => {
    expect(isMatured(tranche(100n), 100n)).toBe(false);
  });

  it('reproduces the live mainnet numbers', () => {
    expect(isMatured(tranche(1209n), 1214n)).toBe(false);
    expect(isMatured(tranche(1209n), 1215n)).toBe(true);
  });
});

describe('stakedThisEpoch', () => {
  it('detects a stake created during this epoch by its future activation', () => {
    expect(stakedThisEpoch([tranche(101n)], 100n)).toBe(true);
  });

  it('does not fire on tranches from earlier epochs', () => {
    expect(stakedThisEpoch([tranche(100n), tranche(99n)], 100n)).toBe(false);
  });

  it('sees a third party’s stake exactly as it sees our own', () => {
    expect(stakedThisEpoch([tranche(1220n)], 1219n)).toBe(true);
  });

  it('is false for an empty ladder', () => {
    expect(stakedThisEpoch([], 100n)).toBe(false);
  });
});

describe('decideHarvest — when to act', () => {
  it('acts on a matured tranche', () => {
    const s = snapshot({ tranches: [tranche(100n)], totalPrincipalMist: 10n * MIN_STAKE_MIST });
    expect(decideHarvest(s, 106n)).toEqual({ act: true, reason: 'matured-tranche' });
  });

  it('acts on idle principal with nothing matured', () => {
    const s = snapshot({ liquidMist: MIN_STAKE_MIST, totalPrincipalMist: MIN_STAKE_MIST });
    expect(decideHarvest(s, 100n)).toEqual({ act: true, reason: 'idle-principal' });
  });

  it('reports the steady state as both', () => {
    const s = snapshot({
      tranches: [tranche(100n)],
      liquidMist: MIN_STAKE_MIST,
      totalPrincipalMist: 11n * MIN_STAKE_MIST,
    });
    expect(decideHarvest(s, 106n)).toEqual({ act: true, reason: 'matured-and-idle' });
  });

  it('still harvests a matured tranche at the tranche cap', () => {
    const tranches = Array.from({ length: MAX_TRANCHES }, () => tranche(100n));
    const s = snapshot({ tranches, totalPrincipalMist: 100n * MIN_STAKE_MIST });
    expect(decideHarvest(s, 106n).act).toBe(true);
  });
});

describe('decideHarvest — when to stay put', () => {
  it('does not submit a pointless harvest after staking this epoch', () => {
    const s = snapshot({
      tranches: [tranche(101n)],
      liquidMist: 50n * MIN_STAKE_MIST,
      totalPrincipalMist: 50n * MIN_STAKE_MIST,
    });
    expect(decideHarvest(s, 100n)).toEqual({ act: false, reason: 'already-staked-this-epoch' });
  });

  it('does not act on an empty vault', () => {
    expect(decideHarvest(snapshot(), 100n)).toEqual({ act: false, reason: 'empty-vault' });
  });

  it('does not act on dust below Sui’s minimum stake', () => {
    const s = snapshot({
      tranches: [tranche(100n)],
      liquidMist: MIN_STAKE_MIST - 1n,
      totalPrincipalMist: 10n * MIN_STAKE_MIST,
    });
    expect(decideHarvest(s, 105n)).toEqual({ act: false, reason: 'nothing-to-stake' });
  });

  it('reports the tranche cap distinctly from an ordinary skip', () => {
    const tranches = Array.from({ length: MAX_TRANCHES }, (_, i) => tranche(BigInt(90 + i)));
    const s = snapshot({
      tranches,
      liquidMist: 50n * MIN_STAKE_MIST,
      totalPrincipalMist: 200n * MIN_STAKE_MIST,
    });
    expect(decideHarvest(s, 95n)).toEqual({ act: false, reason: 'tranche-cap-reached' });
  });

  it('exactly the minimum stake is enough', () => {
    const s = snapshot({ liquidMist: MIN_STAKE_MIST, totalPrincipalMist: MIN_STAKE_MIST });
    expect(decideHarvest(s, 100n).act).toBe(true);
  });
});

describe('the decision is stable under a third party acting between ticks', () => {
  it('treats someone else’s harvest as a non-event', () => {
    const before = snapshot({ tranches: [tranche(100n)], totalPrincipalMist: 10n * MIN_STAKE_MIST });
    expect(decideHarvest(before, 106n).act).toBe(true);

    const after = snapshot({
      tranches: [tranche(107n)],
      liquidMist: 0n,
      totalPrincipalMist: 10n * MIN_STAKE_MIST,
    });

    expect(decideHarvest(after, 106n)).toEqual({ act: false, reason: 'already-staked-this-epoch' });
  });
});

describe('nextActionableEpoch', () => {
  it('is the earliest maturity across the ladder', () => {
    const s = snapshot({ tranches: [tranche(110n), tranche(100n), tranche(105n)] });
    expect(nextActionableEpoch(s)).toBe(100n + LADDER_DEPTH);
  });

  it('is null for an empty ladder rather than a misleading number', () => {
    expect(nextActionableEpoch(snapshot())).toBeNull();
  });
});

describe('ladderCaptureBps', () => {
  it('reports full capture for a converged ladder', () => {
    const rungs = Number(LADDER_DEPTH) + 1;
    const s = snapshot({ tranches: Array.from({ length: rungs }, (_, i) => tranche(BigInt(i))) });
    expect(ladderCaptureBps(s)).toBe(10_000);
  });

  it('reports a collapsed ladder as visibly degraded', () => {
    const s = snapshot({ tranches: [tranche(1209n)] });
    expect(ladderCaptureBps(s)).toBe(1_428);
  });

  it('is zero for an empty ladder', () => {
    expect(ladderCaptureBps(snapshot())).toBe(0);
  });
});
