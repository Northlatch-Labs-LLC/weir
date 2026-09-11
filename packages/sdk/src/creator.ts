// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { decodeObjectBytes } from './objectbytes.js';
import { bcs } from '@mysten/sui/bcs';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { deriveDynamicFieldID } from '@mysten/sui/utils';
import { classify, fail, ok, type Reading } from './reading.js';

const TierBcs = bcs.struct('Tier', {
  name: bcs.string(),
  price: bcs.u64(),
  periodMs: bcs.u64(),
  active: bcs.bool(),
});

const CreatorVaultBcs = bcs.struct('CreatorVault', {
  id: bcs.Address,
  version: bcs.u64(),
  platform: bcs.Address,
  owner: bcs.Address,
  account: bcs.Address,
  feeBpsSnapshot: bcs.u64(),
  referralShareBpsSnapshot: bcs.u64(),
  tiers: bcs.vector(TierBcs),
  contentPrices: bcs.struct('Table', { id: bcs.Address, size: bcs.u64() }),
  minTip: bcs.u64(),
  accepting: bcs.bool(),
  earnings: bcs.u64(),
  platformFees: bcs.u64(),
  grossVolume: bcs.u64(),
  subscriptionsSold: bcs.u64(),
  unlocksSold: bcs.u64(),
  tipsReceived: bcs.u64(),
});

export const CREATOR_VAULT_BCS_FIELDS = [
  'id',
  'version',
  'platform',
  'owner',
  'account',
  'fee_bps_snapshot',
  'referral_share_bps_snapshot',
  'tiers',
  'content_prices',
  'min_tip',
  'accepting',
  'earnings',
  'platform_fees',
  'gross_volume',
  'subscriptions_sold',
  'unlocks_sold',
  'tips_received',
] as const;

export interface Tier {
  index: number;
  name: string;
  price: bigint;
  periodMs: bigint;
  active: boolean;
}

export interface CreatorVaultState {
  vaultId: string;
  owner: string;
  contentPricesTableId: string;
  feeBpsSnapshot: bigint;
  referralShareBpsSnapshot: bigint;
  tiers: Tier[];
  minTip: bigint;
  accepting: boolean;
  earnings: bigint;
  platformFees: bigint;
  grossVolume: bigint;
  subscriptionsSold: bigint;
}

function toBytes(content: unknown): Uint8Array | null {
  const decoded = decodeObjectBytes(content, 'creator vault');
  return decoded.ok ? decoded.value : null;
}

export function decodeCreatorVault(
  bytes: Uint8Array,
  expectedId: string,
): Reading<CreatorVaultState> {
  const source = `CreatorVault ${expectedId}`;
  try {
    const v = CreatorVaultBcs.parse(bytes);

    if (BigInt(v.id) !== BigInt(expectedId)) {
      return fail('malformed', source, `decoded id ${v.id} does not match the requested id`);
    }

    return ok({
      vaultId: expectedId,
      owner: v.owner,
      contentPricesTableId: v.contentPrices.id,
      feeBpsSnapshot: BigInt(v.feeBpsSnapshot),
      referralShareBpsSnapshot: BigInt(v.referralShareBpsSnapshot),
      tiers: v.tiers.map((tier, index) => ({
        index,
        name: tier.name,
        price: BigInt(tier.price),
        periodMs: BigInt(tier.periodMs),
        active: tier.active,
      })),
      minTip: BigInt(v.minTip),
      accepting: v.accepting,
      earnings: BigInt(v.earnings),
      platformFees: BigInt(v.platformFees),
      grossVolume: BigInt(v.grossVolume),
      subscriptionsSold: BigInt(v.subscriptionsSold),
    });
  } catch (error) {
    return fail('malformed', source, classify(error, source).detail);
  }
}

const ContentPriceFieldBcs = bcs.struct('Field', {
  id: bcs.Address,
  name: bcs.vector(bcs.u8()),
  value: bcs.u64(),
});

export async function readContentPrice(
  client: SuiGrpcClient,
  contentPricesTableId: string,
  contentKey: string,
): Promise<Reading<bigint | null>> {
  const source = `price of "${contentKey}"`;

  const key = new TextEncoder().encode(contentKey);
  if (key.length === 0) return ok(null);

  let fieldId: string;
  try {
    fieldId = deriveDynamicFieldID(
      contentPricesTableId,
      'vector<u8>',
      bcs.vector(bcs.u8()).serialize(key).toBytes(),
    );
  } catch (error) {
    return fail(
      'malformed',
      source,
      `could not derive the price entry id: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  try {
    const response = await client.getObject({ objectId: fieldId, include: { content: true } });
    const object = (response as { object?: { content?: unknown } }).object;
    if (object === undefined || object === null) return ok(null);

    const bytes = toBytes(object.content);
    if (bytes === null) {
      return fail('malformed', source, 'the price entry carried no decodable content');
    }

    const decoded = ContentPriceFieldBcs.parse(bytes);

    const found = new TextDecoder().decode(Uint8Array.from(decoded.name));
    if (found !== contentKey) {
      return fail('malformed', source, `the entry at the derived id prices "${found}" instead`);
    }

    return ok(BigInt(decoded.value));
  } catch (error) {
    const failure = classify(error, source);

    if (failure.kind === 'not-found') return ok(null);

    return fail(failure.kind, source, failure.detail);
  }
}

export async function readCreatorVault(
  client: SuiGrpcClient,
  vaultId: string,
): Promise<Reading<CreatorVaultState>> {
  const source = `CreatorVault ${vaultId}`;
  try {
    const response = await client.getObject({ objectId: vaultId, include: { content: true } });
    const object = (response as { object?: { content?: unknown } }).object;
    if (object === undefined || object === null) {
      return fail('not-found', source, 'no object exists at that id on this network');
    }

    const bytes = toBytes(object.content);
    if (bytes === null) {
      return fail('malformed', source, 'the object carried no decodable content');
    }
    return decodeCreatorVault(bytes, vaultId);
  } catch (error) {
    const failure = classify(error, source);
    return fail(failure.kind, source, failure.detail);
  }
}

export async function readVaultCoinType(client: SuiGrpcClient, vaultId: string): Promise<Reading<string>> {
  const source = `CreatorVault ${vaultId}`;
  try {
    const response = await client.getObject({ objectId: vaultId, include: { content: true } });
    const object = (response as { object?: { type?: unknown } | null }).object;
    if (object === undefined || object === null) return fail('not-found', source, 'no object exists at that id on this network');
    const type = typeof object.type === 'string' ? object.type : null;
    if (type === null) return fail('malformed', source, 'the node did not report the object type');
    const m = /::creator::CreatorVault<(.+)>$/.exec(type);
    if (m === null || m[1] === undefined || m[1] === '') return fail('malformed', source, `${type} is not a CreatorVault`);
    return ok(m[1]);
  } catch (error) {
    const failure = classify(error, source);
    return fail(failure.kind, source, failure.detail);
  }
}
