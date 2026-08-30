// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * Seal identities, and the transactions that prove a right to them.
 *
 * # This file is a transcription, and it is the dangerous kind
 *
 * Every byte layout below already exists, in Move, in `entitlement.move`. That module is the
 * specification: the key servers execute *its* `seal_approve_*` functions, and they compare the
 * identity they were asked for against the identity *it* derives. Nothing here is consulted by
 * anybody but us.
 *
 * So this is a second implementation of a byte layout, which is the exact shape of defect the Move
 * module's own comments warn about twice. It is tolerated for one reason — the encryptor is a
 * TypeScript process and cannot call a Move function without a chain round trip on every upload —
 * and it is made safe in one way: `test/seal-identity.test.ts` asserts concrete byte vectors, and
 * `sui-contracts/tests/seal_tests.move` asserts *the same* concrete byte vectors against the Move
 * implementation. Neither suite proves the other correct on its own. Together they fail the moment
 * the two disagree, which is the only property worth having here.
 *
 * If you change a constant in this file, the Move test fails. That is deliberate. Do not change the
 * Move test to match; change the code back.
 *
 * # Why the identity is not just the content key
 *
 * Quoting the contract, because the reasoning is load-bearing and easy to discard as ceremony:
 *
 *   unlock        <vault> ‖ 0x00 ‖ <content key>
 *   subscription  <vault> ‖ 0x01 ‖ <tier, u64 LE> ‖ <period, u64 LE>
 *
 * The leading vault id namespaces the identity, so two creators sharing this package cannot derive
 * each other's keys. The tag byte separates the two families, because `content_key` is arbitrary
 * creator-supplied bytes: without it a creator could publish under the content key
 * `0x01 ‖ tier ‖ period` and make an unlock-gated identity byte-identical to a subscription-gated
 * one, then sell one cheap unlock that opens a whole period of subscriber content.
 */

import { Transaction } from '@mysten/sui/transactions';
import type { BuildTransactionOptions } from '@mysten/sui/transactions';
import { fromHex, isValidSuiObjectId, normalizeSuiObjectId, toHex } from '@mysten/sui/utils';
import type { ProjectXSocialConfig } from './config.js';

/**
 * Identity tags. One byte each, and the two must never collide.
 *
 * `entitlement.move`: `const SEAL_UNLOCK: u8 = 0;` / `const SEAL_SUBSCRIPTION: u8 = 1;`
 */
export const SEAL_UNLOCK = 0x00;
export const SEAL_SUBSCRIPTION = 0x01;

/**
 * The window one subscription identity covers. Thirty days, fixed.
 *
 * `entitlement.move`: `const PERIOD_MS: u64 = 30 * 24 * 60 * 60 * 1000;`
 *
 * A `bigint` rather than a `number` because it is divided into millisecond timestamps to produce a
 * period index, and that arithmetic must agree with Move's `u64` division exactly. It happens to
 * stay inside `Number.MAX_SAFE_INTEGER` for any plausible date, but "happens to" is not a property
 * to rely on when disagreeing with the chain means deriving a key for the wrong month.
 */
export const SEAL_PERIOD_MS = 2_592_000_000n;

/** A vault id as 32 raw bytes — Move's `object::id_to_bytes`, which has no length prefix. */
function vaultBytes(vaultId: string): Uint8Array {
  const normalised = normalizeSuiObjectId(vaultId);
  if (!isValidSuiObjectId(normalised)) {
    // Refused rather than padded. A short id that silently becomes a valid-looking 32 bytes is an
    // identity nobody chose, and the encryption under it succeeds — the failure surfaces later, as
    // a reader who cannot open content they paid for.
    throw new Error(`a vault id must be a 32-byte hex object id; this one is "${vaultId}"`);
  }
  return fromHex(normalised);
}

/** Move's `std::bcs::to_bytes(&x)` for a `u64`: eight bytes, little-endian. */
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

/**
 * The identity a single piece of priced content is encrypted to.
 *
 * ```move
 * public fun unlock_identity(vault: ID, content_key: vector<u8>): vector<u8> {
 *     let mut identity = object::id_to_bytes(&vault);
 *     identity.push_back(SEAL_UNLOCK);
 *     identity.append(content_key);
 *     identity
 * }
 * ```
 */
export function unlockIdentity(vaultId: string, contentKey: Uint8Array): Uint8Array {
  return concat([vaultBytes(vaultId), Uint8Array.of(SEAL_UNLOCK), contentKey]);
}

/**
 * The identity one creator-period at one tier is encrypted to.
 *
 * ```move
 * public fun period_identity(vault: ID, tier: u64, period: u64): vector<u8> {
 *     let mut identity = object::id_to_bytes(&vault);
 *     identity.push_back(SEAL_SUBSCRIPTION);
 *     identity.append(std::bcs::to_bytes(&tier));
 *     identity.append(std::bcs::to_bytes(&period));
 *     identity
 * }
 * ```
 */
export function periodIdentity(vaultId: string, tier: bigint, period: bigint): Uint8Array {
  return concat([
    vaultBytes(vaultId),
    Uint8Array.of(SEAL_SUBSCRIPTION),
    u64LittleEndian(tier, 'tier'),
    u64LittleEndian(period, 'period'),
  ]);
}

