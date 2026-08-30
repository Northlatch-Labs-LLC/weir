// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * The Seal identity layout, held against the contract byte for byte.
 *
 * # What this suite is actually for
 *
 * `src/seal.ts` re-implements two functions that already exist in Move. A re-implementation of a
 * byte layout is the defect `entitlement.move` warns about in its own comments, and the risk is not
 * theoretical: an identity that differs from the contract's by a single byte encrypts perfectly,
 * stores perfectly, and then cannot be opened by anybody — including the reader who paid, including
 * us. The key servers derive keys for the identity *the contract* computes, so a mismatch is not a
 * failed request, it is content sealed shut for ever.
 *
 * The vectors below are therefore not fixtures. They are the same literals asserted in
 * `sui-contracts/tests/seal_tests.move::the_identity_bytes_are_exactly_these`, which runs them
 * through the Move implementation. Neither suite proves the other correct on its own; together they
 * fail the moment the two languages disagree.
 *
 * If you change one, change both, in one commit, and understand that every asset already encrypted
 * under the old layout becomes permanently unreadable.
 */

import { describe, expect, it } from 'vitest';
import {
  approvalBytes,
  approveSubscription,
  approveUnlock,
  periodIdentity,
  periodOf,
  sealId,
  sealPackageId,
  SEAL_PERIOD_MS,
  SEAL_SUBSCRIPTION,
  SEAL_UNLOCK,
  unlockIdentity,
  type ProjectXSocialConfig,
} from '../src/index.js';

/** The same vault the Move test uses. Structured bytes, so a truncation or a reversal is visible. */
const VAULT = '0x00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
const VAULT_HEX = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

