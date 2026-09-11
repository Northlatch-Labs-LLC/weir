// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { Transaction } from '@mysten/sui/transactions';
import type { BuildTransactionOptions } from '@mysten/sui/transactions';
import { fromHex, isValidSuiObjectId, normalizeSuiObjectId, toHex } from '@mysten/sui/utils';
import type { ProjectXSocialConfig } from './config.js';

export const SEAL_UNLOCK = 0x00;
export const SEAL_SUBSCRIPTION = 0x01;

export const SEAL_MIND = 0x02;

export const SEAL_PERIOD_MS = 2_592_000_000n;

function objectBytes(objectId: string, what: string): Uint8Array {
  const normalised = normalizeSuiObjectId(objectId);
  if (!isValidSuiObjectId(normalised)) {
    throw new Error(`${what} must be a 32-byte hex object id; this one is "${objectId}"`);
  }
  return fromHex(normalised);
}

function vaultBytes(vaultId: string): Uint8Array {
  return objectBytes(vaultId, 'a vault id');
}

function u64LittleEndian(value: bigint, field: string): Uint8Array {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
    throw new Error(`${field} must fit in a u64; this one is ${value}`);
  }
  const bytes = new Uint8Array(8);
  let remaining = value;
  for (let index = 0; index < 8; index += 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function unlockIdentity(vaultId: string, contentKey: Uint8Array): Uint8Array {
  return concat([vaultBytes(vaultId), Uint8Array.of(SEAL_UNLOCK), contentKey]);
}

export function periodIdentity(vaultId: string, tier: bigint, period: bigint): Uint8Array {
  return concat([
    vaultBytes(vaultId),
    Uint8Array.of(SEAL_SUBSCRIPTION),
    u64LittleEndian(tier, 'tier'),
    u64LittleEndian(period, 'period'),
  ]);
}

export function mindIdentity(accountId: string): Uint8Array {
  return concat([objectBytes(accountId, 'an account id'), Uint8Array.of(SEAL_MIND)]);
}

export function periodOf(timestampMs: bigint): bigint {
  if (timestampMs < 0n) throw new Error(`a timestamp must not be negative; this one is ${timestampMs}`);
  return timestampMs / SEAL_PERIOD_MS;
}

export function sealId(identity: Uint8Array): string {
  return toHex(identity);
}

export function sealPackageId(config: ProjectXSocialConfig): string {
  return config.packageId;
}

function entitlementRef(objectId: string) {
  return {
    $kind: 'UnresolvedObject' as const,
    UnresolvedObject: { objectId: normalizeSuiObjectId(objectId) },
  };
}

export function approveUnlock(
  config: ProjectXSocialConfig,
  args: { identity: Uint8Array; unlockId: string },
  tx: Transaction = new Transaction(),
): Transaction {
  tx.moveCall({
    target: `${config.latestPackageId}::entitlement::seal_approve_unlock`,
    arguments: [
      tx.pure.vector('u8', Array.from(args.identity)),
      tx.object(entitlementRef(args.unlockId)),
    ],
  });
  return tx;
}

export function approveSubscription(
  config: ProjectXSocialConfig,
  args: {
    identity: Uint8Array;
    tier: bigint;
    period: bigint;
    subscriptionId: string;
    vaultId: string;
    coinType: string;
  },
  tx: Transaction = new Transaction(),
): Transaction {
  tx.moveCall({
    target: `${config.latestPackageId}::creator::seal_approve_subscription`,
    typeArguments: [args.coinType],
    arguments: [
      tx.pure.vector('u8', Array.from(args.identity)),
      tx.pure.u64(args.tier),
      tx.pure.u64(args.period),
      tx.object(args.vaultId),
      tx.object(entitlementRef(args.subscriptionId)),
    ],
  });
  return tx;
}

export function approveMind(
  config: ProjectXSocialConfig,
  args: { identity: Uint8Array; accountId: string; mindPackageId: string },
  tx: Transaction = new Transaction(),
): Transaction {
  void config;
  tx.moveCall({
    target: `${args.mindPackageId}::agent_mind::seal_approve_mind`,
    arguments: [
      tx.pure.vector('u8', Array.from(args.identity)),
      tx.object(entitlementRef(args.accountId)),
    ],
  });
  return tx;
}

export async function approvalBytes(
  tx: Transaction,
  client: NonNullable<BuildTransactionOptions['client']>,
): Promise<Uint8Array> {
  return tx.build({ client, onlyTransactionKind: true });
}
