// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import 'server-only';
import { opaqueDetail } from './opaque';
/**
 * Who has tipped a creator, and how much, from the chain's own record.
 *
 * # Why events, and why lifetime totals
 *
 * A tip mints nothing. `creator::tip` settles the payment and increments a counter — there is no
 * object in the giver's wallet to hold up as proof. What there is, permanently, is a
 * `PaymentSettled` event carrying the vault, the payer and the gross. Summing those is the only
 * way to know who has supported a creator without changing the contract.
 *
 * The event carries no timestamp, so "tipped this month" is not a question this can answer. It
 * answers "has ever tipped, and how much in total" — which is also the kinder question: a
 * supporter's standing here only ever grows.
 *
 * # The ceiling, and why a partial tally is stated rather than hidden
 *
 * The walk is bounded. Beyond the ceiling the tally is **incomplete and understated**, never
 * overstated — an unseen tip can only add. That asymmetry is what makes the result safe to use:
 *
 *   - a supporter who *reaches* a threshold in this window has genuinely paid it, and qualifies;
 *   - a supporter who does not may simply have tipped outside the window.
 *
 * So `truncated` must reach the interface. A page that renders "you do not qualify" from a partial
 * tally is telling somebody they did not pay when they may well have.
 */
import { cache } from 'react';
import { createClient, fail, ok, type Reading } from '@projectx-social/sdk';
import { siteConfig } from './chain';

/** `creator.move`: `const KIND_TIP: u8 = 3`. Pinned by `test/supporters.test.ts`. */
export const KIND_TIP = 3;

/** Ten pages of fifty. A ceiling that does not depend on a caller parameter. */
const MAX_PAGES = 10;
const PAGE = 50;

export interface Supporters {
  /** Lower-cased payer address → total tipped to this vault, in the coin's smallest unit. */
  totals: ReadonlyMap<string, bigint>;
  /** The ceiling stopped the walk: totals are a lower bound, not a complete tally. */
  truncated: boolean;
}

function asBigint(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  // gRPC returns u64 as a decimal string; anything else is not a number we will guess at.
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  return null;
}

/**
 * Fold one `PaymentSettled` event into a running tally. Exported for its test: the shape of an
 * event body is a boundary nothing type-checks, so it gets a test of its own.
 */
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
  // The gross, not the creator's net: what the supporter gave is what earns them standing.
  const gross = asBigint(event['gross']);
  if (gross === null || gross <= 0n) return false;
  const who = payer.toLowerCase();
  totals.set(who, (totals.get(who) ?? 0n) + gross);
  return true;
}

/** Everyone who has tipped one creator vault, within the ceiling. */
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
      // The last permitted page still had more behind it: say so.
      if (page === MAX_PAGES - 1) truncated = true;
    }
    return ok({ totals, truncated });
  } catch (error) {
    return fail('transport', source, opaqueDetail(source, error));
  }
});

export interface Standing {
  /** What this address has given this creator, within the ceiling. */
  given: bigint;
  /** The tally is a lower bound — an unseen tip can only add to it. */
  partial: boolean;
}

/**
 * One address's standing with one creator.
 *
 * `null` for a reader who is not signed in, or whose address could not be resolved — the caller
 * renders the perks without a qualification state rather than guessing at one.
 */
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
