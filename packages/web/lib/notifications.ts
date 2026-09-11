// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';

/**
 * Notifications.
 *
 * # Money notifications are derived from the chain, not written when the payment happens
 *
 * The obvious design writes a notification row inside the same handler that processes a payment.
 * It is also the one that loses them: the payment settles on chain, the row fails to write, and the
 * creator is never told they were paid. The money is theirs and nothing says so.
 *
 * So payments are read back out of the event log instead. `PaymentSettled` is emitted by the
 * contract itself, carries every leg of the split, and cannot be missed by an application that was
 * restarting — if the payment happened, the notification exists, because they are the same fact.
 * There is nothing to reconcile and no backfill to run.
 *
 * Social notifications — comments, follows, messages — have no chain event, so they come from the
 * store. That asymmetry is honest: those are the ones that can be lost, and none of them is money.
 *
 * # Reading them is signed
 *
 * A notification list is a personal inbox. Most of it is public information (payments and follows
 * are visible on chain and in follower counts), but "who messaged you" is not, and a mixed feed is
 * only as private as its most private entry.
 */

import { classify, createClient, fail, ok, type Reading } from '@projectx-social/sdk';
import { siteConfig } from './chain';
import { commentsOnPostsBy, followsOf, listProfiles, messagesTo } from './content';
import { readScales, UNKNOWN_SCALE, type Scale } from './scale';

/**
 * A payment, from the chain.
 *
 * There is **no timestamp**, and that is a measured fact rather than an omission. `listEvents`
 * returns `checkpoint`, `transactionDigest` and `eventIndex` but no time, and neither the
 * transaction nor its effects carry one either — both were checked. So payments are ordered by
 * checkpoint, which is exact, and displayed against their digest rather than a clock.
 *
 * The alternative was to stamp them with the time this application first read them, merge that
 * into one list with the social events, and sort. That would have produced a feed where every
 * payment appeared to have happened at page-load, ordered confidently and wrongly. A number that
 * looks authoritative and is invented is worse than an absent one.
 */
export interface PaymentNotification {
  /** Orders payments against each other, exactly. Not comparable to a wall clock. */
  checkpoint: bigint;
  /** `subscription`, `renewal`, `tip` or `unlock`, from the event's `kind` field. */
  what: string;
  /** In the vault's coin, smallest units. */
  gross: string;
  creatorNet: string;
  payer: string;
  vaultId: string;
  digest: string;
  /**
   * The vault coin's own decimals, from its `CoinMetadata`.
   *
   * `null` when unread — never a default. These amounts were formatted against a hardcoded six, so
   * a creator paid in a nine-decimal coin saw every payment a thousand times too large in their own
   * notifications.
   */
  decimals: number | null;
  /** Display only, from the type's last segment. */
  symbol: string;
}

/** Everything else. These have real wall-clock times, because the store recorded them. */
export type ActivityNotification =
  | { kind: 'comment'; at: number; postId: string; author: string; text: string }
  | { kind: 'follow'; at: number; follower: string; handle: string }
  | { kind: 'message'; at: number; from: string; preview: string; encrypted: boolean };

/** Payment kinds, mirrored from `creator.move`. Asserted against the source by a drift test. */
const PAYMENT_KIND: Readonly<Record<string, string>> = {
  '1': 'subscription',
  '2': 'renewal',
  '3': 'tip',
  '4': 'unlock',
};

/** Hard ceiling on event pages. Bounded, and a hit ceiling is reported rather than hidden. */
const MAX_PAGES = 5;

export interface NotificationFeed {
  /** Newest first, by checkpoint. */
  payments: PaymentNotification[];
  /** Newest first, by wall clock. */
  activity: ActivityNotification[];
  /** True when the event ceiling stopped the walk — payments are recent, not complete. */
  truncated: boolean;
}

/**
 * Everything that has happened to this address.
 *
 * Returns a `Reading`, so a caller that cannot reach the chain shows "not measured" rather than an
 * empty inbox. An empty inbox and an unreachable node look identical otherwise, and only one of
 * them means nothing happened.
 */
