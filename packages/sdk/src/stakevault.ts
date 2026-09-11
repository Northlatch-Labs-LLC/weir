// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { decodeObjectBytes } from './objectbytes.js';
import { bcs } from '@mysten/sui/bcs';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { deriveDynamicFieldID } from '@mysten/sui/utils';
import { classify, fail, ok, type Reading } from './reading.js';

export interface Tranche {
  activationEpoch: bigint;
  principalMist: bigint;
}

const StakedSuiBcs = bcs.struct('StakedSui', {
  id: bcs.Address,
  poolId: bcs.Address,
  stakeActivationEpoch: bcs.u64(),
  principal: bcs.u64(),
});

export const STAKED_SUI_BYTES = 80;

const StakeVaultBcs = bcs.struct('StakeVault', {
  id: bcs.Address,
  version: bcs.u64(),
  platform: bcs.Address,
  creator: bcs.Address,
  creatorAccount: bcs.Address,
  feeBpsSnapshot: bcs.u64(),
  rebateBps: bcs.u64(),
  validator: bcs.Address,
  totalPrincipal: bcs.u64(),
  positions: bcs.struct('Table', { id: bcs.Address, size: bcs.u64() }),
  tranches: bcs.vector(StakedSuiBcs),
  liquid: bcs.u64(),
  creatorYield: bcs.u64(),
  platformYield: bcs.u64(),
  rebatePool: bcs.u64(),
  accRebatePerUnit: bcs.u128(),
  accepting: bcs.bool(),
  lifetimeYield: bcs.u64(),
  harvests: bcs.u64(),
});

export const STAKE_VAULT_BCS_FIELDS = [
  'id',
  'version',
  'platform',
  'creator',
  'creator_account',
  'fee_bps_snapshot',
  'rebate_bps',
  'validator',
  'total_principal',
  'positions',
  'tranches',
  'liquid',
  'creator_yield',
  'platform_yield',
  'rebate_pool',
  'acc_rebate_per_unit',
  'accepting',
  'lifetime_yield',
  'harvests',
] as const;

export interface StakeVaultState {
  vaultId: string;
  version: bigint;
  tranches: readonly Tranche[];
  liquidMist: bigint;
  totalPrincipalMist: bigint;
  creator: string;
  validator: string;
  accepting: boolean;
  creatorYieldMist: bigint;
  platformYieldMist: bigint;
  rebatePoolMist: bigint;
  lifetimeYieldMist: bigint;
  harvests: bigint;
  feeBpsSnapshot: bigint;
  rebateBps: bigint;
  accRebatePerUnit: bigint;
  positionsTableId: string;
}

export interface StakePosition {
  principalMist: bigint;
  pendingRebateMist: bigint;
  rebateDebt: bigint;
}

function toBytes(content: unknown): Uint8Array | null {
  const decoded = decodeObjectBytes(content, 'stake vault');
  return decoded.ok ? decoded.value : null;
}

export function decodeStakeVault(bytes: Uint8Array, expectedId: string): Reading<StakeVaultState> {
  const source = `StakeVault ${expectedId}`;
  try {
    const v = StakeVaultBcs.parse(bytes);

    if (BigInt(v.id) !== BigInt(expectedId)) {
      return fail('malformed', source, `decoded id ${v.id} does not match the requested id`);
    }

    const tranches: Tranche[] = v.tranches.map((t) => ({
      activationEpoch: BigInt(t.stakeActivationEpoch),
      principalMist: BigInt(t.principal),
    }));

    return ok({
      vaultId: expectedId,
      version: BigInt(v.version),
      tranches,
      liquidMist: BigInt(v.liquid),
      totalPrincipalMist: BigInt(v.totalPrincipal),
      creator: v.creator,
      validator: v.validator,
      accepting: v.accepting,
      creatorYieldMist: BigInt(v.creatorYield),
      platformYieldMist: BigInt(v.platformYield),
      rebatePoolMist: BigInt(v.rebatePool),
      lifetimeYieldMist: BigInt(v.lifetimeYield),
      harvests: BigInt(v.harvests),
      feeBpsSnapshot: BigInt(v.feeBpsSnapshot),
      rebateBps: BigInt(v.rebateBps),
      accRebatePerUnit: BigInt(v.accRebatePerUnit),
      positionsTableId: v.positions.id,
    });
  } catch (error) {
    const failure = classify(error, source);
    return fail('malformed', source, failure.detail);
  }
}

export async function readStakeVault(
  client: SuiGrpcClient,
  vaultId: string,
): Promise<Reading<StakeVaultState>> {
  const source = `StakeVault ${vaultId}`;
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

    return decodeStakeVault(bytes, vaultId);
  } catch (error) {
    const failure = classify(error, source);
    return fail(failure.kind, source, failure.detail);
  }
}

