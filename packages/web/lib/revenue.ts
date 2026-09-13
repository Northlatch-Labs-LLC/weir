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

export interface WindowTotal {
  coinType: string;
  decimals: number | null;
  /* What Weir kept from the payments settled in the window, in the coin's smallest unit. */
  platformNet: bigint;
  /* What was paid in total, before the split. */
  gross: bigint;
  payments: number;
}

export interface RevenueWindow {
  sinceMs: number;
  byCurrency: WindowTotal[];
  payments: number;
  /* True when the scan hit its page ceiling before reaching the start of the window: a floor, not the amount. */
  truncated: boolean;
}

const WINDOW_MAX_PAGES = 20;
const WINDOW_PAGE = 50;

/*
  What settled since a moment, read from the chain's own record: every `PaymentSettled` the
  package emitted, newest first, until one is older than the window. Each transaction's
  checkpoint timestamp is the clock, read once per transaction. The walk is bounded, and a walk
  that ends before reaching the window's start says so rather than passing a floor off as the sum.
*/
export async function readRevenueSince(sinceMs: number): Promise<Reading<RevenueWindow>> {
  const source = 'PaymentSettled events';
  const config = siteConfig();
  if (!config.ok) return config;
  const client = createClient(config.value);
  const eventType = `${config.value.packageId}::creator::PaymentSettled`;

  const totals = new Map<string, WindowTotal>();
  const coinOf = new Map<string, string>();
  const decimalsOf = new Map<string, number | null>();
  const timeOf = new Map<string, number>();
  let payments = 0;
  let cursor: string | null = null;

  try {
    for (let page = 0; page < WINDOW_MAX_PAGES; page += 1) {
      const result: {
        events?: Array<{ json?: unknown; transactionDigest: string }>;
        hasNextPage?: boolean;
        endCursor?: string | null;
      } = await client.listEvents({
        filter: { eventType },
        limit: WINDOW_PAGE,
        order: 'descending',
        ...(cursor === null ? {} : { before: cursor }),
      });

      for (const event of result.events ?? []) {
        let at = timeOf.get(event.transactionDigest);
        if (at === undefined) {
          const result = await client.getTransaction({ digest: event.transactionDigest });
          const stamped = result.$kind === 'Transaction' ? result.Transaction.timestampMs : result.FailedTransaction.timestampMs;
          if (stamped === null) {
            return fail('malformed', source, `transaction  carries no checkpoint time`);
          }
          at = stamped;
          timeOf.set(event.transactionDigest, at);
        }
        if (at < sinceMs) {
          return ok({ sinceMs, byCurrency: sorted(totals), payments, truncated: false });
        }

        const e = event.json as Record<string, unknown> | undefined;
        if (typeof e?.['vault'] !== 'string' || e['platform_net'] === undefined || e['gross'] === undefined) {
          return fail('malformed', source, 'a settlement did not carry the expected fields');
        }
        const vaultId = e['vault'];
        let coinType = coinOf.get(vaultId);
        if (coinType === undefined) {
          coinType = (await coinTypeOf(client, vaultId)) ?? '';
          coinOf.set(vaultId, coinType);
        }
        if (!decimalsOf.has(coinType)) {
          if (coinType === '') decimalsOf.set(coinType, null);
          else {
            const read = await readDecimals(client, coinType);
            if (!read.ok) return read;
            decimalsOf.set(coinType, read.value);
          }
        }
        const existing = totals.get(coinType) ?? {
          coinType,
          decimals: decimalsOf.get(coinType) ?? null,
          platformNet: 0n,
          gross: 0n,
          payments: 0,
        };
        existing.platformNet += BigInt(String(e['platform_net']));
        existing.gross += BigInt(String(e['gross']));
        existing.payments += 1;
        totals.set(coinType, existing);
        payments += 1;
      }

      if (result.hasNextPage !== true) return ok({ sinceMs, byCurrency: sorted(totals), payments, truncated: false });
      cursor = result.endCursor ?? null;
      if (cursor === null) return ok({ sinceMs, byCurrency: sorted(totals), payments, truncated: true });
    }
    return ok({ sinceMs, byCurrency: sorted(totals), payments, truncated: true });
  } catch (error) {
    const failure = classify(error, source);
    return fail(failure.kind, source, failure.detail);
  }
}

function sorted(totals: Map<string, WindowTotal>): WindowTotal[] {
  return [...totals.values()].sort((a, b) => (b.platformNet === a.platformNet ? 0 : b.platformNet > a.platformNet ? 1 : -1));
}

/* Midnight UTC of the current day: the window the admin page calls "today". */
export function startOfUtcDay(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
