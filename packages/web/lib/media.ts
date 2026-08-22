// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import 'server-only';

/**
 * Media storage, on Walrus.
 *
 * # What this replaced, and why it had to go
 *
 * Bytes were written with `writeFile` to a directory on local disk. On a serverless host that disk
 * is per-instance and discarded with the instance, so an upload landed on a container that then
 * vanished and no other instance could read it. There was no working blob storage in this product
 * at all — which is also why nothing in the interface ever called the upload route.
 *
 * The old file's central claim was that **a public path is never constructed**, and that survives
 * intact: there is still no function here returning a URL, and every byte still reaches a reader
 * through a handler that re-checks entitlement on that request. What changed is only where the
 * bytes rest between those two moments.
 *
 * # Walrus blobs are public, so gating is done by encryption, not by obscurity
 *
 * Any aggregator serves any blob to anybody holding its id — demonstrated, not assumed: a blob
 * stored from this machine was fetched straight back out of a public aggregator with no wallet and
 * no credentials. So the rule is:
 *
 *   - **Gated (paid) media is encrypted before it leaves**, with a fresh key per blob. The
 *     ciphertext being public is then uninteresting.
 *   - **Open (free) media goes up as plaintext, deliberately.** Anyone can read it from any
 *     aggregator without this platform's involvement, which is the property the product argues for
 *     everywhere else — the content outlives us, and cannot be withdrawn by us.
 *
 * # Identifiers are still opaque, and a filename is still never a path
 *
 * An asset id is generated and validated against a strict pattern. It is now a database key rather
 * than a filesystem path, so traversal is no longer expressible at all — but the id is still
 * generated rather than taken from the upload, because it also appears in URLs.
 */

import { createHash, randomBytes } from 'node:crypto';
import { fail, ok, type Reading } from '@projectx-social/sdk';
import { decryptBlob, encryptBlob } from './blob-crypto';
import { grantUpload, type StorageTier } from './publisher-token';
import { readBlob, storeBlob } from './walrus';

export interface Asset {
  id: string;
  postId: string;
  /** Sniffed from the bytes, not taken from the upload's claim. See `detectType`. */
  contentType: string;
  /** Size of the original image, before any encryption. What the reader receives. */
  bytes: number;
  /** The uploader's filename, kept for display only. Never used as a path. */
  label: string;
  /** Of the plaintext, so it can be verified after a decrypt round trip. */
  sha256: string;
  /** The Walrus blob holding these bytes. */
  blobId: string;
  /** The epoch after which Walrus deletes the blob unless the lease is extended. */
  endEpoch: number;
  /** Present exactly when the bytes were encrypted before storage. Null means a public blob. */
  encryption: { key: string; nonce: string } | null;
}

/** Only these are served. An upload whose bytes are anything else is refused. */
const ALLOWED: ReadonlyArray<{ type: string; magic: readonly number[] }> = [
  { type: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47] },
  { type: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  { type: 'image/gif', magic: [0x47, 0x49, 0x46, 0x38] },
  { type: 'image/webp', magic: [0x52, 0x49, 0x46, 0x46] },
];

export const MAX_BYTES = 8 * 1024 * 1024;

/** Generated ids only — 32 hex characters. */
const ASSET_ID = /^[0-9a-f]{32}$/;

/**
 * Identify a file from its leading bytes.
 *
 * The uploader's declared content type is ignored entirely. A browser will happily render whatever
 * the response header claims, so trusting a client-supplied type is how an HTML file gets served as
 * an image and runs as a page on this origin.
 */
export function detectType(bytes: Uint8Array): string | null {
  for (const { type, magic } of ALLOWED) {
    if (magic.every((byte, index) => bytes[index] === byte)) {
      // WEBP's RIFF header is shared with other RIFF containers; check the form type too.
      if (type === 'image/webp') {
        const form = new TextDecoder().decode(bytes.slice(8, 12));
        if (form !== 'WEBP') continue;
      }
      return type;
    }
  }
  return null;
}

export interface StoredAsset extends Asset {}

