// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';
import { opaqueDetail } from './opaque';
import { cache } from 'react';
import { createClient, fail, ok, type Reading } from '@projectx-social/sdk';
import { siteConfig } from './chain';

export const KIND_TIP = 3;

const MAX_PAGES = 10;
const PAGE = 50;

export interface Supporters {
  totals: ReadonlyMap<string, bigint>;
  truncated: boolean;
}

function asBigint(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  return null;
}

export function creditTip(
  totals: Map<string, bigint>,
  event: Record<string, unknown>,
  vaultId: string,
): boolean {
  if (Number(event['kind']) !== KIND_TIP) return false;
  const vault = event['vault'];
  if (typeof vault !== 'string' || vault.toLowerCase() !== vaultId.toLowerCase()) return false;
  const payer = event['payer'];
  if (typeof payer !== 'string') return false;
  const gross = asBigint(event['gross']);
  if (gross === null || gross <= 0n) return false;
  const who = payer.toLowerCase();
  totals.set(who, (totals.get(who) ?? 0n) + gross);
  return true;
}

export const readSupporters = cache(async (vaultId: string): Promise<Reading<Supporters>> => {
  const config = siteConfig();
  if (!config.ok) return config;
  const source = `supporters of ${vaultId}`;
  try {
    const client = createClient(config.value);
    const totals = new Map<string, bigint>();
    let truncated = false;
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result: {
        events?: Array<{ json?: unknown }>;
        hasNextPage?: boolean;
        endCursor?: string | null;
      } = await client.listEvents({
        filter: { eventType: `${config.value.packageId}::creator::PaymentSettled` },
        limit: PAGE,
        ...(cursor === null ? {} : { cursor }),
      });
      for (const event of result.events ?? []) {
        const json = event.json as Record<string, unknown> | undefined;
        if (json !== undefined) creditTip(totals, json, vaultId);
      }
      if (result.hasNextPage !== true) break;
      cursor = result.endCursor ?? null;
      if (cursor === null) break;
      if (page === MAX_PAGES - 1) truncated = true;
    }
    return ok({ totals, truncated });
  } catch (error) {
    return fail('transport', source, opaqueDetail(source, error));
  }
});

export interface Standing {
  given: bigint;
  partial: boolean;
}

export async function standingOf(
  vaultId: string,
  address: string | null,
): Promise<Reading<Standing> | null> {
  if (address === null) return null;
  const reading = await readSupporters(vaultId);
  if (!reading.ok) return reading;
  return ok({
    given: reading.value.totals.get(address.toLowerCase()) ?? 0n,
    partial: reading.value.truncated,
  });
}