const CONTENT_KEY = new TextEncoder().encode('issue-7');

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('the identity bytes agree with entitlement.move', () => {
  it('derives an unlock identity as <vault> ‖ 0x00 ‖ <content key>', () => {
    // Asserted identically in Move. Do not edit one without the other.
    expect(hex(unlockIdentity(VAULT, CONTENT_KEY))).toBe(
      '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff0069737375652d37',
    );
  });

  it('derives a period identity as <vault> ‖ 0x01 ‖ <tier LE> ‖ <period LE>', () => {
    expect(hex(periodIdentity(VAULT, 3n, 5n))).toBe(
      '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff0103000000000000000500000000000000',
    );
  });

  it('keeps the tag byte even when the content key is empty', () => {
    // The shortest unlock identity is 33 bytes, not 32, which is what stops a zero-length content
    // key from producing a bare vault id that a future tag scheme could collide with.
    expect(hex(unlockIdentity(VAULT, new Uint8Array()))).toBe(`${VAULT_HEX}00`);
  });

  it('encodes u64 fields little-endian, matching std::bcs::to_bytes', () => {
    const identity = periodIdentity(VAULT, 1n, 258n);
    // 258 = 0x0102, little-endian across eight bytes.
    expect(hex(identity.slice(33 + 8))).toBe('0201000000000000');
  });

  it('accepts a short-form vault id by normalising it, never by padding it blindly', () => {
    // `0x6` is the Clock. It is a legitimate 32-byte id written short, and it must derive the same
    // identity as its expanded form — otherwise the same vault produces two different keys
    // depending on how the caller happened to spell it.
    expect(hex(unlockIdentity('0x6', CONTENT_KEY))).toBe(
      hex(unlockIdentity(`0x${'0'.repeat(63)}6`, CONTENT_KEY)),
    );
  });

  it('refuses a vault id that is not an object id at all', () => {
    expect(() => unlockIdentity('not-an-id', CONTENT_KEY)).toThrow(/32-byte hex object id/);
    expect(() => unlockIdentity(`0x${'ab'.repeat(33)}`, CONTENT_KEY)).toThrow(
      /32-byte hex object id/,
    );
  });

  it('keeps the two tags distinct, because a collision sells subscriber content for one unlock', () => {
    expect(SEAL_UNLOCK).toBe(0);
    expect(SEAL_SUBSCRIPTION).toBe(1);
    expect(SEAL_UNLOCK).not.toBe(SEAL_SUBSCRIPTION);
  });

  /*
    The forgery the tag byte exists to stop, stated as a test rather than as a comment.

    Without the separator a creator could publish content under the key `0x01 ‖ tier ‖ period` and
    make an unlock-gated identity byte-identical to a subscription-gated one. With it, the unlock
    identity carries 0x00 at offset 32 and can never equal a subscription identity, whatever the
    content key says.
  */
  it('cannot be made to collide by a crafted content key', () => {
    const crafted = new Uint8Array([
      SEAL_SUBSCRIPTION,
      3, 0, 0, 0, 0, 0, 0, 0,
      5, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(hex(unlockIdentity(VAULT, crafted))).not.toBe(hex(periodIdentity(VAULT, 3n, 5n)));
  });
});

describe('the period arithmetic agrees with entitlement.move', () => {
  it('is a fixed thirty-day width', () => {
    expect(SEAL_PERIOD_MS).toBe(2_592_000_000n);
  });

  it('truncates rather than rounds, on both sides of a boundary', () => {
    // Asserted identically in Move.
    expect(periodOf(0n)).toBe(0n);
    expect(periodOf(2_591_999_999n)).toBe(0n);
    expect(periodOf(2_592_000_000n)).toBe(1n);
    expect(periodOf(2_592_000_001n)).toBe(1n);
  });

  it('stays exact past the range where a float would not', () => {
    // A timestamp beyond 2^53 ms is not a date anybody will see, but the arithmetic must be integer
    // arithmetic for the reason that it is integer arithmetic on chain — not because the input is
    // expected to be large.
    const huge = 9_007_199_254_740_993n; // 2^53 + 1, unrepresentable as a double
    expect(periodOf(huge)).toBe(huge / 2_592_000_000n);
  });
});

describe('the seal id encoding', () => {
  it('is bare lowercase hex with no 0x prefix', () => {
    // `EncryptedObject.parse()` returns `id` as `toHex(bytes)`, which is unprefixed. A prefixed
    // string here would compare unequal to a parsed one while decoding to identical bytes.
    const id = sealId(unlockIdentity(VAULT, CONTENT_KEY));
    expect(id.startsWith('0x')).toBe(false);
    expect(id).toBe(id.toLowerCase());
    expect(id).toMatch(/^[0-9a-f]+$/);
  });

  it('is always an even number of characters, so it cannot be silently left-padded', () => {
    // `fromHex('abc')` yields `0abc` — an odd-length string decodes to something other than what it
    // looks like. Every identity here is byte-derived, so this holds by construction; the assertion
    // is here so that a future encoder change cannot quietly break it.
    expect(sealId(unlockIdentity(VAULT, new Uint8Array())).length % 2).toBe(0);
    expect(sealId(unlockIdentity(VAULT, CONTENT_KEY)).length % 2).toBe(0);
  });
});

const CONFIG: ProjectXSocialConfig = {
  network: 'mainnet',
  grpcUrl: 'https://example.invalid',
  packageId: `0x${'11'.repeat(32)}`,
  latestPackageId: `0x${'22'.repeat(32)}`,
  platformId: `0x${'33'.repeat(32)}`,
  registryId: `0x${'44'.repeat(32)}`,
};

describe('the approval transactions', () => {
  it('namespaces identities under the original package, never the latest', () => {
    // Seal reads the package object and refuses anything whose version is not 1. Only the original
    // publish satisfies that; an upgraded package is version 2+ at a different address.
    expect(sealPackageId(CONFIG)).toBe(CONFIG.packageId);
    expect(sealPackageId(CONFIG)).not.toBe(CONFIG.latestPackageId);
  });

  it('calls seal_approve_unlock on the latest package with the identity and the unlock', () => {
    const tx = approveUnlock(CONFIG, {
      identity: unlockIdentity(VAULT, CONTENT_KEY),
      unlockId: `0x${'aa'.repeat(32)}`,
    });
    const data = tx.getData();
    expect(data.commands).toHaveLength(1);
    const call = data.commands[0]!.MoveCall!;
    // The target is read back rather than trusted, because a programmable transaction is an
    // untyped positional boundary and nothing else checks it.
    expect(call.package).toBe(CONFIG.latestPackageId);
    expect(call.module).toBe('entitlement');
    expect(call.function).toBe('seal_approve_unlock');
    expect(call.arguments).toHaveLength(2);
  });

  it('calls seal_approve_subscription with identity, tier, period and the subscription, in order', () => {
    const tx = approveSubscription(CONFIG, {
      identity: periodIdentity(VAULT, 3n, 5n),
      tier: 3n,
      period: 5n,
      subscriptionId: `0x${'bb'.repeat(32)}`,
    });
    const data = tx.getData();
    const call = data.commands[0]!.MoveCall!;
    expect(call.package).toBe(CONFIG.latestPackageId);
    expect(call.module).toBe('entitlement');
    expect(call.function).toBe('seal_approve_subscription');
    /*
      Four arguments, and the count is the point. `tier` and `period` are both u64 and adjacent, so
      swapping them builds, signs and asks for a key to a different period — which the contract
      then refuses with an identity mismatch, at the key server, a long way from the mistake.
    */
    expect(call.arguments).toHaveLength(4);
  });

  it('composes into one transaction when a reader opens several assets at once', () => {
    const tx = approveUnlock(CONFIG, {
      identity: unlockIdentity(VAULT, CONTENT_KEY),
      unlockId: `0x${'aa'.repeat(32)}`,
    });
    approveUnlock(
      CONFIG,
      { identity: unlockIdentity(VAULT, new Uint8Array([1])), unlockId: `0x${'cc'.repeat(32)}` },
      tx,
    );
    expect(tx.getData().commands).toHaveLength(2);
  });

  it('cannot be serialised without a client, because owned objects carry a version and a digest', async () => {
    const tx = approveUnlock(CONFIG, {
      identity: unlockIdentity(VAULT, CONTENT_KEY),
      unlockId: `0x${'aa'.repeat(32)}`,
    });
    /*
      Asserted as a failure rather than skipped.

      `Unlock` and `Subscription` are owned objects. Their references need a version and a digest
      that only a chain read supplies, so a build without a client must throw — and it must throw
      here rather than produce shorter bytes that a key server would reject as a malformed PTB.
    */
    await expect(approvalBytes(tx, undefined as never)).rejects.toThrow();
  });
});
