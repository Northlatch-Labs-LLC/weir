// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { formatSuiShort } from './units';

export const MIN_STAKE_MIST = 1_000_000_000n;

export const LADDER_DEPTH = 6n;

export const RUNGS = LADDER_DEPTH + 1n;

export const FULL_LADDER_MIST = RUNGS * MIN_STAKE_MIST;

export function rungSize(totalPrincipalMist: bigint): bigint {
  const even = totalPrincipalMist / RUNGS;
  return even < MIN_STAKE_MIST ? MIN_STAKE_MIST : even;
}

export type LadderHealth =
  | { kind: 'idle'; shortfallMist: bigint }
  /**
   * Enough to stake, not enough to fill the ladder.
   *
   * `rungs` is how many one-SUI rungs this balance can build, out of `RUNGS`.
   */
  | { kind: 'partial'; rungs: bigint; shortfallMist: bigint }
  /** Every rung fundable, so one matures each epoch and yield is continuous. */
  | { kind: 'full' };

export function ladderHealth(totalPrincipalMist: bigint): LadderHealth {
  if (totalPrincipalMist < MIN_STAKE_MIST) {
    return { kind: 'idle', shortfallMist: MIN_STAKE_MIST - totalPrincipalMist };
  }
  if (totalPrincipalMist < FULL_LADDER_MIST) {
    return {
      kind: 'partial',
      rungs: totalPrincipalMist / MIN_STAKE_MIST,
      shortfallMist: FULL_LADDER_MIST - totalPrincipalMist,
    };
  }
  return { kind: 'full' };
}

export const sui = formatSuiShort;
