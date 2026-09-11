// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
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
  SEAL_PERIOD_MS,
  type ProjectXSocialConfig,
  type Reading,
} from '@projectx-social/sdk';
import { bcs } from '@mysten/sui/bcs';
import { siteConfig } from './chain';
import type { Post } from './content';
import { machineContentKey } from './machine-pricing';

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
  /**
   * The unlock **object id** behind each key in {@link unlocked}, same key shape.
   *
   * Parsed here all along and then dropped, because the only question this module was asked was
   * yes-or-no. Seal asks a second one: `entitlement::seal_approve_unlock` takes `&Unlock`, an owned
   * object, so a reader opening their own paid media has to *name* the object that entitles them.
   * It cannot be derived from the vault and the content key — those identify the entitlement, not
   * the instance of it — so it is kept rather than re-read on a second pass.
   *
   * Optional so that a hand-built `Entitlements` (a test, {@link NO_ENTITLEMENTS}) stays valid. An
   * absent map is not "no unlocks"; it is "nobody asked for ids", and the sealed path treats it as
   * an error rather than as a denial.
   */
  unlockIds?: Map<string, string>;
  /**
   * Every `Subscription` this reader holds, by normalised vault id, **expired ones included**.
   *
   * Deliberately wider than {@link subscribedVaults}, which keeps only the unexpired and is the
   * right answer to "may they see this post". This answers a different question that the contract
   * asks differently: `seal_approve_subscription` has no `Clock` and grants the periods a
   * subscription *paid for*, whether or not it has since lapsed — because a Seal key cannot be
   * withdrawn, so refusing a lapsed subscriber the key to a period they paid for would punish the
   * person who did not open the app in time and stop nobody else.
   *
   * A reader can hold more than one for a vault: renewal extends the object in place, but
   * subscribing, lapsing and subscribing again mints a second. They are kept as a list, and
   * {@link subscriptionForPeriod} picks the one that actually satisfies the policy.
   *
   * Optional for the same reason as {@link unlockIds}: an absent map means nobody asked, not that
   * nothing is held.
   */
  subscriptions?: Map<string, HeldSubscription[]>;
}

/** One `Subscription` object, in the terms `seal_approve_subscription` judges it by. */
export interface HeldSubscription {
  /** The object id. The key server needs it named — the Move function takes `&Subscription`. */
  objectId: string;
  /** Reads content at this tier and every tier below it. */
  tier: bigint;
  startedAtMs: bigint;
  expiresAtMs: bigint;
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
    const unlockIds = new Map<string, string>();
    const subscriptions = new Map<string, HeldSubscription[]>();
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
      const vault = normalise(s.vault);
      // Exclusive, exactly as the contract compares it.
      if (BigInt(s.expiresAtMs) > now) subscribedVaults.add(vault);
      /*
        Kept whether or not it is live, and this is the one place the two rules diverge on purpose.
        The line above answers "show them the post"; this list answers "can they derive the key for
        the period it was published in", which the contract decides without a clock.
      */
      const held = subscriptions.get(vault) ?? [];
      held.push({
        objectId: normalise(s.id),
        tier: BigInt(s.tier),
        startedAtMs: BigInt(s.startedAtMs),
        expiresAtMs: BigInt(s.expiresAtMs),
      });
      subscriptions.set(vault, held);
    });
    if (!subs.ok) return subs;
    truncated ||= subs.value;

    const unlocks = await drain(`${config.value.packageId}::entitlement::Unlock`, (bytes) => {
      const u = UnlockBcs.parse(bytes);
      const key = new TextDecoder().decode(Uint8Array.from(u.contentKey));
      const held = unlockKey(u.vault, key);
      unlocked.add(held);
      unlockIds.set(held, normalise(u.id));
    });
    if (!unlocks.ok) return unlocks;
    truncated ||= unlocks.value;

    return ok({ subscribedVaults, unlocked, unlockIds, subscriptions, truncated });
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
    case 'paid': {
      /*
        Either edition entitles.

        A paid post is sold under two keys on one vault — the creator's, and `<key>#machine` for
        machine buyers (`lib/machine-pricing.ts`). Both are real `Unlock` objects minted by the same
        `creator::unlock`, and both were paid for. Checking only the human key was the visible half
        of the defect this widening closes: a machine buyer held a valid `Unlock`, and this predicate
        called them a stranger.

        Widened HERE and nowhere else, which is the reason there is one predicate. Every call site
        — the comments route, the media route, the creator page, the feed — reads the wider answer
        without changing.
      */
      const human = unlockKey(post.vaultId, post.access.contentKey);
      if (entitlements.unlocked.has(human)) return true;
      const machine = machineContentKey(post.access.contentKey);
      return machine.ok && entitlements.unlocked.has(unlockKey(post.vaultId, machine.value));
    }
  }
}

/**
 * The object a reader must name to the key server to open one post, or `undefined`.
 *
 * Seal's `seal_approve_*` functions all take the entitlement **by reference**: the key server
 * re-executes the policy with the reader as sender, and a policy over an owned object needs that
 * object identified. Which object, and which arguments accompany it, depends entirely on how the
 * post is gated — and that decision was being made inline at each render site, in a conditional
 * that already existed twice and would have grown a third and fourth copy the moment subscriber
 * posts joined paid ones. That is precisely the shape `canRead` exists to prevent, so this is its
 * counterpart: one function, called wherever a post is prepared for a reader.
 *
 * Returning `undefined` is not a denial and grants nothing either way. The key server is the
 * authority; this only decides what to hand it.
 */
