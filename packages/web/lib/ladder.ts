// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { formatSuiShort } from './units';

/**
 * Whether a vault's balance is actually able to earn, and what to say when it is not.
 *
 * # The two silences this exists to break
 *
 * Sui will not stake less than one SUI. A vault holding less than that keeps its balance liquid for
 * ever: nothing errors, nothing warns, the harvest daemon correctly declines to act, and the
 * depositor earns exactly nothing. One vault on this deployment has sat at 0.5 SUI doing precisely
 * that, and there was no screen anywhere that would have said so.
 *
 * The second is quieter. A rung is `max(total ÷ RUNGS, MIN_STAKE)`, and the ladder wants `RUNGS` of
 * them so that one matures every epoch. Below `RUNGS × MIN_STAKE` the arithmetic floors to a one
 * SUI rung, so a vault can only build as many rungs as it has whole SUI — yield then arrives in
 * bursts instead of continuously, and the capture rate falls below what the design targets. That is
 * not a fault, and it is exactly the kind of thing somebody wants to know *before* choosing an
 * amount rather than after.
 *
 * # Mirrored constants, pinned against the contract
 *
 * These are copied from `stake_ladder.move`. A stale copy here would put a confident number on a
 * screen that the chain disagrees with, so `test/ladder.test.ts` reads the Move source and fails if
 * they drift — the same discipline the tier constants already use.
 */

/** `stake_ladder::MIN_STAKE_MIST` — Sui's own floor for a single stake. */
export const MIN_STAKE_MIST = 1_000_000_000n;

/** `stake_ladder::LADDER_DEPTH` — epochs a tranche must mature for. */
export const LADDER_DEPTH = 6n;

/** `stake_ladder::RUNGS` — `LADDER_DEPTH + 1`, so exactly one rung matures per epoch. */
export const RUNGS = LADDER_DEPTH + 1n;

/** Below this, the ladder cannot be filled: every rung would floor to the minimum stake. */
export const FULL_LADDER_MIST = RUNGS * MIN_STAKE_MIST;

/** `stake_ladder::rung_size`. Mirrors the contract's integer arithmetic exactly. */
export function rungSize(totalPrincipalMist: bigint): bigint {
  const even = totalPrincipalMist / RUNGS;
  return even < MIN_STAKE_MIST ? MIN_STAKE_MIST : even;
}

/**
 * What a vault of this size can and cannot do.
 *
 * A discriminated union rather than a boolean pair, because the three cases need three different
 * sentences and collapsing any two of them produces a warning that is either alarming or useless.
 */
export type LadderHealth =
  /**
   * Below the minimum stake. Nothing can ever be delegated, so nothing can ever be earned.
   *
   * `shortfallMist` is what it would take to reach the floor — the one number that turns this from
   * a complaint into an action.
   */
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
      // With the rung floored at the minimum, the count is simply how many whole minimums fit.
      rungs: totalPrincipalMist / MIN_STAKE_MIST,
      shortfallMist: FULL_LADDER_MIST - totalPrincipalMist,
    };
  }
  return { kind: 'full' };
}

/**
 * MIST as a short decimal SUI string.
 *
 * Kept under this name because the ladder's callers already use it, but no longer implemented here:
 * eight modules had each written this division out by hand, and they had drifted. One implementation
 * now lives in `lib/units`, and `test/scale-guard.test.ts` fails if a ninth appears.
 */
export const sui = formatSuiShort;