export async function readCurrentEpoch(client: SuiGrpcClient): Promise<Reading<bigint>> {
  const source = 'current epoch';
  try {
    const response = await client.core.getCurrentSystemState();
    const epoch = (response as { systemState?: { epoch?: unknown } }).systemState?.epoch;

    if (epoch === undefined || epoch === null) {
      return fail('malformed', source, 'systemState carried no epoch');
    }

    const value = BigInt(String(epoch));
    if (value === 0n) {
      return fail('malformed', source, 'epoch was 0, which no live network reports');
    }
    return ok(value);
  } catch (error) {
    const failure = classify(error, source);
    return fail(failure.kind, source, failure.detail);
  }
}

const PositionBcs = bcs.struct('Position', {
  principal: bcs.u64(),
  rebateDebt: bcs.u128(),
  pending: bcs.u64(),
});

const PositionFieldBcs = bcs.struct('Field', {
  id: bcs.Address,
  name: bcs.Address,
  value: PositionBcs,
});

export const POSITION_BCS_FIELDS = ['principal', 'rebate_debt', 'pending'] as const;

export async function readStakePosition(
  client: SuiGrpcClient,
  positionsTableId: string,
  depositor: string,
): Promise<Reading<StakePosition | null>> {
  const source = `stake position of ${depositor}`;
  try {
    const fieldId = deriveDynamicFieldID(
      positionsTableId,
      'address',
      bcs.Address.serialize(depositor).toBytes(),
    );

    const response = await client.getObject({ objectId: fieldId, include: { content: true } });
    const object = (response as { object?: { content?: unknown } }).object;
    if (object === undefined || object === null) return ok(null);

    const bytes = toBytes(object.content);
    if (bytes === null) return fail('malformed', source, 'the position carried no content');

    const decoded = PositionFieldBcs.parse(bytes);
    if (BigInt(decoded.name) !== BigInt(depositor)) {
      return fail(
        'malformed',
        source,
        `the entry at the derived id belongs to ${decoded.name}, not ${depositor}`,
      );
    }

    return ok({
      principalMist: BigInt(decoded.value.principal),
      pendingRebateMist: BigInt(decoded.value.pending),
      rebateDebt: BigInt(decoded.value.rebateDebt),
    });
  } catch (error) {
    const failure = classify(error, source);
    if (failure.kind === 'not-found') return ok(null);
    return fail(failure.kind, source, failure.detail);
  }
}

export const ACC_SCALE = 1_000_000_000_000n;

export function claimableRebateMist(position: StakePosition, accRebatePerUnit: bigint): bigint {
  const entitled = (position.principalMist * accRebatePerUnit) / ACC_SCALE;
  if (entitled <= position.rebateDebt) return position.pendingRebateMist;
  return position.pendingRebateMist + (entitled - position.rebateDebt);
}

export interface StakeMember extends StakePosition {
  depositor: string;
}

export interface StakeMembers {
  members: StakeMember[];
  truncated: boolean;
}

const MEMBERS_PAGE = 100;
const MEMBERS_MAX_PAGES = 50;

interface PositionsPage {
  dynamicFields: ReadonlyArray<{ name: { bcs: Uint8Array }; value?: { bcs: Uint8Array } }>;
  cursor: string | null;
  hasNextPage: boolean;
}

const POSITION_BYTES = 8 + 16 + 8;
const POSITION_FIELD_BYTES = 32 + 32 + POSITION_BYTES;

export async function listStakePositions(
  client: SuiGrpcClient,
  positionsTableId: string,
): Promise<Reading<StakeMembers>> {
  const source = `positions table ${positionsTableId}`;
  try {
    const members: StakeMember[] = [];
    let cursor: string | null = null;

    for (let page = 0; page < MEMBERS_MAX_PAGES; page += 1) {
      const response: PositionsPage = await client.listDynamicFields({
        parentId: positionsTableId,
        limit: MEMBERS_PAGE,
        include: { value: true },
        ...(cursor === null ? {} : { cursor }),
      });

      for (const field of response.dynamicFields) {
        const name = toBytes(field.name.bcs);
        const value = toBytes(field.value?.bcs);
        if (name === null || value === null) {
          return fail('malformed', source, 'an entry carried no decodable name or value');
        }

        const decoded =
          value.length === POSITION_FIELD_BYTES
            ? PositionFieldBcs.parse(value).value
            : value.length === POSITION_BYTES
              ? PositionBcs.parse(value)
              : null;
        if (decoded === null) {
          return fail('malformed', source, `a position decoded to ${value.length} bytes`);
        }

        members.push({
          depositor: bcs.Address.parse(name),
          principalMist: BigInt(decoded.principal),
          pendingRebateMist: BigInt(decoded.pending),
          rebateDebt: BigInt(decoded.rebateDebt),
        });
      }

      if (!response.hasNextPage || response.cursor === null) {
        return ok({ members, truncated: false });
      }
      cursor = response.cursor;
    }

    return ok({ members, truncated: true });
  } catch (error) {
    const failure = classify(error, source);
    return fail(failure.kind, source, failure.detail);
  }
}