export function sealApprover(post: Post, entitlements: Entitlements): SealApprover | undefined {
  if (post.access.kind === 'paid') {
    /*
      Names WHICH key the object was bought under, because the key server will be asked for that
      identity and no other: `seal_approve_unlock` asserts
      `id == unlock_identity(unlock.vault, unlock.content_key)`, so handing a machine buyer's
      `Unlock` the human identity is a `MoveAbort` that reads as "you do not have access" on a post
      they paid for. The card opens the edition the approver names.

      Human preferred when a reader somehow holds both: it is the edition the post's own
      `contentKey` names, and the two bodies are the same words.
    */
    const ids = entitlements.unlockIds;
    const humanKey = post.access.contentKey;
    const humanId = ids?.get(unlockKey(post.vaultId, humanKey));
    if (humanId !== undefined) return { kind: 'unlock', objectId: humanId, contentKey: humanKey };

    const machine = machineContentKey(humanKey);
    if (!machine.ok) return undefined;
    const machineId = ids?.get(unlockKey(post.vaultId, machine.value));
    return machineId === undefined
      ? undefined
      : { kind: 'unlock', objectId: machineId, contentKey: machine.value };
  }

  if (post.access.kind === 'subscribers') {
    // Only a sealed body needs an approver, and only a sealed body records the tier and period the
    // contract will be asked about. A subscriber post published before sealing has its words in a
    // column and is served the ordinary way.
    const sealed = post.sealedBody;
    if (sealed?.tier === undefined || sealed.period === undefined) return undefined;

    const tier = BigInt(sealed.tier);
    const period = BigInt(sealed.period);
    const held = subscriptionForPeriod(entitlements, post.vaultId, tier, period);
    return held === null
      ? undefined
      : { kind: 'subscription', objectId: held.objectId, tier: sealed.tier, period: sealed.period };
  }

  return undefined;
}

/**
 * What the browser names to the key server, and the arguments that go with it.
 *
 * `tier` and `period` are decimal strings because this crosses into a client component as JSON,
 * where `bigint` does not survive `JSON.stringify` at all — it throws — and `number` would round a
 * `u64` silently into an identity that is the right length and the wrong bytes.
 */
export type SealApprover =
  /** `contentKey` is the key the `Unlock` carries — the human key, or `<key>#machine`. */
  | { kind: 'unlock'; objectId: string; contentKey: string }
  | { kind: 'subscription'; objectId: string; tier: string; period: string };

/**
 * The subscription that can actually open one sealed period, or `null`.
 *
 * This re-checks, off chain, exactly what `entitlement::seal_approve_subscription` asserts on chain:
 *
 * ```move
 * assert!(subscription.tier >= tier, ETierTooLow);
 * let period_start = period * PERIOD_MS;
 * assert!(subscription.started_at_ms <= period_start, EPeriodNotPaid);
 * assert!(period_start < subscription.expires_at_ms, EPeriodNotPaid);
 * ```
 *
 * Not as a gate — the key server re-executes the real policy with the reader as sender, so nothing
 * here can grant anything. It is a *selection*: a reader may hold several subscriptions to one
 * vault and only one of them covers a given period, and handing the browser the wrong object
 * produces a `MoveAbort` that surfaces to a paying subscriber as "you do not have access". Picking
 * the object the contract will accept is the difference between a post that opens and a post that
 * accuses its reader.
 *
 * The earliest qualifying subscription wins, so a reader who has resubscribed keeps opening the
 * older periods through the object that paid for them.
 */
export function subscriptionForPeriod(
  entitlements: Entitlements,
  vaultId: string,
  tier: bigint,
  period: bigint,
): HeldSubscription | null {
  const held = entitlements.subscriptions?.get(normalise(vaultId));
  if (held === undefined) return null;

  const periodStart = period * SEAL_PERIOD_MS;
  return (
    held
      .filter((s) => s.tier >= tier && s.startedAtMs <= periodStart && periodStart < s.expiresAtMs)
      .sort((a, b) => (a.startedAtMs < b.startedAtMs ? -1 : a.startedAtMs > b.startedAtMs ? 1 : 0))[0] ?? null
  );
}

/**
 * The key an unlock is held under, built in one place.
 *
 * Three callers need this string — the reader that records unlocks, the predicate that checks them,
 * and the media route that names the object to the browser — and they must agree exactly. They did
 * not have to before, because only two of them existed and both were in this file; the moment a
 * third was written outside it, an inlined `${vault}:${key}` silently missed every lookup, because
 * the vault is normalised and a raw id is not.
 */
export function unlockKey(vaultId: string, contentKey: string): string {
  return `${normalise(vaultId)}:${contentKey}`;
}

/** Object ids compare as hex strings; normalise so `0x0a…` and `0xa…` do not differ. */
function normalise(id: string): string {
  return `0x${BigInt(id).toString(16).padStart(64, '0')}`;
}

export type { ProjectXSocialConfig };
