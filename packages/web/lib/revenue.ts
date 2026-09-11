// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * What the platform has earned, and what it has not collected.
 *
 * # Why this file exists
 *
 * The commission was invisible. `settle` splits it into `platform_fees` inside the vault that
 * charged it and `claim_platform_fees` withdraws it — and nothing in this application ever called
 * that, so every fee the platform has earned is still sitting where it was charged. Nobody noticed
 * because the amounts are small, and the amounts are small because volume is small. That ordering
 * is the problem: the first time it matters is the first time it is expensive.
 *
 * # Why it is per vault rather than one number
 *
 * # Why it is grouped by coin and never summed across coins
 *
 * A vault's coin is its type parameter, so a deployment offering USDC and SUI accrues commission in
 * both. Adding them would be adding dollars to a floating asset and calling the result revenue.
 * Each currency totals on its own and is converted nowhere — this file reports, it does not price.
 */

import {
  classify,
  createClient,
  fail,
  ok,
  readCreatorVault,
  readDecimals,
  type Reading,
} from '@projectx-social/sdk';
import { siteConfig } from './chain';
import { coinTypeOf } from './creator-setup';

/** One vault's contribution to platform revenue. */
export interface VaultRevenue {
  vaultId: string;
  /** The vault's type parameter. Empty only when the tag could not be read. */
  coinType: string;
  /** From the coin's own metadata, never assumed. */
  decimals: number | null;
  /** Commission accrued and still in the vault, in the coin's smallest unit. */
  uncollected: bigint;
  /** Everything that has ever passed through the vault, in the coin's smallest unit. */
  grossVolume: bigint;
}

/** Uncollected commission in one currency. */
export interface CurrencyTotal {
  coinType: string;
  decimals: number | null;
  uncollected: bigint;
  /** How many vaults hold some of it — which is how many transactions collecting it costs. */
  vaults: number;
}

export interface PlatformRevenue {
  vaults: VaultRevenue[];
  /** One entry per coin. Never summed across coins — see the note at the top of this file. */
  byCurrency: CurrencyTotal[];
  /**
   * True when the walk hit its page ceiling, so the list is incomplete.
   *
   * Reported rather than hidden. A revenue figure silently missing the newest vaults is worse than
   * one that says it is partial, because only the second can be acted on.
   */
  truncated: boolean;
}

/**
 * Every creator vault the package has opened, from its events.
 *
 * The event type carries the **original** package id, not the latest. A type tag is minted when the
 * type is first published and an upgrade does not rewrite it, so filtering on `latestPackageId`
 * after an upgrade matches nothing — and returns an empty list rather than an error, which reads as
 * "no vaults" rather than "wrong filter". That is why `packageId` is used here and `latestPackageId`
 * is used to call.
 *
 * Bounded at ten pages, and flagged when the ceiling stops the walk.
 */
export async function readCreatorVaultIds(): Promise<
  Reading<{ ids: string[]; truncated: boolean }>
> {
  const config = siteConfig();
  if (!config.ok) return config;

  const source = 'VaultOpened events';
  const client = createClient(config.value);
  const eventType = `${config.value.packageId}::creator::VaultOpened`;

  const ids: string[] = [];
  let cursor: string | null = null;
  const MAX_PAGES = 10;

  try {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result: {
        events?: Array<{ json?: unknown }>;
        hasNextPage?: boolean;
        endCursor?: string | null;
      } = await client.listEvents({
        filter: { eventType },
        limit: 50,
        ...(cursor === null ? {} : { cursor }),
      });

      for (const event of result.events ?? []) {
        const e = event.json as Record<string, unknown> | undefined;
        if (typeof e?.['vault'] !== 'string') {
          return fail('malformed', source, 'an event did not carry a vault id');
        }
        ids.push(e['vault']);
      }

      if (result.hasNextPage !== true) return ok({ ids, truncated: false });
      cursor = result.endCursor ?? null;
      if (cursor === null) return ok({ ids, truncated: true });
    }
    return ok({ ids, truncated: true });
  } catch (error) {
    const failure = classify(error, source);
    return fail(failure.kind, source, failure.detail);
  }
}

/**
 * Accrued, uncollected commission across every vault.
 *
 * A vault that cannot be read fails the whole reading rather than being skipped. A revenue report
 * that quietly omits the vaults it could not reach understates the number, and an understated total
 * is indistinguishable from there being nothing to collect.
 */
export async function readPlatformRevenue(): Promise<Reading<PlatformRevenue>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const listed = await readCreatorVaultIds();
  if (!listed.ok) return listed;

  const client = createClient(config.value);
  const vaults: VaultRevenue[] = [];
  /*
    Decimals are read once per coin, not once per vault. Every vault of a given coin has the same
    scale by definition, and a metadata read per vault turns a page load into one network round
    trip per creator on the platform.
  */
  const decimalsOf = new Map<string, number>();

  for (const vaultId of listed.value.ids) {
    const state = await readCreatorVault(client, vaultId);
    if (!state.ok) return state;

    // From the vault's own type tag rather than a stored value: a vault with no profile row has no
    // stored coin, and revenue must not depend on the store having caught up.
    const coinType = (await coinTypeOf(client, vaultId)) ?? '';

    let decimals: number | null = null;
    if (coinType !== '') {
      const cached = decimalsOf.get(coinType);
      if (cached !== undefined) {
        decimals = cached;
      } else {
        const read = await readDecimals(client, coinType);
        // Propagated, not defaulted. A wrong scale misreports revenue by orders of magnitude and
        // nothing about the number looks wrong.
        if (!read.ok) return read;
        decimals = read.value;
        decimalsOf.set(coinType, read.value);
      }
    }

    vaults.push({
      vaultId,
      coinType,
      decimals,
      uncollected: state.value.platformFees,
      grossVolume: state.value.grossVolume,
    });
  }

  const totals = new Map<string, CurrencyTotal>();
  for (const vault of vaults) {
    const existing = totals.get(vault.coinType);
    if (existing === undefined) {
      totals.set(vault.coinType, {
        coinType: vault.coinType,
        decimals: vault.decimals,
        uncollected: vault.uncollected,
        vaults: 1,
      });
      continue;
    }
    existing.uncollected += vault.uncollected;
    existing.vaults += 1;
  }

  return ok({
    vaults,
    byCurrency: [...totals.values()].sort((a, b) =>
      b.uncollected === a.uncollected ? 0 : b.uncollected > a.uncollected ? 1 : -1,
    ),
    truncated: listed.value.truncated,
  });
}
