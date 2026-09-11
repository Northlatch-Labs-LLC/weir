// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { fold, type Reading } from '@projectx-social/sdk';
import { decideHarvest, ladderCaptureBps, type HarvestDecision } from './domain/harvest.js';
import type { StakeVaultState } from './adapters/vault.js';

export const MAX_VAULTS_PER_TICK = 200;

export interface EnginePorts {
  readEpoch(): Promise<Reading<bigint>>;
  readVault(vaultId: string): Promise<Reading<StakeVaultState>>;
  simulateAndHarvest(vaultId: string): Promise<Reading<string>>;
}

export interface VaultOutcome {
  vaultId: string;
  decision: HarvestDecision;
  digest?: string;
  error?: string;
  captureBps?: number;
}

export interface TickResult {
  epoch: bigint;
  harvested: VaultOutcome[];
  skipped: VaultOutcome[];
  failed: VaultOutcome[];
  truncated: boolean;
}

export async function tick(
  ports: EnginePorts,
  vaultIds: readonly string[],
): Promise<Reading<TickResult>> {
  const epochReading = await ports.readEpoch();
  if (!epochReading.ok) return epochReading;
  const epoch = epochReading.value;

  const truncated = vaultIds.length > MAX_VAULTS_PER_TICK;
  const batch = vaultIds.slice(0, MAX_VAULTS_PER_TICK);

  const harvested: VaultOutcome[] = [];
  const skipped: VaultOutcome[] = [];
  const failed: VaultOutcome[] = [];

  for (const vaultId of batch) {
    const vaultReading = await ports.readVault(vaultId);

    const state = fold<StakeVaultState, StakeVaultState | null>(
      vaultReading,
      (value) => value,
      (failure) => {
        failed.push({
          vaultId,
          decision: { act: false, reason: 'unreadable' },
          error: `${failure.kind}: ${failure.detail}`,
        });
        return null;
      },
    );
    if (state === null) continue;

    const decision = decideHarvest(state, epoch);
    const captureBps = ladderCaptureBps(state);

    if (!decision.act) {
      skipped.push({ vaultId, decision, captureBps });
      continue;
    }

    const submitted = await ports.simulateAndHarvest(vaultId);
    fold(
      submitted,
      (digest) => harvested.push({ vaultId, decision, digest, captureBps }),
      (failure) =>
        failed.push({
          vaultId,
          decision,
          captureBps,
          error: `${failure.kind}: ${failure.detail}`,
        }),
    );
  }

  return {
    ok: true,
    value: { epoch, harvested, skipped, failed, truncated },
    observedAtMs: Date.now(),
  };
}
