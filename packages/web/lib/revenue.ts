// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

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

export interface VaultRevenue {
  vaultId: string;
  coinType: string;
  decimals: number | null;
  uncollected: bigint;
  grossVolume: bigint;
}

export interface CurrencyTotal {
  coinType: string;
  decimals: number | null;
  uncollected: bigint;
  vaults: number;
}

export interface PlatformRevenue {
  vaults: VaultRevenue[];
  byCurrency: CurrencyTotal[];
  truncated: boolean;
}

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

export async function readPlatformRevenue(): Promise<Reading<PlatformRevenue>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const listed = await readCreatorVaultIds();
  if (!listed.ok) return listed;

  const client = createClient(config.value);
  const vaults: VaultRevenue[] = [];
  const decimalsOf = new Map<string, number>();

  for (const vaultId of listed.value.ids) {
    const state = await readCreatorVault(client, vaultId);
    if (!state.ok) return state;

    const coinType = (await coinTypeOf(client, vaultId)) ?? '';

    let decimals: number | null = null;
    if (coinType !== '') {
      const cached = decimalsOf.get(coinType);
      if (cached !== undefined) {
        decimals = cached;
      } else {
        const read = await readDecimals(client, coinType);
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
