import 'server-only';
// Built-by: @projectx.sui · Co-authored-by: Claude

/**
 * Everything one address has pooled behind other people.
 *
 * # Why this exists
 *
 * The product's central claim is that backing a creator costs you nothing: your SUI stays yours,
 * it earns while it sits there, the earnings are theirs, and you take the principal back whenever
 * you like. Until now there was nowhere to see that. `readPosition` answers for ONE vault and the
 * reader had to already know which — so somebody who had backed three creators had no page that
 * said so, and no way to see their own money without visiting each creator in turn and remembering.
 *
 * # One walk, then a bounded fan-out
 *
 * The same shape `lib/pools.ts` uses, for the same reason. `readVaults()` walks `StakeVaultOpened`
 * once; that is the index of every vault the package has opened. This then reads THIS address's
 * position in each of them, eight at a time.
 *
 * # Failure is per row, never per page
 *
 * A vault whose position could not be read is counted in `unreadable` and left out of the rows, so
 * one slow validator cannot turn somebody's whole balance into "not measured". The event walk is
 * different: if that fails there is no index at all and the entire reading fails, because an empty
 * list must never be mistaken for "you have backed nobody".
 *
 * `truncated` says the event ceiling stopped the walk. When it is true this is SOME of what the
 * reader has backed, not all of it, and the page has to say so — a total that silently omits a
 * position is worse than no total.
 */

import { createClient, fail, ok, readStakePosition, type Reading } from '@projectx-social/sdk';
import { readVaults, siteConfig } from './chain';
import { readVault, type StakeVaultView } from './stake';
import { normaliseAddress } from './db';

export interface BackingRow {
  vaultId: string;
  /** The creator this vault belongs to, normalised so it joins against `profiles.owner`. */
  creator: string;
  /** Their handle when this deployment knows the vault, `null` when the chain is all we have. */
  handle: string | null;
  /** Always redeemable one for one. The no-loss guarantee, as a number. */
  principalMist: bigint;
  /** Accrued and unclaimed, as of the vault's last write — not as of now. */
  pendingRebateMist: bigint;
  /** The creator's chosen share of yield. Zero is a real answer, not an absence. */
  rebateBps: bigint;
  /** False when the creator has closed the vault to new deposits. Withdrawals are unaffected. */
  accepting: boolean;
}

export interface BackingIndex {
  /** Largest position first, so the money the reader most wants to see is at the top. */
  rows: BackingRow[];
  totalPrincipalMist: bigint;
  totalPendingRebateMist: bigint;
  /** True when the event ceiling stopped the walk: these are some positions, not all. */
  truncated: boolean;
  /** Vaults found in events whose position could not be read. */
  unreadable: number;
}

/**
 * How many position reads run at once.
 *
 * Eight, matching `lib/pools.ts`. An unbounded fan-out over every vault on the platform is a
 * thundering herd at one public fullnode, and the failure mode is that node rate-limiting
 * everything this deployment does — including checkout, which is the request that actually matters.
 */
const CONCURRENCY = 8;

export async function readBacking(who: string): Promise<Reading<BackingIndex>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const index = await readVaults();
  // No index means no answer. Never an empty list: "we could not look" and "you have backed
  // nobody" are different facts and only one of them is disappointing.
  if (!index.ok) return index;

  const client = createClient(config.value);
  const depositor = normaliseAddress(who);
  const ids = index.value.vaults.map((v) => v.vaultId);

  const rows: BackingRow[] = [];
  let unreadable = 0;

  for (let start = 0; start < ids.length; start += CONCURRENCY) {
    const batch = ids.slice(start, start + CONCURRENCY);
    const settled = await Promise.all(
      batch.map(async (vaultId): Promise<{ vault: StakeVaultView; principalMist: bigint; pendingRebateMist: bigint } | null | 'unreadable'> => {
        const vault = await readVault(vaultId);
        if (!vault.ok) return 'unreadable';
        const position = await readStakePosition(client, vault.value.positionsTableId, depositor);
        if (!position.ok) return 'unreadable';
        // `null` inside an ok is "nothing deposited here", which is not a row and not a failure.
        if (position.value === null || position.value.principalMist === 0n) return null;
        return {
          vault: vault.value,
          principalMist: position.value.principalMist,
          pendingRebateMist: position.value.pendingRebateMist,
        };
      }),
    );

    for (const entry of settled) {
      if (entry === 'unreadable') {
        unreadable += 1;
        continue;
      }
      if (entry === null) continue;
      rows.push({
        vaultId: entry.vault.vaultId,
        creator: normaliseAddress(entry.vault.creator),
        handle: entry.vault.handle,
        principalMist: entry.principalMist,
        pendingRebateMist: entry.pendingRebateMist,
        rebateBps: entry.vault.rebateBps,
        accepting: entry.vault.accepting,
      });
    }
  }

  rows.sort((a, b) => (b.principalMist === a.principalMist ? a.vaultId.localeCompare(b.vaultId) : b.principalMist > a.principalMist ? 1 : -1));

  return ok({
    rows,
    totalPrincipalMist: rows.reduce((total, r) => total + r.principalMist, 0n),
    totalPendingRebateMist: rows.reduce((total, r) => total + r.pendingRebateMist, 0n),
    truncated: index.value.truncated,
    unreadable,
  });
}

/** Kept so a caller that wants to explain a failure has the same vocabulary as the rest of `lib`. */
export const BACKING_SOURCE = 'StakeVaultOpened events, then one position read per vault';

export function noBacking(): BackingIndex {
  return { rows: [], totalPrincipalMist: 0n, totalPendingRebateMist: 0n, truncated: false, unreadable: 0 };
}

export { fail };
