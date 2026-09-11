// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';

/**
 * What is actually in each chest.
 *
 * # Why this exists
 *
 * A chest is this platform's tip: `prepareTip` settles the whole coin into the creator's vault and
 * takes the platform fee in the same transaction. The chests page listed every creator and rendered
 * every pot as "not measured", with a note explaining that totalling one meant a chain read per
 * creator on a page that lists all of them.
 *
 * That was the right refusal and the wrong conclusion. The pot does not need a read per creator: a
 * tip emits `PaymentSettled`, and one bounded walk of that event carries every tip to every vault
 * on the deployment. The same shape `lib/pools.ts` uses for stake vaults — walk once, index by the
 * thing the page is keyed on.
 *
 * # A partial total is a wrong total
 *
 * The walk is bounded, because an unbounded `while (hasNextPage)` in this estate once issued 99,616
 * RPC calls against a budget of twelve. When the ceiling stops it, `truncated` is set and the caller
 * must render the pots as unmeasured rather than as figures.
 *
 * That is not caution for its own sake. Events are paged in one direction; a truncated walk has
 * *some* tips and cannot say which creators' are missing. Showing the subtotal would understate a
 * real pot by an unknown amount, and understating what a creator has received — on the page whose
 * whole argument is that the money is visible — is worse than saying we could not count.
 *
 * # Zero is a real answer
 *
 * # The amounts are minor units, and the scale is the vault's
 *
 * `gross` is in whatever coin the vault holds. Nothing here divides or formats: a six-decimal total
 * printed against a nine-decimal coin is wrong by a thousand, which is the defect this repo keeps a
 * scale guard for. The caller formats each pot against its own vault's `CoinMetadata`.
 */

import { createClient, classify, fail, ok, type Reading } from '@projectx-social/sdk';
import { siteConfig } from './chain';

/** `KIND_TIP` in `creator.move`. Subscriptions, renewals and unlocks are 1, 2 and 4. */
const KIND_TIP = 3;

/**
 * How many pages of events to walk.
 *
 * Twenty pages of fifty is a thousand settled payments. Higher than the referral walk's ceiling
 * because this one is totalling money rather than sampling it, and low enough that a busy day
 * cannot turn one page render into a sustained load on a public fullnode.
 */
const MAX_PAGES = 20;

export interface ChestPot {
  vaultId: string;
  /** Tips only, in the vault's own minor units. Never formatted here — see the note above. */
  totalMinor: bigint;
  /** How many tips landed. A zero-value tip is still a tip and is counted. */
  gifts: number;
  /** Distinct payers. One person giving five times is one giver. */
  givers: number;
}

export interface ChestIndex {
  /** Vault id → its pot. A vault with no tips is absent, which is a measured zero. */
  byVault: Map<string, ChestPot>;
  /** True when the ceiling stopped the walk. Every total is then a subtotal and must not be shown. */
  truncated: boolean;
}

export async function readChestPots(): Promise<Reading<ChestIndex>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const source = 'PaymentSettled events';
  const client = createClient(config.value);
  const eventType = `${config.value.packageId}::creator::PaymentSettled`;

  const byVault = new Map<string, ChestPot>();
  /** Payers per vault, so "givers" counts people rather than payments. */
  const payers = new Map<string, Set<string>>();
  let truncated = false;
  let cursor: string | null = null;

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
        if (e === undefined) continue;

        /*
          Only tips. A subscription and an unlock settle through the same event and are money the
          creator earned by selling something — a chest is the one place on Weir where money leaves
          the giver for good and buys nothing, and folding the others in would quietly restate the
          whole page's claim.
        */
        if (Number(e['kind']) !== KIND_TIP) continue;

        const vault = e['vault'];
        const payer = e['payer'];
        if (typeof vault !== 'string' || typeof payer !== 'string') {
          // A tip we cannot attribute must not be silently dropped into some other vault's total,
          // and must not be added to a figure presented as complete.
          return fail('malformed', source, 'a settled payment did not name its vault and payer');
        }

        /*
          `gross`, not `creator_net`. The pot is what supporters have given; the platform's cut is
          disclosed separately on the page, beside the rate read from the Platform object. Totalling
          the net here would understate what people gave and quietly hide the fee inside a figure
          labelled as generosity.
        */
        const gross = BigInt(String(e['gross'] ?? '0'));

        const held = byVault.get(vault);
        if (held === undefined) {
          byVault.set(vault, { vaultId: vault, totalMinor: gross, gifts: 1, givers: 0 });
          payers.set(vault, new Set([payer]));
        } else {
          held.totalMinor += gross;
          held.gifts += 1;
          payers.get(vault)?.add(payer);
        }
      }

      if (result.hasNextPage !== true) break;
      cursor = result.endCursor ?? null;
      if (cursor === null || page === MAX_PAGES - 1) {
        truncated = true;
        break;
      }
    }
  } catch (error) {
    const failure = classify(error, source);
    return fail(failure.kind, source, failure.detail);
  }

  for (const [vault, set] of payers) {
    const pot = byVault.get(vault);
    if (pot !== undefined) pot.givers = set.size;
  }

  return ok({ byVault, truncated });
}
