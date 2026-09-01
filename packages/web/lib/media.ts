// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import 'server-only';
import { opaqueDetail } from './opaque';

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
import { sealPeriodKey, sealUnlockKey } from './seal';
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
  /**
   * How the bytes are locked, or `null` for a public blob stored as plaintext.
   *
   * A tagged union rather than a bag of nullable fields, because "which scheme opens this" must be
   * read, never inferred. The two schemes differ in exactly one respect that matters — whether this
   * platform can produce the key — and a reader that guessed wrong would either hand ciphertext to
   * a browser as an image or ask a key server for a key that was never issued.
   */
  encryption: AssetEncryption | null;
}

/**
 * The two custody models, and the seam between them.
 *
 * # `platform` is the interim model, and it is on its way out
 *
 * The 32-byte key sits in our database next to the row. We can decrypt this asset. Every row
 * written before the Seal migration is in this state, and `scripts/seal-migrate-keys.ts` moves them
 * across without touching a stored byte.
 *
 * # `seal` is the one the Terms describe
 *
 * The same ciphertext, under the same nonce, but the key is an `EncryptedObject` that only a
 * threshold of key servers can open — and they open it only after executing
 * `entitlement::seal_approve_*` against the reader's own on-chain entitlement. There is no
 * `key` field here because there is no key here. That absence is the feature.
 */
export type AssetEncryption =
  | {
      scheme: 'platform';
      /** 32 bytes, base64. The secret, held by us. */
      key: string;
      /** 12 bytes, base64. Never secret. */
      nonce: string;
    }
  | {
      scheme: 'seal';
      /** The Seal `EncryptedObject` wrapping the 32-byte key, base64. Safe to publish. */
      wrappedKey: string;
      /**
       * The creator-period this key was sealed to, for subscriber media. Both, or neither.
       *
       * Absent on paid media, whose identity is built from the content key its post already
       * carries. Decimal strings because they are `u64` on chain and reach a browser as headers.
       */
      tier?: string;
      period?: string;
      /**
       * The same 12 bytes as before. The nonce is not secret and does not move with the key — the
       * blob is unchanged, so what opens it is unchanged apart from who can produce the key.
       */
      nonce: string;
    };

/**
 * Which `seal_approve_*` releases this asset's key.
 *
 * Named for the Move function rather than for the post's access level, matching `BodyGate` in
 * `body-storage.ts`: the caller knows about posts, this module knows about gates.
 */
export type AssetGate =
  | { kind: 'unlock'; vaultId: string; contentKey: string }
  | { kind: 'period'; vaultId: string; tier: bigint; period: bigint };

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
   * What this asset is gated by, or `null` for an open post whose bytes go up as plaintext.
   *
   * A boolean before, which was enough when the answer was only "encrypt or not". Sealing needs to
   * know *what the key is released against*, and the honest place to say so is here — the caller
   * has the post and knows; this module would have to guess.
   *
   * Kept separate from `tier` on purpose, as the boolean was. They happen to align today (open
   * posts are ephemeral, gated ones durable), and conflating them would mean that changing the open
   * tier's lease length silently changed whether gated content was encrypted.
   */
  gated: AssetGate | null;
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
  const encrypted = input.gated === null ? null : encryptBlob(input.bytes);
  const outgoing = encrypted === null ? input.bytes : encrypted.ciphertext;

  /*
    Seal the key before anything is bought, stored or written.

    The ordering is the whole point of doing it here rather than after the upload. If the key server
    committee is unreachable or misconfigured, this returns a failure and *nothing has happened*: no
    WAL spent, no blob on Walrus, no row. The alternative — store first, seal second — has a failure
    mode with no good exit, because the recovery from "the bytes are stored and the key cannot be
    sealed" is either to keep the plaintext key (which is the defect this work removes) or to
    abandon a blob that has already been paid for.
  */
  let custody: AssetEncryption | null = null;
  if (input.gated !== null && encrypted !== null) {
    const gate = input.gated;
    const wrapped =
      gate.kind === 'unlock'
        ? await sealUnlockKey({ vaultId: gate.vaultId, contentKey: gate.contentKey, key: encrypted.key })
        : await sealPeriodKey({
            vaultId: gate.vaultId,
            tier: gate.tier,
            period: gate.period,
            key: encrypted.key,
          });
    if (!wrapped.ok) return wrapped;
    /*
      `encrypted.key` is not carried past this point.

      It exists as a local for as long as it takes to seal it and it is never placed on the returned
      record, so there is no path from here to a database column holding it. That is what makes the
      claim in Creator Terms §4.3 structural rather than procedural: not "we choose not to store the
      key", but "the value that would be stored is not in scope by the time a row is built".
    */
    custody = {
      scheme: 'seal',
      wrappedKey: wrapped.value.wrappedKey,
      nonce: encrypted.nonce,
      /*
        Recorded on the asset, not looked up from its post.

        `seal_approve_subscription` takes `tier` and `period` as arguments, so a reader has to be
        told both — and an asset must be able to say what opens it without depending on a column its
        post may never have had. A subscriber post published before body sealing has plaintext words
        and no recorded period; its media should still open.
      */
      ...(gate.kind === 'period'
        ? { tier: gate.tier.toString(), period: gate.period.toString() }
        : {}),
    };
  }

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
    encryption: custody,
  });
}

