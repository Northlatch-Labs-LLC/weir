// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';

/**
 * Who this address referred, and what those referrals have paid it.
 *
 * # Both halves come from chain events, and that is not a preference
 *
 * The obvious design counts referrals in a table this server writes at signup. It is also the one
 * that undercounts: the account is opened on chain, the row fails to write, and a referrer is never
 * credited for someone they genuinely brought. The money is theirs and nothing says so.
 *
 * So both are read from the events the contracts emit. `AccountOpened` carries the referrer, and
 * `PaymentSettled` carries `referral_cut` and the referrer it was paid to. If the signup happened,
 * the referral exists, because they are the same fact. There is nothing to reconcile and no
 * backfill to run.
 *
 * # The share comes out of the platform's cut, never the creator's
 *
 * `referral_share_bps` is a share **of the platform fee**, not of the payment. On a 10 USDC
 * subscription at 290 bps with a 5% share, the platform takes 0.29 and the referrer gets 0.0145 of
 * that — the creator is unaffected either way. This module reports the figure the contract actually
 * paid rather than recomputing it, so a change to the parameter cannot make this page disagree with
 * the chain.
 */

import { classify, createClient, fail, ok, type Reading } from '@projectx-social/sdk';
import { siteConfig } from './chain';

export interface ReferredAccount {
  handle: string;
  owner: string;
  createdAtMs: number;
}

export interface ReferralEarnings {
  /** People who named this address when they registered. */
  referred: ReferredAccount[];
  /**
   * Cumulative `referral_cut` paid to this address, per vault, in that vault's own smallest
   * units.
   *
   * Not summed into one figure here: a referrer can be credited by vaults denominated in
   * different coins, and a SUI cut and a USDC cut added together as raw integers is not a number
   * anything can be scaled by. The caller resolves each vault's coin type and decimals and groups
   * by that — the same join `readChestPots`' callers already do for `byVault`.
   */
  earnedByVault: Map<string, bigint>;
  /** How many payments carried a cut to this address. */
  payments: number;
  /** True when a page ceiling stopped either walk. The figures are recent, not complete. */
  truncated: boolean;
}

/** Hard ceiling per walk. Bounded, not caller-supplied, and a hit ceiling is reported. */
const MAX_PAGES = 5;

const sameAddress = (a: unknown, b: string): boolean =>
  typeof a === 'string' && BigInt(a) === BigInt(b);

export async function readReferrals(address: string): Promise<Reading<ReferralEarnings>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const source = `referrals of ${address}`;
  try {
    const client = createClient(config.value);
    let truncated = false;

    /**
     * Walk one event type, bounded, collecting what a visitor keeps.
     *
     * The ceiling does not depend on a caller parameter — a sibling scanner in this estate once
     * issued 99,616 RPC calls against a budget of 12 because of an unbounded `while (hasNextPage)`.
     */
    const walk = async (eventType: string, visit: (json: Record<string, unknown>) => void) => {
      let cursor: string | null = null;
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
          const json = event.json as Record<string, unknown> | undefined;
          if (json !== undefined) visit(json);
        }

        if (result.hasNextPage !== true) return;
        cursor = result.endCursor ?? null;
        if (cursor === null || page === MAX_PAGES - 1) {
          truncated = true;
          return;
        }
      }
    };

    const referred: ReferredAccount[] = [];
    await walk(`${config.value.packageId}::account::AccountOpened`, (e) => {
      // `referrer` is `Option<address>`, which arrives as the address or null. Anything else is a
      // shape this decoder does not understand, and is skipped rather than guessed at.
      if (!sameAddress(e['referrer'], address)) return;
      if (typeof e['handle'] !== 'string' || typeof e['owner'] !== 'string') return;
      // The timestamp is treated like the two fields above it rather than defaulted. `?? 0` here
      // dated a malformed event to 1970, which sorts to the bottom of the referral list and reads
      // as a real, very old referral — a wrong answer that looks like an answer.
      const createdAtMs = Number(e['created_at_ms']);
      if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) return;
      referred.push({ handle: e['handle'], owner: e['owner'], createdAtMs });
    });

    const earnedByVault = new Map<string, bigint>();
    let payments = 0;
    await walk(`${config.value.packageId}::creator::PaymentSettled`, (e) => {
      if (!sameAddress(e['referrer'], address)) return;
      if (typeof e['vault'] !== 'string') return;
      const cut = BigInt(String(e['referral_cut'] ?? '0'));
      // A settled payment can name a referrer and still carry a zero cut — if the share is set to
      // zero, or the fee rounded to nothing on a very small payment. Counted as a payment either
      // way, because it happened; adding zero to the total is correct and hiding it would not be.
      const priorMist = earnedByVault.get(e['vault']);
      earnedByVault.set(e['vault'], priorMist === undefined ? cut : priorMist + cut);
      payments += 1;
    });

    referred.sort((a, b) => b.createdAtMs - a.createdAtMs);
    return ok({ referred, earnedByVault, payments, truncated });
  } catch (error) {
    const failure = classify(error, source);
    return fail(failure.kind, source, failure.detail);
  }
}
