// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * Opening a sealed asset, in the browser.
 *
 * # Why this cannot live on the server, and is not `server-only`
 *
 * Every other module that touches media keys in this codebase is `server-only`. This one is the
 * opposite by necessity. A Seal key is released by key servers that execute
 * `entitlement::seal_approve_*` with the **reader** as sender, against a `SessionKey` the reader
 * signed with their own wallet. The server is not the reader, holds no such signature, and has
 * nothing to present — which is the whole content of the promise in Creator Terms §4.3.
 *
 * So the plaintext of a creator's paid media exists in exactly one place: the tab of the person who
 * paid for it.
 *
 * # What this costs, stated plainly rather than discovered later
 *
 * The browser must hold a Sui client. `lib/chain.ts` says, correctly, that "the browser never holds
 * a chain client, never picks an RPC endpoint, and cannot be pointed at a different one by a query
 * parameter" — and that rule cannot survive client-side decryption. Seal's `SessionKey.create`
 * reads the package object, and `SealClient` reads key server objects and calls their HTTP APIs.
 *
 * The mitigation is that the endpoint is not chosen here and cannot be chosen by a URL: it is
 * passed in from the server-rendered config, the same value `siteConfig()` already validated. A
 * reader who tampers with it in their own tab attacks only their own decryption, because nothing
 * this file produces is trusted by anybody else — the ciphertext is public, the wrapped key is
 * public, and the plaintext never leaves the tab.
 *
 * # The split in this file
 *
 * Everything that is arithmetic — parsing the response, unwrapping AES-GCM, verifying the hash — is
 * separated from the one step that needs a threshold committee on the network. That is not tidiness:
 * it is what lets `test/seal-open.test.ts` prove the parts that can be proven offline, including the
 * property that matters most — that ciphertext without the key opens to nothing.
 */

import {
  approvalBytes,
  approveSubscription,
  approveUnlock,
  periodIdentity,
  unlockIdentity,
  type ProjectXSocialConfig,
} from '@projectx-social/sdk';
import type { Transaction } from '@mysten/sui/transactions';

/** GCM's authentication tag, appended to the ciphertext by `blob-crypto.ts`. */
const TAG_BYTES = 16;
/** GCM's nonce. 96 bits, as the mode is specified for. */
const NONCE_BYTES = 12;
/** AES-256. */
const KEY_BYTES = 32;

/** The headers the media route sets on a sealed response. Read in exactly one place — here. */
export const SEAL_HEADERS = {
  encryption: 'x-encryption',
  wrappedKey: 'x-seal-wrapped-key',
  nonce: 'x-blob-nonce',
  sha256: 'x-plaintext-sha256',
  contentType: 'x-plaintext-content-type',
} as const;

/**
 * What the media route returned.
 *
 * `plain` is every asset that is not sealed — public blobs and platform-custody ones, which the
 * server still opens itself. Those keep exactly the behaviour they had, which is the point: this
 * work must not change what a reader sees for content that already worked.
 */
export type MediaResponse =
  | { kind: 'plain'; bytes: Uint8Array; contentType: string }
  | {
      kind: 'sealed';
      ciphertext: Uint8Array;
      /** The Seal `EncryptedObject`, still base64 — handed to `SealClient.decrypt` as bytes. */
      wrappedKey: Uint8Array;
      nonce: Uint8Array;
      /** Hex, of the plaintext. Verified here, because here is where the plaintext appears. */
      sha256: string;
      contentType: string;
    };

function base64ToBytes(value: string, field: string, expected?: number): Uint8Array {
  /*
    `atob` rather than `Buffer`, because this runs in a browser. It throws on anything that is not
    base64, which is the correct response to a header we could not parse — the alternative is a
    silently truncated key that produces an authentication failure attributed to the wrong cause.
  */
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new Error(`${field} is not base64`);
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  if (expected !== undefined && bytes.length !== expected) {
    throw new Error(`${field} must be ${expected} bytes; this one is ${bytes.length}`);
  }
  return bytes;
}

/**
 * Read a media response into the shape the opener needs.
 *
 * Dispatches on the `x-encryption` header, which the server sets, rather than on whether the other
 * headers happen to be present. A response missing half its metadata is an error, not a plain one —
 * treating it as plain would hand a browser ciphertext to render as an image.
 */
export async function readMediaResponse(response: Response): Promise<MediaResponse> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const encryption = response.headers.get(SEAL_HEADERS.encryption);

  if (encryption === null) {
    return {
      kind: 'plain',
      bytes,
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    };
  }
  if (encryption !== 'seal') {
    // An encryption scheme this build does not know. Refused rather than guessed: the two wrong
    // guesses are "render ciphertext" and "ask a key server for a key nobody issued".
    throw new Error(`this build cannot open media encrypted with "${encryption}"`);
  }

  const wrapped = response.headers.get(SEAL_HEADERS.wrappedKey);
  const nonce = response.headers.get(SEAL_HEADERS.nonce);
  const sha256 = response.headers.get(SEAL_HEADERS.sha256);
  const contentType = response.headers.get(SEAL_HEADERS.contentType);
  if (wrapped === null || nonce === null || sha256 === null || contentType === null) {
    throw new Error('a sealed response arrived without the headers needed to open it');
  }

  return {
    kind: 'sealed',
    ciphertext: bytes,
    wrappedKey: base64ToBytes(wrapped, SEAL_HEADERS.wrappedKey),
    nonce: base64ToBytes(nonce, SEAL_HEADERS.nonce, NONCE_BYTES),
    sha256,
    contentType,
  };
}

