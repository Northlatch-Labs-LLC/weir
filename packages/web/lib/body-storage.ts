// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import 'server-only';

/**
 * Sealing the words, not only the pictures.
 *
 * # Why this exists
 *
 * Creator Terms §4.3 says "bodies of gated posts are encrypted client-side with Seal. Northlatch
 * cannot read them." The Privacy Policy says the same twice. Until this file, none of it was true:
 * a paid post's body was a `text` column in Postgres, and two of them were read out of it in a
 * single query on 2026-08-31. The media was genuinely sealed; the words beside it were not.
 *
 * A paid post is mostly words. Sealing the image and leaving the prose in a database column
 * protects the least valuable half of what a writer sells.
 *
 * # Why a body does not go through `storeAsset`
 *
 * `storeAsset` calls `detectType`, which admits png, jpeg, gif and webp and nothing else. That
 * allowlist is a security control: it is what stops an HTML file being stored and later served as
 * an image from this origin. Widening it to admit text would trade a real protection for code
 * reuse, so a body takes its own path and borrows the same primitives instead.
 *
 * # The identity is deliberately the same as the media's
 *
 * A paid post's words and its images are both sealed to `unlock_identity(vault, contentKey)`. One
 * `Unlock` therefore opens them together — a reader who paid does not acquire the picture and
 * separately fail to acquire the sentence under it. It also means no new Move function and no
 * upgrade: the `seal_approve_unlock` already deployed is what releases this key.
 *
 * # And a subscriber post is sealed to a period, not to itself
 *
 * `period_identity(vault, tier, period)`, released by `seal_approve_subscription`. The period index
 * is the load-bearing part: a Seal key is permanent, so one identity per tier would mean a single
 * month's subscription buying that creator's archive in perpetuity, including everything published
 * after the subscription lapsed. `lib/seal.ts` carries the full reasoning.
 *
 * Two consequences are accepted deliberately, not overlooked. **A new subscriber cannot read the
 * back catalogue** — their `Subscription` does not cover periods that ended before they joined, and
 * back-catalogue access has to be sold, which is what `Unlock` already exists for. And **the period
 * width is frozen**: `entitlement::seal_period_ms` is a constant precisely because changing it
 * re-partitions every identity ever issued and strands keys on both sides of the change.
 */

import { createHash } from 'node:crypto';
import { fail, ok, type Reading } from '@projectx-social/sdk';
import { encryptBlob } from './blob-crypto';
import { grantUpload } from './publisher-token';
import { sealPeriodKey, sealUnlockKey } from './seal';
import { storeBlob } from './walrus';

/**
 * The largest body this will seal.
 *
 * `MAX_POST_BODY_LENGTH` bounds what the publish route accepts in characters; this bounds what
 * reaches Walrus in bytes, after UTF-8 expansion. Deliberately generous against that limit rather
 * than equal to it — a body of emoji is four bytes a character and would otherwise be refused at
 * the storage step, after the signature had already been spent.
 */
const MAX_BODY_BYTES = 512 * 1024;

/**
 * Which `seal_approve_*` will be asked to release this body's key.
 *
 * Named for the Move function rather than for the post's access level, because that is what the
 * value decides. `paid` maps to `unlock` and `subscribers` to `period`, but the mapping belongs to
 * the caller that knows about posts; this module knows about gates.
 */
export type BodyGate =
  | { kind: 'unlock'; contentKey: string }
  | { kind: 'period'; tier: bigint; period: bigint };

export interface SealedBody {
  /** Walrus blob id. Public — the bytes there are ciphertext. */
  blobId: string;
  /** The epoch after which Walrus deletes the blob unless the lease is extended. */
  endEpoch: number;
  /** AES-GCM nonce, base64. Public: useless without the key. */
  nonce: string;
  /** The Seal `EncryptedObject`, base64. Public: useless without a threshold of key servers. */
  sealWrappedKey: string;
  /** Of the plaintext, hex. Verified in the reader's tab, where the plaintext appears. */
  sha256: string;
  /** Bytes of the plaintext, for display. Not of the ciphertext. */
  bytes: number;
  /**
   * Present only for a period-sealed body. Both, or neither.
   *
   * Decimal strings, not `bigint`s. They are `u64` on chain, they end up in a `bigint` column and
   * in JSON on its way to a browser, and neither of those round-trips a JavaScript `number`
   * safely. Taken as `bigint` on the way in — where they build an identity and precision is
   * load-bearing — and handed back as strings, which is what every consumer downstream stores or
   * serialises.
   */
  tier?: string;
  period?: string;
}

