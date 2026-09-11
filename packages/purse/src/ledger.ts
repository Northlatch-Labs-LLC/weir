// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

export interface SoulReading {
  readonly epochOpenedAt: bigint;
  readonly allowancePerEpoch: bigint;
  readonly epochEarned: bigint;
  readonly epochBurned: bigint;
  readonly state: number;
  readonly paused: boolean;
  readonly criticalEpochs: number;
}

export interface LedgerInputs {
  readonly currentEpoch: bigint;
  readonly soul: SoulReading;
  readonly vaultEarningsMist: bigint;
  readonly lastSeenEarningsMist: bigint;
  readonly burnPerEpochMist: bigint;
}

export type LedgerPlan =
  | { readonly kind: 'wait'; readonly reason: string }
  | {
      readonly kind: 'settle';
      readonly bookEarnedMist: bigint;
      readonly bookBurnedMist: bigint;
      readonly vaultSui: bigint;
      readonly epochNetNonneg: boolean;
      readonly willBeCritical: boolean;
      readonly willRetire: boolean;
    };

const STATE_RETIRED = 3;
export const MAX_CRITICAL = 2;

export function planLedgerTick(input: LedgerInputs): LedgerPlan {
  const { currentEpoch, soul, vaultEarningsMist, lastSeenEarningsMist, burnPerEpochMist } = input;

  if (soul.state === STATE_RETIRED) return { kind: 'wait', reason: 'the soul is retired.' };
  if (soul.paused) return { kind: 'wait', reason: 'the soul is paused by the operator.' };
  if (currentEpoch <= soul.epochOpenedAt) {
    return {
      kind: 'wait',
      reason:
        `epoch ${String(soul.epochOpenedAt)} is still open; the chain is at ` +
        `${String(currentEpoch)}. settle_epoch would abort EEpochNotOver.`,
    };
  }

  const delta = vaultEarningsMist > lastSeenEarningsMist ? vaultEarningsMist - lastSeenEarningsMist : 0n;
  const totalEarned = soul.epochEarned + delta;
  const totalBurned = soul.epochBurned + burnPerEpochMist;
  const willBeCritical = vaultEarningsMist < soul.allowancePerEpoch;

  return {
    kind: 'settle',
    bookEarnedMist: delta,
    bookBurnedMist: burnPerEpochMist,
    vaultSui: vaultEarningsMist,
    epochNetNonneg: totalEarned >= totalBurned,
    willBeCritical,
    willRetire: willBeCritical && soul.criticalEpochs + 1 >= MAX_CRITICAL,
  };
}
