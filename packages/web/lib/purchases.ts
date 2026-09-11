// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';

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

export const SUBSCRIPTION_BCS_FIELDS = [
  'id', 'vault', 'subscriber', 'tier', 'price_paid', 'started_at_ms', 'expires_at_ms', 'renewals',
] as const;
export const UNLOCK_BCS_FIELDS = [
  'id', 'vault', 'buyer', 'content_key', 'price_paid', 'purchased_at_ms',
] as const;

export interface SubscriptionRecord {
  coinType: string | null;
  objectId: string;
  vaultId: string;
  handle: string | null;
  tier: number;
  pricePaid: bigint;
  startedAtMs: number;
  expiresAtMs: number;
  renewals: number;
  active: boolean;
}

export interface UnlockRecord {
  coinType: string | null;
  objectId: string;
  vaultId: string;
  handle: string | null;
  contentKey: string;
  title: string | null;
  edition: 'human' | 'machine';
  pricePaid: bigint;
  purchasedAtMs: number;
}

export interface Purchases {
  subscriptions: SubscriptionRecord[];
  unlocks: UnlockRecord[];
  truncated: boolean;
}

const MAX_OBJECTS = 100;

const normalise = (id: string): string => `0x${BigInt(id).toString(16).padStart(64, '0')}`;

export async function readPurchases(buyer: string): Promise<Reading<Purchases>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const source = `purchases of ${buyer}`;
  try {
    const client = createClient(config.value);
    const now = Date.now();

    const profiles = await listProfiles();
    const profileOf = new Map(
      profiles
        .filter((p): p is typeof p & { vaultId: string } => p.vaultId !== null)
        .map((p) => [normalise(p.vaultId), { handle: p.handle, coinType: p.coinType ?? null }]),
    );
    const handleOf = new Map([...profileOf].map(([k, v]) => [k, v.handle]));
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

    if (unlockRecords.length > 0) {
      const { titlesForContentKeys, titleKey } = await import('./content');
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

    subscriptions.sort((a, b) => b.startedAtMs - a.startedAtMs);
    unlockRecords.sort((a, b) => b.purchasedAtMs - a.purchasedAtMs);

    return ok({ subscriptions, unlocks: unlockRecords, truncated });
  } catch (error) {
    const failure = classify(error, source);
    return fail(failure.kind, source, failure.detail);
  }
}