/**
 * Which period a moment falls in.
 *
 * ```move
 * public fun period_of(timestamp_ms: u64): u64 { timestamp_ms / PERIOD_MS }
 * ```
 *
 * Integer division, matching Move. `Math.floor` on a float would agree for every timestamp anyone
 * will see and disagree eventually, which is the worst available failure mode: correct in testing,
 * wrong once, permanently, for one creator's month.
 */
export function periodOf(timestampMs: bigint): bigint {
  if (timestampMs < 0n) throw new Error(`a timestamp must not be negative; this one is ${timestampMs}`);
  return timestampMs / SEAL_PERIOD_MS;
}

/**
 * An identity in the form the Seal SDK and the encrypted object both use.
 *
 * Bare lowercase hex with **no `0x` prefix**, because that is what `EncryptedObject.parse()` returns
 * for its `id` field — verified against the installed package's own BCS transform, which is
 * `toHex(bytes)`. Emitting a prefixed string here would compare unequal to the parsed one while
 * decoding to identical bytes, and the resulting bug reads as "the key server refused us" rather
 * than as a string mismatch.
 */
export function sealId(identity: Uint8Array): string {
  return toHex(identity);
}

/**
 * The package that namespaces every identity: the **original** publish, never the latest.
 *
 * Seal derives its full id as `packageId ‖ identity`, and both `SealClient.encrypt` and
 * `SessionKey.create` read the package object and throw `InvalidPackageError` unless its version is
 * exactly 1 — checked in the installed SDK at `dist/client.mjs:47` and `dist/session-key.mjs:51`.
 * Only the original address satisfies that; an upgraded package is version 2 or higher at a new
 * address.
 *
 * This is the mirror image of the rule for calls. `latestPackageId` is the only correct `moveCall`
 * target and `packageId` is the only correct Seal namespace, and getting either backwards fails at
 * a distance from the mistake.
 */
export function sealPackageId(config: ProjectXSocialConfig): string {
  return config.packageId;
}

/**
 * An entitlement object, declared as the immutable reference the contract takes.
 *
 * `tx.object(id)` leaves mutability unknown, and the transaction builder resolves that by reading
 * the function's signature from chain — an extra round trip, on every approval, for an answer the
 * Move signature already gives us here: `seal_approve_unlock(id, unlock: &Unlock, ...)` and
 * `seal_approve_subscription(..., subscription: &Subscription, ...)` both take a shared reference
 * and neither mutates.
 *
 * Saying so removes the lookup. It is also the honest declaration: an approval that asked for a
 * mutable reference to a reader's soulbound entitlement would be asking for more than it needs, on
 * a transaction handed to key servers we do not run.
 */
function entitlementRef(objectId: string) {
  return {
    $kind: 'UnresolvedObject' as const,
    UnresolvedObject: { objectId: normalizeSuiObjectId(objectId), mutable: false },
  };
}

/**
 * Prove a right to an unlock's key.
 *
 * ```move
 * entry fun seal_approve_unlock(id: vector<u8>, unlock: &Unlock, ctx: &TxContext)
 * ```
 *
 * # This transaction is never executed
 *
 * It is built, serialised with `onlyTransactionKind`, and handed to the key servers, which run it
 * in a dry-run with the requesting reader as sender. Nothing is signed and no gas is spent — which
 * is why no gas budget, gas price or payment is set here and why the absence of them is not an
 * oversight. See {@link approvalBytes}.
 *
 * The call targets `latestPackageId`, like every other call in this SDK: Sui does not resolve a
 * package id to its newest version, so the original address runs the original bytecode. The
 * *namespace* remains the original — see {@link sealPackageId} — and the two being different values
 * is correct rather than a mistake to tidy up.
 */
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

/**
 * Prove a right to one creator-period's key.
 *
 * ```move
 * entry fun seal_approve_subscription(
 *     id: vector<u8>, tier: u64, period: u64, subscription: &Subscription, ctx: &TxContext,
 * )
 * ```
 *
 * `tier` and `period` are passed separately *and* are inside `identity`. That redundancy is the
 * contract's design, not duplication to remove: the assertion `id == period_identity(vault, tier,
 * period)` is what stops a reader naming one period in the arguments and being checked against
 * another.
 */
export function approveSubscription(
  config: ProjectXSocialConfig,
  args: { identity: Uint8Array; tier: bigint; period: bigint; subscriptionId: string },
  tx: Transaction = new Transaction(),
): Transaction {
  tx.moveCall({
    target: `${config.latestPackageId}::entitlement::seal_approve_subscription`,
    arguments: [
      tx.pure.vector('u8', Array.from(args.identity)),
      tx.pure.u64(args.tier),
      tx.pure.u64(args.period),
      tx.object(entitlementRef(args.subscriptionId)),
    ],
  });
  return tx;
}

/**
 * Serialise an approval for the key servers.
 *
 * `onlyTransactionKind: true` is required, not a size optimisation: the reader is not paying for
 * this and in general holds no gas coin, so a fully-built transaction would fail to serialise for
 * want of a gas payment before it ever reached a key server.
 *
 * The client is not optional and cannot be made so. `Subscription` and `Unlock` are owned objects,
 * and an owned object reference in a transaction carries a version and a digest — neither of which
 * is derivable from the id. The builder has to read them, so a build without a client throws rather
 * than producing something shorter.
 */
export async function approvalBytes(
  tx: Transaction,
  client: NonNullable<BuildTransactionOptions['client']>,
): Promise<Uint8Array> {
  return tx.build({ client, onlyTransactionKind: true });
}