export async function readNotifications(
  address: string,
): Promise<Reading<NotificationFeed>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const me = address.toLowerCase();
  const profiles = await listProfiles();

  // Vaults this address owns. Payments to them are payments to this creator.
  /*
    A page without a vault receives no payments, so it contributes nothing here.

    Filtered before the conversion rather than after, because `BigInt(null)` is `0n` — which would
    put the zero address into this set and silently match payments belonging to nobody.
  */
  const myVaults = new Set(
    profiles
      .filter((p) => p.owner.toLowerCase() === me && p.vaultId !== null)
      .map((p) => `0x${BigInt(p.vaultId as string).toString(16).padStart(64, '0')}`),
  );
  const myHandles = new Set(profiles.filter((p) => p.owner.toLowerCase() === me).map((p) => p.handle));

  /*
    Each of this creator's vaults mapped to its denomination, so a payment can be shown at the right
    scale. Decimals are read once per distinct coin rather than per payment.
  */
  const coinByVault = new Map<string, string | null>(
    profiles
      .filter((p) => p.owner.toLowerCase() === me && p.vaultId !== null)
      .map((p) => [
        `0x${BigInt(p.vaultId as string).toString(16).padStart(64, '0')}`,
        p.coinType ?? null,
      ]),
  );
  const scales = await readScales(coinByVault.values());
  const scaleOf = (vault: string): Scale => {
    const coinType = coinByVault.get(vault) ?? null;
    return coinType === null ? UNKNOWN_SCALE : scales.get(coinType) ?? UNKNOWN_SCALE;
  };

  const payments: PaymentNotification[] = [];
  const activity: ActivityNotification[] = [];
  let truncated = false;

  // --- Money, from the chain ---
  if (myVaults.size > 0) {
    const source = 'PaymentSettled events';
    try {
      const client = createClient(config.value);
      let cursor: string | null = null;

      for (let page = 0; page < MAX_PAGES; page += 1) {
        const result: {
          events?: Array<{ json?: unknown; transactionDigest?: unknown; checkpoint?: unknown }>;
          hasNextPage?: boolean;
          endCursor?: string | null;
        } = await client.listEvents({
          filter: { eventType: `${config.value.packageId}::creator::PaymentSettled` },
          limit: 50,
          ...(cursor === null ? {} : { cursor }),
        });

        for (const event of result.events ?? []) {
          const e = event.json as Record<string, unknown> | undefined;
          if (typeof e?.['vault'] !== 'string') continue;

          const vault = `0x${BigInt(e['vault']).toString(16).padStart(64, '0')}`;
          if (!myVaults.has(vault)) continue;

          payments.push({
            checkpoint: BigInt(String(event.checkpoint ?? '0')),
            what: PAYMENT_KIND[String(e['kind'])] ?? `kind ${String(e['kind'])}`,
            gross: String(e['gross'] ?? '0'),
            creatorNet: String(e['creator_net'] ?? '0'),
            payer: String(e['payer'] ?? ''),
            vaultId: vault,
            digest: String(event.transactionDigest ?? ''),
            ...scaleOf(vault),
          });
        }

        if (result.hasNextPage !== true) break;
        cursor = result.endCursor ?? null;
        if (cursor === null) {
          truncated = true;
          break;
        }
        if (page === MAX_PAGES - 1) truncated = true;
      }
    } catch (error) {
      const failure = classify(error, source);
      // The chain half failed. Returning the social half alone would show a creator an inbox with
      // no payments in it, which is indistinguishable from having been paid nothing.
      return fail(failure.kind, source, failure.detail);
    }
  }

  /*
    --- Social, from the store ---

    Three narrow queries rather than loading everything and filtering in memory, which is what the
    JSON store forced. Each is capped in SQL, so an inbox does not get slower as the platform grows.
  */
  const handles = [...myHandles];

  for (const c of await commentsOnPostsBy(handles, address)) {
    activity.push({
      kind: 'comment',
      at: c.createdAtMs,
      postId: c.postId,
      author: c.author,
      text: c.text,
    });
  }

  for (const f of await followsOf(handles)) {
    activity.push({ kind: 'follow', at: f.createdAtMs, follower: f.follower, handle: f.handle });
  }

  for (const m of await messagesTo(address)) {
    activity.push({
      kind: 'message',
      at: m.createdAtMs,
      from: m.from,
      // The preview only. A notification must not leak the body of a paid message, and the preview
      // is what the sender chose to show regardless.
      //
      // For an encrypted message there is no preview and this server cannot produce one. It says
      // so with the flag rather than filling the gap with text of its own — a notification is one
      // of the few places a system's voice and a person's are read as the same thing.
      preview: m.preview,
      encrypted: m.encryption !== null,
    });
  }

  // Each list is sorted by the ordering it actually has. They are deliberately not merged.
  payments.sort((a, b) => (b.checkpoint > a.checkpoint ? 1 : b.checkpoint < a.checkpoint ? -1 : 0));
  activity.sort((a, b) => b.at - a.at);

  return ok({ payments, activity, truncated });
}
