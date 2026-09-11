// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';
import { opaqueDetail } from './opaque';

/**
 * Every open stake vault, indexed by the creator who owns it.
 *
 * # Why this exists
 *
 * Two pages — the directory and the treasury table — want a creator's pooled balance and the share of
 * yield they hand back. Both live on a *stake* vault, and a profile does not name one:
 * `profiles.stake_vault_id` was dropped in migration 009 because nothing ever wrote it. The only
 * honest lookup left was `findStakeCaps(owner)`, one chain query per creator, which is why both pages
 * rendered "not measured" on every row.
 *
 * `readVaults()` already walks `StakeVaultOpened` and returns every vault the package has opened, in
 * one paged event read. That is the index. What was missing is the join: the events carry the vault
 * id and its creator, so one walk plus a bounded fan-out of object reads answers a whole page.
 *
 * # Failure is per row, not per page
 *
 * A vault whose object could not be read is absent from the map, and `unreadable` counts how many.
 * The caller renders *that creator* as unmeasured while every other row shows its real figure —
 * instead of one slow validator turning the entire directory into a wall of "not measured".
 *
 * The event walk is different: if that fails there is no index at all, and the whole reading fails so
 * a caller cannot mistake an empty map for "nobody has a vault".
 */

import { createClient, fail, ok, readStakeVault, type Reading } from '@projectx-social/sdk';
import { readVaults, siteConfig } from './chain';
import { normaliseAddress } from './db';

export interface PoolSummary {
  vaultId: string;
  /** The owning creator's address, normalised so it joins against `profiles.owner`. */
  creator: string;
  validator: string;
  totalPrincipalMist: bigint;
  liquidMist: bigint;
  /** The depositor's share of yield, set by the creator. Zero is a real answer, not an absence. */
  rebateBps: bigint;
  accepting: boolean;
  tranches: number;
}

export interface PoolIndex {
  /** Creator address → their vault. A creator running several keeps the largest. */
  byCreator: Map<string, PoolSummary>;
  /** True when the event ceiling stopped the walk: these are some vaults, not all of them. */
  truncated: boolean;
  /** Found in events, but the object could not be read. */
  unreadable: number;
}

/**
 * How many vault reads run at once.
 *
 * An unbounded `Promise.all` over every vault on the platform is a thundering herd at one public
 * fullnode, and the failure mode is the node rate-limiting *everything* this deployment does — not
 * only this page. Eight keeps the page quick while leaving the node room to serve checkout, which is
 * the request that actually matters.
 */
const CONCURRENCY = 8;

/**
 * Which of a creator's vaults the site shows as "their pool".
 *
 * The largest principal, and the lower vault id when two are equal. The tiebreak is the whole
 * point: these reads run concurrently, so a bare `>` left whichever vault arrived first in place
 * and the winner changed between page loads. `>` is a partial order; comparing the id when the
 * principals match makes it total, so the answer no longer depends on who replied first.
 */
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
        // This one vault is unknown. Every other row still gets its real figure.
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

      /*
        A creator may run several vaults. The largest is what a supporter means by "their pool".

        `>` alone is a partial order. Comparing the id when the principals match makes it total, so
        the choice no longer depends on who answered first.
      */
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