/**
 * Encrypt a gated post's body, seal its key to the post's content, and store the ciphertext.
 *
 * The plaintext never leaves this function and the AES key is not on the returned record — the
 * same discipline `storeAsset` keeps, and for the same reason. There is no path from here to a
 * column holding the key, because by the time a row is built the value that would be stored is
 * already out of scope.
 */
export async function storeBody(input: {
  body: string;
  /** The vault the post belongs to. Every Seal identity in this system begins with it. */
  vaultId: string;
  /**
   * Which gate opens these words.
   *
   * A discriminated union rather than two optional fields, because the two gates need disjoint
   * information and "contentKey and tier are both optional" is a shape in which supplying neither
   * type-checks. There is no third case: a `public` post is not sealed at all, and this function is
   * not called for one.
   */
  gate: BodyGate;
  /** The creator's address. Receives the `Blob` object the platform pays for. */
  owner: string;
}): Promise<Reading<SealedBody>> {
  const source = 'body storage';

  const plaintext = new TextEncoder().encode(input.body);
  if (plaintext.length === 0) {
    return fail('malformed', source, 'a gated body cannot be empty');
  }
  if (plaintext.length > MAX_BODY_BYTES) {
    return fail('malformed', source, `body exceeds ${MAX_BODY_BYTES} bytes once encoded`);
  }

  // Encrypt first: the upload grant authorises an exact size, and the size that travels is the
  // ciphertext's — longer than the plaintext by GCM's authentication tag.
  const encrypted = encryptBlob(plaintext);

  const wrapped =
    input.gate.kind === 'unlock'
      ? await sealUnlockKey({
          vaultId: input.vaultId,
          contentKey: input.gate.contentKey,
          key: encrypted.key,
        })
      : await sealPeriodKey({
          vaultId: input.vaultId,
          tier: input.gate.tier,
          period: input.gate.period,
          key: encrypted.key,
        });
  if (!wrapped.ok) return wrapped;

  /*
    `durable`, always.

    A body is not media and does not follow `tierForAccess`. The ephemeral tier is one epoch — a
    fortnight — and a paid post whose words evaporate after two weeks while the reader keeps an
    `Unlock` that entitles them forever is a promise the storage cannot keep. Words are also small:
    the cost difference between tiers on a few kilobytes is not a reason to shorten the lease on
    something somebody bought.
  */
  const grant = await grantUpload({
    owner: input.owner,
    size: encrypted.ciphertext.length,
    tier: 'durable',
  });
  if (!grant.ok) return grant;

  const stored = await storeBlob(encrypted.ciphertext, {
    epochs: grant.value.epochs,
    token: grant.value.token,
    sendObjectTo: input.owner,
  });
  if (!stored.ok) return stored;

  return ok({
    blobId: stored.value.blobId,
    endEpoch: stored.value.endEpoch,
    nonce: encrypted.nonce,
    sealWrappedKey: wrapped.value.wrappedKey,
    // Of the plaintext, deliberately: it is what a reader verifies after decrypting, and the
    // ciphertext's own integrity is already covered by GCM's tag.
    sha256: createHash('sha256').update(plaintext).digest('hex'),
    bytes: plaintext.length,
    /*
      Carried out so the row records them, because the reader has to name them back.

      `seal_approve_subscription` takes `tier` and `period` as arguments and asserts
      `id == period_identity(vault, tier, period)`. They are not recoverable from anything else the
      row holds: the period is the one the post was published in and drifts from `periodOf(now)` the
      moment a month passes, and the tier is a publishing choice. Recomputing either at read time is
      the bug that arrives on its own, in production, thirty days later.
    */
    ...(input.gate.kind === 'period'
      ? { tier: input.gate.tier.toString(), period: input.gate.period.toString() }
      : {}),
  });
}
