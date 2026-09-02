// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import 'server-only';

/**
 * What a reader has bought, read from the objects they hold.
 *
 * # Why `readEntitlements` was not enough
 *
 * That function answers one question — may this person see this post — and answers it as two sets
 * of ids, which is exactly right for a gate and useless for a receipt. It deliberately throws away
 * what a buyer needs to see: what they paid, when it started, when it runs out, and which creator
 * it was for. Subscriptions that have already expired are dropped entirely, because an expired
 * subscription grants nothing.
 *
 * A purchase history needs the opposite. Expired subscriptions belong on it — a receipt for
 * something that has lapsed is still a receipt, and hiding it makes a renewal look like a first
 * purchase. So this reads the same objects and keeps everything.
 *
 * # The objects are the record
 *
 * Nothing here comes from an orders table, because there is no orders table. A `Subscription` and
 * an `Unlock` are objects the buyer owns; they cannot be revoked by this platform, edited by it, or
 * lost when it does. That is the strongest claim this product makes and the receipt should be read
 * from the thing that makes it true.
 */

import { bcs } from '@mysten/sui/bcs';
import {
  classify,
  createClient,
  decodeObjectBytes,
  fail,
  ok,
  type Reading,
} from '@projectx-social/sdk';
import { siteConfig } from './chain';
import { listProfiles } from './content';
import { humanContentKey, isMachineContentKey } from './machine-pricing';

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

const UnlockBcs = bcs.struct('Unlock', {
  id: bcs.Address,
  vault: bcs.Address,
  buyer: bcs.Address,
  contentKey: bcs.vector(bcs.u8()),
  pricePaid: bcs.u64(),
  purchasedAtMs: bcs.u64(),
});

/** Field order, exported so the drift test can compare it with `entitlement.move`. */
export const SUBSCRIPTION_BCS_FIELDS = [
  'id', 'vault', 'subscriber', 'tier', 'price_paid', 'started_at_ms', 'expires_at_ms', 'renewals',
] as const;
export const UNLOCK_BCS_FIELDS = [
  'id', 'vault', 'buyer', 'content_key', 'price_paid', 'purchased_at_ms',
] as const;

export interface SubscriptionRecord {
  /** The vault's coin type from its profile row, or null when this deployment does not know the vault. */
  coinType: string | null;
  objectId: string;
  vaultId: string;
  /** The creator's handle, when this deployment's store knows the vault. `null` otherwise. */
  handle: string | null;
  tier: number;
  pricePaid: bigint;
  startedAtMs: number;
  expiresAtMs: number;
  renewals: number;
  /** Compared against the same clock the contract uses, and exclusive, exactly as it compares. */
  active: boolean;
}

export interface UnlockRecord {
  /** The vault's coin type from its profile row, or null when this deployment does not know the vault. */
  coinType: string | null;
  objectId: string;
  vaultId: string;
  handle: string | null;
  contentKey: string;
  /** The post's title, when the content key names a post this deployment stores. */
  title: string | null;
  /**
   * Which edition the `Unlock` bought. A machine `Unlock` carries `<key>#machine`; its title is
   * looked up under the human key, because that is the post it opens, and the receipt says so.
   */
  edition: 'human' | 'machine';
  pricePaid: bigint;
  purchasedAtMs: number;
}

export interface Purchases {
  subscriptions: SubscriptionRecord[];
  unlocks: UnlockRecord[];
  /** True when a page ceiling stopped the walk. The list is recent, not complete. */
  truncated: boolean;
}

/** Hard ceiling. Not caller-supplied, and a hit ceiling is flagged rather than hidden. */
const MAX_OBJECTS = 100;

const normalise = (id: string): string => `0x${BigInt(id).toString(16).padStart(64, '0')}`;

/**
 * Everything this address has bought.
 *
 * Returns a `Reading`, so a caller that cannot reach the chain shows "not measured" rather than an
 * empty history. An empty history and an unreachable node look identical otherwise, and only one of
 * them means nothing was bought.
 */