/**
 * What came back from storage, and whether this server could open it.
 *
 * Two shapes because there are two truths, and collapsing them would mean inventing one. A
 * `platform`-custody asset can be decrypted here, as it always has been. A `seal`-custody asset
 * cannot be — not by policy, but because the key servers release the key only to a reader who
 * signed a session key and holds the entitlement. Returning `Uint8Array` for both would require
 * this function to produce plaintext it cannot produce.
 */
export type OpenedAsset =
  | {
      kind: 'plaintext';
      /** Verified against `sha256` before it is returned. */
      bytes: Uint8Array;
    }
  | {
      kind: 'sealed';
      /** Exactly what is on Walrus. Public already, and meaningless without the key. */
      ciphertext: Uint8Array;
      /** The Seal `EncryptedObject` the reader's browser must open. Base64. */
      wrappedKey: string;
      /** The AES-GCM nonce, base64. Not secret; required to open the blob once the key is out. */
      nonce: string;
    };

/**
 * Read an asset back from storage.
 *
 * Takes no entitlement argument and performs no check — deliberately, and unchanged from the
 * version this replaced. It is reachable only from a handler that has already decided, and giving
 * it a `reader` parameter would invite a second, independently written access rule. There is one
 * predicate, in `entitlement.ts`.
 *
 * # Where the integrity check went for sealed assets
 *
 * For plaintext and platform-custody bytes the hash is still verified here, and it is not ceremony:
 * these bytes travelled through storage nobody here operates and came back reassembled from slivers
 * held by ninety-five separate nodes.
 *
 * For a sealed asset the check cannot happen here, because the plaintext does not exist here. It
 * does not disappear — it moves to the only place that holds the plaintext, the reader's browser,
 * which is handed `sha256` and checks it after decrypting. That is a real consequence of the
 * custody change and is written down rather than dropped: verification follows the plaintext.
 */
export async function readAsset(
  record: Pick<Asset, 'blobId' | 'sha256' | 'encryption'>,
): Promise<Reading<OpenedAsset>> {
  const source = `media asset ${record.blobId}`;

  const blob = await readBlob(record.blobId);
  if (!blob.ok) return blob;

  /*
    Dispatched on the recorded scheme, never on the shape of the row.

    "It has a wrapped key, so it must be sealed" is an inference, and the one time it is wrong it is
    wrong silently. The column says which, and the switch is exhaustive, so a third scheme added
    later fails to compile here instead of falling through to a default that guesses.
  */
  if (record.encryption !== null && record.encryption.scheme === 'seal') {
    return ok({
      kind: 'sealed',
      ciphertext: blob.value,
      wrappedKey: record.encryption.wrappedKey,
      nonce: record.encryption.nonce,
    });
  }

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
      return fail('malformed', source, opaqueDetail(source, error));
    }
  }

  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== record.sha256) {
    return fail('malformed', source, 'the bytes returned do not match the hash recorded at upload');
  }
  return ok({ kind: 'plaintext', bytes });
}

export function isValidAssetId(id: string): boolean {
  return ASSET_ID.test(id);
}
