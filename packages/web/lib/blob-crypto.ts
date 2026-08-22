// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import 'server-only';

/**
 * Encryption for bytes that are about to leave this server.
 *
 * # Why paid media cannot go to Walrus in the clear
 *
 * A Walrus blob is public. Any aggregator will serve it to anybody holding the blob id, with no
 * check of any kind — that is the point of the network, not a gap in it. So storing a paid post's
 * image as plaintext does not weaken the paywall, it deletes it: the entitlement gate in
 * `app/api/media/[postId]/[assetId]/route.ts` would still be correct and would still be the only
 * door, and the bytes would be reachable through a door we do not own.
 *
 * Encrypting before the store is what makes the blob's publicness irrelevant. The ciphertext can be
 * fetched by anyone; without the key it is noise.
 *
 * # This is an interim custody model, and it is the honest name for it
 *
 * The key produced here is held by this platform, in its own database, next to the asset row. That
 * means **we can decrypt a creator's paid media**, and a buyer's ability to read what they bought
 * still depends on us behaving. On-chain entitlement decides *whether* we release it; it does not
 * yet *enforce* the release.
 *
 * That is strictly better than the state it replaces — bytes on a per-instance serverless disk that
 * vanished with the instance, so nothing could be read by anybody — and strictly worse than where
 * this is going. Seal replaces the key held here with a threshold key released by servers that
 * evaluate a `seal_approve` Move function against the very `Unlock` and `Subscription` objects the
 * entitlement gate already reads.
 *
 * **The migration is designed to move the key, not the bytes.** Ciphertext stored today stays
 * exactly where it is; what changes is who can produce the key that opens it. Nothing in this file
 * is shaped to make that harder: the key is opaque 32 bytes with no structure of ours in it.
 *
 * # AES-256-GCM, and why the nonce is stored rather than derived
 *
 * GCM authenticates as well as encrypts, so a blob altered in transit or by a storage node fails to
 * open rather than decoding to something plausible. Its nonce must never repeat under one key, and
 * the cheapest way to guarantee that is a fresh random nonce with a fresh random key per blob —
 * there is no key reuse here at all, so there is no counter to keep and nothing to get wrong under
 * concurrency.
 */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

/** AES-256. */
const KEY_BYTES = 32;
/** GCM's standard nonce length. 96 bits is what the mode is specified and optimised for. */
const NONCE_BYTES = 12;
/** GCM's authentication tag. Truncating it weakens forgery resistance; this keeps all 128 bits. */
const TAG_BYTES = 16;

/**
 * One blob's key material and ciphertext.
 *
 * Kept as separate fields rather than one concatenated buffer so that the key can be moved to a
 * different custodian — Seal — without rewriting a single stored byte.
 */
export interface EncryptedBlob {
  /** What goes to Walrus. Public, and meaningless without the key. */
  ciphertext: Uint8Array;
  /** 32 bytes, base64. This is the secret; everything else here may be published. */
  key: string;
  /** 12 bytes, base64. Not secret, and must be kept — the blob cannot be opened without it. */
  nonce: string;
}

/**
 * A fresh key, from the system CSPRNG.
 *
 * One per blob, never derived from anything and never reused. A key derived from a post id or a
 * vault id would let anybody who learns the derivation open every blob at once, and the identifiers
 * it would be derived from are all public.
 */
export function newBlobKey(): string {
  return randomBytes(KEY_BYTES).toString('base64');
}

function decodeKey(key: string): Buffer {
  const raw = Buffer.from(key, 'base64');
  if (raw.length !== KEY_BYTES) {
    // Length is checked rather than padded or truncated. A short key silently accepted is a blob
    // encrypted at a strength nobody chose.
    throw new Error(`a blob key must be ${KEY_BYTES} bytes; this one is ${raw.length}`);
  }
  return raw;
}

/**
 * Encrypt bytes for storage.
 *
 * The tag is appended to the ciphertext rather than carried separately: it is not secret, it is
 * fixed length, and keeping the two together means a caller cannot store one and lose the other.
 */
export function encryptBlob(plaintext: Uint8Array, key: string = newBlobKey()): EncryptedBlob {
  if (plaintext.length === 0) throw new Error('refusing to encrypt an empty blob');

  const raw = decodeKey(key);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', raw, nonce);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: new Uint8Array(Buffer.concat([body, tag])),
    key,
    nonce: nonce.toString('base64'),
  };
}

/**
 * Open a stored blob.
 *
 * Throws on a wrong key, a wrong nonce, or a single altered byte — GCM's tag check is what makes
 * "this came back corrupted" distinguishable from "this decrypted to something", and the difference
 * matters when the bytes travelled through storage nobody here operates.
 */
export function decryptBlob(input: {
  ciphertext: Uint8Array;
  key: string;
  nonce: string;
}): Uint8Array {
  const raw = decodeKey(input.key);
  const nonce = Buffer.from(input.nonce, 'base64');
  if (nonce.length !== NONCE_BYTES) {
    throw new Error(`a blob nonce must be ${NONCE_BYTES} bytes; this one is ${nonce.length}`);
  }
  if (input.ciphertext.length <= TAG_BYTES) {
    throw new Error('this ciphertext is too short to carry an authentication tag');
  }

  const body = Buffer.from(input.ciphertext.slice(0, input.ciphertext.length - TAG_BYTES));
  const tag = Buffer.from(input.ciphertext.slice(input.ciphertext.length - TAG_BYTES));

  const decipher = createDecipheriv('aes-256-gcm', raw, nonce);
  decipher.setAuthTag(tag);
  // `final()` is what raises on a failed tag check. Skipping it would return plausible-looking
  // plaintext for a forged blob, which is the whole failure this mode exists to prevent.
  return new Uint8Array(Buffer.concat([decipher.update(body), decipher.final()]));
}

/**
 * Constant-time comparison of two base64 keys.
 *
 * For tests and for any future key-rotation check. `===` on secrets leaks their prefix through
 * timing, and the habit of reaching for it is the thing worth removing rather than the risk in any
 * one call site.
 */
export function sameKey(a: string, b: string): boolean {
  const left = Buffer.from(a, 'base64');
  const right = Buffer.from(b, 'base64');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
