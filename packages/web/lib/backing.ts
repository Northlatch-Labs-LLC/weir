import 'server-only';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { createClient, fail, ok, readStakePosition, type Reading } from '@projectx-social/sdk';
import { readVaults, siteConfig } from './chain';
import { readVault, type StakeVaultView } from './stake';
import { normaliseAddress } from './db';

export interface BackingRow {
  vaultId: string;
  creator: string;
  handle: string | null;
  principalMist: bigint;
  pendingRebateMist: bigint;
  rebateBps: bigint;
  accepting: boolean;
}

export interface BackingIndex {
  rows: BackingRow[];
  totalPrincipalMist: bigint;
  totalPendingRebateMist: bigint;
  truncated: boolean;
  unreadable: number;
}

const CONCURRENCY = 8;

export async function readBacking(who: string): Promise<Reading<BackingIndex>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const index = await readVaults();
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

export const BACKING_SOURCE = 'StakeVaultOpened events, then one position read per vault';

export function noBacking(): BackingIndex {
  return { rows: [], totalPrincipalMist: 0n, totalPendingRebateMist: 0n, truncated: false, unreadable: 0 };
}

export { fail };
