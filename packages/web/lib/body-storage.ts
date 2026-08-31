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
 * Both are sealed to `unlock_identity(vault, contentKey)`. One `Unlock` therefore opens the post's
 * words and its images together — a reader who paid does not acquire the picture and separately
 * fail to acquire the sentence under it. It also means no new Move function and no upgrade: the
 * `seal_approve_unlock` already deployed is what releases this key.
 */

import { createHash } from 'node:crypto';
import { fail, ok, type Reading } from '@projectx-social/sdk';
import { encryptBlob } from './blob-crypto';
import { grantUpload } from './publisher-token';
import { sealUnlockKey } from './seal';
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
  /** The vault the post is priced against. Half of the seal identity. */
  vaultId: string;
  /** The post's content key. The other half. */
  contentKey: string;
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

  const wrapped = await sealUnlockKey({
    vaultId: input.vaultId,
    contentKey: input.contentKey,
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
  });
}