export async function readPurchases(buyer: string): Promise<Reading<Purchases>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const source = `purchases of ${buyer}`;
  try {
    const client = createClient(config.value);
    const now = Date.now();

    // Vault id → handle, so a receipt names a creator rather than an object id. A vault this
    // deployment does not know stays `null` rather than being labelled with a guess.
    const profiles = await listProfiles();
    // Pages without a vault cannot appear on a receipt, so they are not in this lookup. Keying one
    // by a normalised null would map every unknown vault onto whichever page came first.
    const profileOf = new Map(
      profiles
        .filter((p): p is typeof p & { vaultId: string } => p.vaultId !== null)
        .map((p) => [normalise(p.vaultId), { handle: p.handle, coinType: p.coinType ?? null }]),
    );
    const handleOf = new Map([...profileOf].map(([k, v]) => [k, v.handle]));
    // The vault's coin, from its profile row, so a receipt is formatted at the right decimals —
    // a SUI vault's purchase read 1000× too large when everything was scaled as USDC.
    const coinOf = (vaultId: string): string | null => profileOf.get(vaultId)?.coinType ?? null;

    const subs = await client.listOwnedObjects({
      owner: buyer,
      type: `${config.value.packageId}::entitlement::Subscription`,
      limit: MAX_OBJECTS,
      include: { content: true },
    });
    const unlocks = await client.listOwnedObjects({
      owner: buyer,
      type: `${config.value.packageId}::entitlement::Unlock`,
      limit: MAX_OBJECTS,
      include: { content: true },
    });

    const truncated =
      (subs as { hasNextPage?: boolean }).hasNextPage === true ||
      (unlocks as { hasNextPage?: boolean }).hasNextPage === true;

    const subscriptions: SubscriptionRecord[] = [];
    for (const object of (subs as { objects?: Array<{ content?: unknown }> }).objects ?? []) {
      const bytes = decodeObjectBytes(object.content, source);
      if (!bytes.ok) return bytes;
      if (bytes.value === null) continue;
      const s = SubscriptionBcs.parse(bytes.value);
      const vaultId = normalise(s.vault);
      subscriptions.push({
        objectId: normalise(s.id),
        vaultId,
        handle: handleOf.get(vaultId) ?? null,
        coinType: coinOf(vaultId),
        tier: Number(s.tier),
        pricePaid: BigInt(s.pricePaid),
        startedAtMs: Number(s.startedAtMs),
        expiresAtMs: Number(s.expiresAtMs),
        renewals: Number(s.renewals),
        // Exclusive, matching `expires_at_ms > now` in the contract. An off-by-one here would show
        // someone an active badge for a subscription the chain has already stopped honouring.
        active: Number(s.expiresAtMs) > now,
      });
    }

    const unlockRecords: UnlockRecord[] = [];
    for (const object of (unlocks as { objects?: Array<{ content?: unknown }> }).objects ?? []) {
      const bytes = decodeObjectBytes(object.content, source);
      if (!bytes.ok) return bytes;
      if (bytes.value === null) continue;
      const u = UnlockBcs.parse(bytes.value);
      const contentKey = new TextDecoder().decode(Uint8Array.from(u.contentKey));
      const vaultId = normalise(u.vault);
      unlockRecords.push({
        objectId: normalise(u.id),
        vaultId,
        handle: handleOf.get(vaultId) ?? null,
        coinType: coinOf(vaultId),
        contentKey,
        title: null,
        edition: isMachineContentKey(contentKey) ? 'machine' : 'human',
        pricePaid: BigInt(u.pricePaid),
        purchasedAtMs: Number(u.purchasedAtMs),
      });
    }

    /*
      Name the unlocks, asking only for the keys this buyer actually holds.

      Previously this read every post on the platform — bodies and asset ids included — to build a
      lookup of two columns, and it ran before the loop that decides which keys are even wanted. A
      key with no row stays null, so an unlock for content this deployment does not store keeps its
      raw key rather than borrowing a title.
    */
    if (unlockRecords.length > 0) {
      const { titlesForContentKeys, titleKey } = await import('./content');
      // A machine `Unlock` is titled by the post it opens: the row is stored under the HUMAN key,
      // and `<key>#machine` names no row of its own.
      const humanKeyOf = (key: string): string => {
        const human = humanContentKey(key);
        return human.ok ? human.value : key;
      };
      const titleOf = await titlesForContentKeys(
        unlockRecords.map((u) => ({ vaultId: u.vaultId, contentKey: humanKeyOf(u.contentKey) })),
      );
      for (const record of unlockRecords) {
        record.title = titleOf.get(titleKey(record.vaultId, humanKeyOf(record.contentKey))) ?? null;
      }
    }

    // Newest first. Subscriptions sort by when they started, not by expiry — a receipt is ordered
    // by when you bought it, and sorting by expiry would shuffle a renewal to the top.
    subscriptions.sort((a, b) => b.startedAtMs - a.startedAtMs);
    unlockRecords.sort((a, b) => b.purchasedAtMs - a.purchasedAtMs);

    return ok({ subscriptions, unlocks: unlockRecords, truncated });
  } catch (error) {
    const failure = classify(error, source);
    return fail(failure.kind, source, failure.detail);
  }
}

