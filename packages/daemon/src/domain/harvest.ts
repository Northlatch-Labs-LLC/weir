// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

export const LADDER_DEPTH = 6n;

export const MAX_TRANCHES = 16;

export const MIN_STAKE_MIST = 1_000_000_000n;

export interface Tranche {
  activationEpoch: bigint;
  principalMist: bigint;
}

export interface VaultSnapshot {
  vaultId: string;
  tranches: readonly Tranche[];
  liquidMist: bigint;
  totalPrincipalMist: bigint;
}

export type HarvestReason =
  | 'matured-tranche'
  /** Principal is idle and a rung may be staked this epoch. */
  | 'idle-principal'
  /** Both. The common steady-state case: one rung matures, and is immediately restaked. */
  | 'matured-and-idle';

export type SkipReason =
  | 'already-staked-this-epoch'
  /** Nothing matured, and there is less than Sui's minimum stake sitting idle. */
  | 'nothing-to-stake'
  /** Nothing matured, and the ladder is at its tranche ceiling. Principal stays liquid. */
  | 'tranche-cap-reached'
  /** The vault holds no principal at all. */
  | 'empty-vault'
  /**
   * The vault could not be read, so no decision was made about it at all.
   *
   * Distinct from `empty-vault` on purpose, and the distinction is the whole reason this member
   * exists. A read failure used to be journalled as `empty-vault` — a measured fact about a vault
   * nobody could measure. The two are opposite in what they should cause: an empty vault is the
   * steady state and needs nobody, an unreadable one means this daemon is not seeing part of the
   * estate and somebody should find out why. Aggregated by reason, the first buries the second.
   *
   * This reason never comes from `decideHarvest`, which cannot be reached without a state to
   * decide on. It is written by `engine.ts` for the vault whose read failed, alongside the real
   * error text.
   */
  | 'unreadable';

export type HarvestDecision =
  | { readonly act: true; readonly reason: HarvestReason }
  | { readonly act: false; readonly reason: SkipReason };

export function isMatured(tranche: Tranche, currentEpoch: bigint): boolean {
  return tranche.activationEpoch + LADDER_DEPTH <= currentEpoch;
}

export function stakedThisEpoch(
  tranches: readonly Tranche[],
  currentEpoch: bigint,
): boolean {
  return tranches.some((t) => t.activationEpoch > currentEpoch);
}

export function decideHarvest(
  snapshot: VaultSnapshot,
  currentEpoch: bigint,
): HarvestDecision {
  const hasMatured = snapshot.tranches.some((t) => isMatured(t, currentEpoch));

  const canStake =
    !stakedThisEpoch(snapshot.tranches, currentEpoch) &&
    snapshot.tranches.length < MAX_TRANCHES &&
    snapshot.liquidMist >= MIN_STAKE_MIST;

  if (hasMatured && canStake) return { act: true, reason: 'matured-and-idle' };
  if (hasMatured) return { act: true, reason: 'matured-tranche' };
  if (canStake) return { act: true, reason: 'idle-principal' };

  if (snapshot.totalPrincipalMist === 0n && snapshot.tranches.length === 0) {
    return { act: false, reason: 'empty-vault' };
  }
  if (snapshot.tranches.length >= MAX_TRANCHES) {
    return { act: false, reason: 'tranche-cap-reached' };
  }
  if (stakedThisEpoch(snapshot.tranches, currentEpoch)) {
    return { act: false, reason: 'already-staked-this-epoch' };
  }
  return { act: false, reason: 'nothing-to-stake' };
}

export function nextActionableEpoch(snapshot: VaultSnapshot): bigint | null {
  if (snapshot.tranches.length === 0) return null;

  let earliest: bigint | null = null;
  for (const tranche of snapshot.tranches) {
    const matures = tranche.activationEpoch + LADDER_DEPTH;
    if (earliest === null || matures < earliest) earliest = matures;
  }
  return earliest;
}

export function ladderCaptureBps(snapshot: VaultSnapshot): number {
  const rungs = Number(LADDER_DEPTH) + 1;
  const occupied = Math.min(snapshot.tranches.length, rungs);
  if (occupied === 0) return 0;
  return Math.floor((occupied / rungs) * 10_000);
}
