// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';
import { opaqueDetail } from './opaque';

import { createClient, fail, ok, readStakeVault, type Reading } from '@projectx-social/sdk';
import { readVaults, siteConfig } from './chain';
import { normaliseAddress } from './db';

export interface PoolSummary {
  vaultId: string;
  creator: string;
  validator: string;
  totalPrincipalMist: bigint;
  liquidMist: bigint;
  rebateBps: bigint;
  accepting: boolean;
  tranches: number;
}

export interface PoolIndex {
  byCreator: Map<string, PoolSummary>;
  truncated: boolean;
  unreadable: number;
}

const CONCURRENCY = 8;

export function beats(candidate: PoolSummary, held: PoolSummary | undefined): boolean {
  if (held === undefined) return true;
  if (candidate.totalPrincipalMist !== held.totalPrincipalMist) {
    return candidate.totalPrincipalMist > held.totalPrincipalMist;
  }
  return candidate.vaultId < held.vaultId;
}

export async function readPools(): Promise<Reading<PoolIndex>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const walked = await readVaults();
  if (!walked.ok) return walked;

  const client = createClient(config.value);
  const byCreator = new Map<string, PoolSummary>();
  let unreadable = 0;

  const queue = [...walked.value.vaults];

  async function worker(): Promise<void> {
    for (;;) {
      const next = queue.shift();
      if (next === undefined) return;

      const state = await readStakeVault(client, next.vaultId);
      if (!state.ok) {
        unreadable += 1;
        continue;
      }

      const summary: PoolSummary = {
        vaultId: next.vaultId,
        creator: normaliseAddress(state.value.creator),
        validator: state.value.validator,
        totalPrincipalMist: state.value.totalPrincipalMist,
        liquidMist: state.value.liquidMist,
        rebateBps: state.value.rebateBps,
        accepting: state.value.accepting,
        tranches: state.value.tranches.length,
      };

      const held = byCreator.get(summary.creator);
      if (beats(summary, held)) byCreator.set(summary.creator, summary);
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker()));
  } catch (error) {
    return fail(
      'transport',
      'stake vault objects',
      opaqueDetail('building the vault index', error),
    );
  }

  return ok({ byCreator, truncated: walked.value.truncated, unreadable });
}