/**
 * Store an asset on Walrus and return its metadata. The caller records it against a post.
 *
 * Returns a `Reading` rather than throwing, because every way this fails is a fact about the world
 * that the creator needs told to them differently: an unconfigured publisher, a refused token, an
 * unreachable network. A thrown string collapses those into one 400.
 */
export async function storeAsset(input: {
  postId: string;
  label: string;
  bytes: Uint8Array;
  /** The creator's Sui address. Receives the `Blob` object we paid for. */
  owner: string;
  /** How long the lease runs. See `TIER_EPOCHS` — the short tier saves far less than it looks. */
  tier: StorageTier;
  /**
   * True when the post is paid.
   *
   * Kept separate from `tier` on purpose. They happen to align today (free posts are ephemeral,
   * paid ones durable), and conflating them would mean that changing the free tier's lease length
   * silently changed whether free content was encrypted.
   */
  gated: boolean;
}): Promise<Reading<StoredAsset>> {
  const source = 'media store';

  if (input.bytes.length === 0) return fail('malformed', source, 'empty upload');
  if (input.bytes.length > MAX_BYTES) {
    return fail('malformed', source, `upload exceeds ${MAX_BYTES} bytes`);
  }

  const contentType = detectType(input.bytes);
  if (contentType === null) {
    return fail('malformed', source, 'unsupported file type — png, jpeg, gif or webp only');
  }

  // Encrypt first: the token authorises an exact size, and for gated media that is the size of the
  // ciphertext, which is longer than the plaintext by the authentication tag.
  const sealed = input.gated ? encryptBlob(input.bytes) : null;
  const outgoing = sealed === null ? input.bytes : sealed.ciphertext;

  const grant = await grantUpload({ owner: input.owner, size: outgoing.length, tier: input.tier });
  if (!grant.ok) return grant;

  const stored = await storeBlob(outgoing, {
    epochs: grant.value.epochs,
    token: grant.value.token,
    sendObjectTo: input.owner,
  });
  if (!stored.ok) return stored;

  return ok({
    id: randomBytes(16).toString('hex'),
    postId: input.postId,
    contentType,
    bytes: input.bytes.length,
    // Stored for display only. Stripped of anything path-like so it cannot be mistaken for one.
    label: input.label.replace(/[^\w.\- ]+/g, '').slice(0, 120),
    // Of the plaintext, deliberately: it is what `readAsset` can verify after decrypting.
    sha256: createHash('sha256').update(input.bytes).digest('hex'),
    blobId: stored.value.blobId,
    endEpoch: stored.value.endEpoch,
    encryption: sealed === null ? null : { key: sealed.key, nonce: sealed.nonce },
  });
}

/**
 * Read an asset's bytes back.
 *
 * Takes no entitlement argument and performs no check — deliberately, and unchanged from the
 * version this replaced. It is reachable only from a handler that has already decided, and giving
 * it a `reader` parameter would invite a second, independently written access rule. There is one
 * predicate, in `entitlement.ts`.
 *
 * The integrity check at the end is not ceremony. These bytes travelled through storage nobody here
 * operates and came back reassembled from slivers held by ninety-five separate nodes; serving
 * something that is not what was uploaded, under a content type we chose, is worth one hash.
 */
export async function readAsset(
  record: Pick<Asset, 'blobId' | 'sha256' | 'encryption'>,
): Promise<Reading<Uint8Array>> {
  const source = `media asset ${record.blobId}`;

  const blob = await readBlob(record.blobId);
  if (!blob.ok) return blob;

  let bytes: Uint8Array;
  if (record.encryption === null) {
    bytes = blob.value;
  } else {
    try {
      bytes = decryptBlob({
        ciphertext: blob.value,
        key: record.encryption.key,
        nonce: record.encryption.nonce,
      });
    } catch (error) {
      // GCM refused it. Either the stored key is wrong for this blob or the bytes were altered —
      // both mean we have nothing to serve, and neither is a thing to paper over with a partial
      // response.
      return fail('malformed', source, error instanceof Error ? error.message : String(error));
    }
  }

  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== record.sha256) {
    return fail('malformed', source, 'the bytes returned do not match the hash recorded at upload');
  }
  return ok(bytes);
}

export function isValidAssetId(id: string): boolean {
  return ASSET_ID.test(id);
}