/**
 * Open the blob once the key has been recovered.
 *
 * `blob-crypto.ts` appends GCM's tag to the ciphertext, and WebCrypto expects exactly that layout —
 * so the bytes are passed through unchanged rather than being split and rejoined. `decrypt` throws
 * on a failed tag check, which is the behaviour that makes a forged or altered blob fail to open
 * instead of decoding to something plausible.
 */
export async function openBlob(input: {
  ciphertext: Uint8Array;
  key: Uint8Array;
  nonce: Uint8Array;
}): Promise<Uint8Array> {
  if (input.key.length !== KEY_BYTES) {
    throw new Error(`a blob key must be ${KEY_BYTES} bytes; this one is ${input.key.length}`);
  }
  if (input.nonce.length !== NONCE_BYTES) {
    throw new Error(`a blob nonce must be ${NONCE_BYTES} bytes; this one is ${input.nonce.length}`);
  }
  if (input.ciphertext.length <= TAG_BYTES) {
    throw new Error('this ciphertext is too short to carry an authentication tag');
  }

  const key = await crypto.subtle.importKey('raw', input.key as BufferSource, 'AES-GCM', false, [
    'decrypt',
  ]);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: input.nonce as BufferSource, tagLength: TAG_BYTES * 8 },
    key,
    input.ciphertext as BufferSource,
  );
  return new Uint8Array(plaintext);
}

/** Lower-case hex SHA-256, to compare against what the server recorded at upload. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * What the reader holds that entitles them, and therefore which approval to build.
 *
 * The object id is required and cannot be derived. `seal_approve_unlock` takes `&Unlock` — an owned
 * object — so the reader's own entitlement object must be named. It is discovered from chain, from
 * the same objects `readEntitlements` already reads on the server.
 */
export type Entitlement =
  | { kind: 'unlock'; vaultId: string; contentKey: string; unlockId: string }
  | {
      kind: 'subscription';
      vaultId: string;
      tier: bigint;
      period: bigint;
      subscriptionId: string;
    };

/** The identity an entitlement covers, derived by the shared code the contract is held against. */
export function identityFor(entitlement: Entitlement): Uint8Array {
  return entitlement.kind === 'unlock'
    ? unlockIdentity(entitlement.vaultId, new TextEncoder().encode(entitlement.contentKey))
    : periodIdentity(entitlement.vaultId, entitlement.tier, entitlement.period);
}

/**
 * Build the transaction the key servers will dry-run to decide.
 *
 * Never signed and never submitted. It is evidence, not an action: the key servers execute it with
 * the reader as sender and release a share if it does not abort.
 */
export function approvalFor(
  config: ProjectXSocialConfig,
  entitlement: Entitlement,
): Transaction {
  const identity = identityFor(entitlement);
  return entitlement.kind === 'unlock'
    ? approveUnlock(config, { identity, unlockId: entitlement.unlockId })
    : approveSubscription(config, {
        identity,
        tier: entitlement.tier,
        period: entitlement.period,
        subscriptionId: entitlement.subscriptionId,
      });
}

/**
 * The one step that needs the network, behind a seam.
 *
 * `SealClient.decrypt` is not called directly by {@link openSealedMedia}; it is passed in. That is
 * what makes the rest of this file testable without a threshold committee — and there is no other
 * way to test it, because there are **no open key servers on Sui mainnet**: every provider requires
 * enrolment and issues an API key.
 *
 * The seam is not a mock in production. The real implementation is three lines at the call site,
 * and it is the only place `@mysten/seal`'s network path is reached from the browser.
 */
export type RecoverKey = (input: {
  wrappedKey: Uint8Array;
  approvalBytes: Uint8Array;
}) => Promise<Uint8Array>;

/**
 * Recover the key, open the blob, and check it is what was uploaded.
 *
 * # Why the hash is checked here and not on the server
 *
 * It used to be checked in `readAsset`, right after decrypting. For a sealed asset the server has no
 * plaintext to hash, so the check did not disappear — it moved to the only place the plaintext
 * exists. These bytes still travelled through storage nobody operates and came back reassembled
 * from slivers held by many separate nodes, so the check is worth as much as it ever was.
 */
export async function openSealedMedia(input: {
  config: ProjectXSocialConfig;
  media: Extract<MediaResponse, { kind: 'sealed' }>;
  entitlement: Entitlement;
  /** A Sui client, only to resolve the owned entitlement object's version and digest. */
  client: Parameters<typeof approvalBytes>[1];
  recoverKey: RecoverKey;
}): Promise<{ bytes: Uint8Array; contentType: string }> {
  const approval = await approvalBytes(
    approvalFor(input.config, input.entitlement),
    input.client,
  );

  const key = await input.recoverKey({
    wrappedKey: input.media.wrappedKey,
    approvalBytes: approval,
  });

  const bytes = await openBlob({
    ciphertext: input.media.ciphertext,
    key,
    nonce: input.media.nonce,
  });

  const digest = await sha256Hex(bytes);
  if (digest !== input.media.sha256) {
    // Not returned with a warning. Bytes that are not what the creator uploaded are not the
    // creator's work, and rendering them under a content type we chose is the failure the hash
    // exists to prevent.
    throw new Error('the bytes returned do not match the hash recorded at upload');
  }

  return { bytes, contentType: input.media.contentType };
}
