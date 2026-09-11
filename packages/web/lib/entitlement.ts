// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';

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

export interface Entitlements {
  subscribedVaults: Set<string>;
  unlocked: Set<string>;
  unlockIds?: Map<string, string>;
  subscriptions?: Map<string, HeldSubscription[]>;
}

export interface HeldSubscription {
  objectId: string;
  tier: bigint;
  startedAtMs: bigint;
  expiresAtMs: bigint;
}

export const NO_ENTITLEMENTS: Entitlements = {
  subscribedVaults: new Set(),
  unlocked: new Set(),
};

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

    const MAX_PAGES = 20;

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
        if (cursor === null) return ok(true);
      }
      return ok(true);
    };

    const subs = await drain(`${config.value.packageId}::entitlement::Subscription`, (bytes) => {
      const s = SubscriptionBcs.parse(bytes);
      const vault = normalise(s.vault);
      if (BigInt(s.expiresAtMs) > now) subscribedVaults.add(vault);
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

export function canRead(post: Post, entitlements: Entitlements): boolean {
  switch (post.access.kind) {
    case 'public':
      return true;
    case 'subscribers':
      return entitlements.subscribedVaults.has(normalise(post.vaultId));
    case 'paid': {
      const human = unlockKey(post.vaultId, post.access.contentKey);
      if (entitlements.unlocked.has(human)) return true;
      const machine = machineContentKey(post.access.contentKey);
      return machine.ok && entitlements.unlocked.has(unlockKey(post.vaultId, machine.value));
    }
  }
}

export function sealApprover(post: Post, entitlements: Entitlements): SealApprover | undefined {
  if (post.access.kind === 'paid') {
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

export type SealApprover =
  | { kind: 'unlock'; objectId: string; contentKey: string }
  | { kind: 'subscription'; objectId: string; tier: string; period: string };

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

export function unlockKey(vaultId: string, contentKey: string): string {
  return `${normalise(vaultId)}:${contentKey}`;
}

function normalise(id: string): string {
  return `0x${BigInt(id).toString(16).padStart(64, '0')}`;
}

export type { ProjectXSocialConfig };
