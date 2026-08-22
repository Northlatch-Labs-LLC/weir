// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import 'server-only';

/**
 * Who may read what — decided from objects on chain, once, in one place.
 *
 * # The one predicate
 *
 * The evidence is a `Subscription` or an `Unlock` object the reader owns. Both are soulbound, so a
 * subscription cannot be lent out for the afternoon and an unlock cannot be resold.
 */

import {
  classify,
  createClient,
  decodeObjectBytes,
  fail,
  ok,
  type ProjectXSocialConfig,
  type Reading,
} from '@projectx-social/sdk';
import { bcs } from '@mysten/sui/bcs';
import { siteConfig } from './chain';
import type { Post } from './content';

/**
 * `entitlement::Subscription`.
 *
 * ```move
 * public struct Subscription has key {
 *     id: UID, vault: ID, subscriber: address, tier: u64,
 *     price_paid: u64, started_at_ms: u64, expires_at_ms: u64, renewals: u64,
 * }
 * ```
 */
const SubscriptionBcs = bcs.struct('Subscription', {
  id: bcs.Address,
  vault: bcs.Address,
  subscriber: bcs.Address,
  tier: bcs.u64(),
  pricePaid: bcs.u64(),
  startedAtMs: bcs.u64(),
  expiresAtMs: bcs.u64(),
  renewals: bcs.u64(),
});

/**
 * `entitlement::Unlock`.
 *
 * ```move
 * public struct Unlock has key {
 *     id: UID, vault: ID, buyer: address,
 *     content_key: vector<u8>, price_paid: u64, purchased_at_ms: u64,
 * }
 * ```
 */
const UnlockBcs = bcs.struct('Unlock', {
  id: bcs.Address,
  vault: bcs.Address,
  buyer: bcs.Address,
  contentKey: bcs.vector(bcs.u8()),
  pricePaid: bcs.u64(),
  purchasedAtMs: bcs.u64(),
});

export interface Entitlements {
  /** Vault ids this reader has an unexpired subscription to. */
  subscribedVaults: Set<string>;
  /** `${vaultId}:${contentKey}` for each unlock held. */
  unlocked: Set<string>;
}

export const NO_ENTITLEMENTS: Entitlements = {
  subscribedVaults: new Set(),
  unlocked: new Set(),
};

/**
 * Read every entitlement a reader holds.
 *
 * Expiry is compared against the wall clock here rather than trusted from a stored flag, matching
 * `entitlement::is_active` in Move: `expires_at_ms` is exclusive, so a subscription is live until
 * the instant it is not. There is no sweep job that flips a status column, and therefore no window
 * in which an expired subscription still reads as active because the sweep has not run.
 *
 * Bounded at one page of each type. A reader with hundreds of subscriptions is not a case worth an
 * unbounded walk on every page render; the ceiling is flagged so the caller knows the set may be
 * partial rather than believing it complete.
 */
export async function readEntitlements(
  reader: string | null,
): Promise<Reading<Entitlements & { truncated: boolean }>> {
  if (reader === null) return ok({ ...NO_ENTITLEMENTS, truncated: false });

  const config = siteConfig();
  if (!config.ok) return config;

  const source = `entitlements of ${reader}`;
  try {
    const client = createClient(config.value);
    const now = BigInt(Date.now());

    const subscribedVaults = new Set<string>();
    const unlocked = new Set<string>();
    let truncated = false;

    /*
      Walk every page, rather than reading one and calling it the answer.

      This took a single page of 50 of each type and set `truncated` when there were more. That was
      honest about being partial, and being honest did not help the reader: `canRead` compares
      against a set that does not contain what they bought, so somebody holding 51 unlocks was
      refused their own content. Reporting a paywall accurately is still reporting a paywall.

      Bounded at `MAX_PAGES`, because this runs on every feed render and an unbounded walk is a
      request that never returns. When the ceiling is genuinely reached `truncated` stays true and
      the callers say so — so the flag now means "there is more than any reader plausibly holds",
      not "we stopped at the first page".
    */
    const MAX_PAGES = 20;

    /**
     * One object type, drained.
     *
     * Resolves `true` when pages ran out before the objects did. A decode failure aborts the whole
     * read rather than skipping the object: an undecodable entitlement is a failure, not an
     * absence, and skipping it would tell a subscriber who paid that they hold nothing, silently,
     * on a page that looks fine.
     */
    const drain = async (
      type: string,
      visit: (bytes: Uint8Array) => void,
    ): Promise<Reading<boolean>> => {
      let cursor: string | null = null;

      for (let page = 0; page < MAX_PAGES; page += 1) {
        const result: {
          objects?: Array<{ content?: unknown }>;
          hasNextPage?: boolean;
          endCursor?: string | null;
        } = await client.listOwnedObjects({
          owner: reader,
          type,
          limit: 50,
          include: { content: true },
          ...(cursor === null ? {} : { cursor }),
        });

        for (const object of result.objects ?? []) {
          const bytes = decodeObjectBytes(object.content, source);
          if (!bytes.ok) return bytes;
          if (bytes.value === null) continue;
          visit(bytes.value);
        }

        if (result.hasNextPage !== true) return ok(false);
        cursor = result.endCursor ?? null;
        // A next page with no cursor to reach it. Truncated, and saying so beats looping.
        if (cursor === null) return ok(true);
      }
      return ok(true);
    };

    const subs = await drain(`${config.value.packageId}::entitlement::Subscription`, (bytes) => {
      const s = SubscriptionBcs.parse(bytes);
      // Exclusive, exactly as the contract compares it.
      if (BigInt(s.expiresAtMs) > now) subscribedVaults.add(normalise(s.vault));
    });
    if (!subs.ok) return subs;
    truncated ||= subs.value;

    const unlocks = await drain(`${config.value.packageId}::entitlement::Unlock`, (bytes) => {
      const u = UnlockBcs.parse(bytes);
      const key = new TextDecoder().decode(Uint8Array.from(u.contentKey));
      unlocked.add(`${normalise(u.vault)}:${key}`);
    });
    if (!unlocks.ok) return unlocks;
    truncated ||= unlocks.value;

    return ok({ subscribedVaults, unlocked, truncated });
  } catch (error) {
    const failure = classify(error, source);
    return fail(failure.kind, source, failure.detail);
  }
}

/**
 * May this reader see this post's body?
 *
 * The single predicate. Everything that gates content calls this and nothing re-implements it.
 *
 * Note what it does **not** do: it never fails open. It takes a resolved `Entitlements` value, so a
 * caller that could not read the chain has to decide what to pass — and the only honest answer
 * there is `NO_ENTITLEMENTS`, which locks the post. A reader is never shown paid content because a
 * node timed out.
 */
export function canRead(post: Post, entitlements: Entitlements): boolean {
  switch (post.access.kind) {
    case 'public':
      return true;
    case 'subscribers':
      return entitlements.subscribedVaults.has(normalise(post.vaultId));
    case 'paid':
      return entitlements.unlocked.has(`${normalise(post.vaultId)}:${post.access.contentKey}`);
  }
}

/** Object ids compare as hex strings; normalise so `0x0a…` and `0xa…` do not differ. */
function normalise(id: string): string {
  return `0x${BigInt(id).toString(16).padStart(64, '0')}`;
}

export type { ProjectXSocialConfig };
