import { opaqueDetail } from './opaque';
// Built-by: @projectx.sui · Co-authored-by: Claude
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
 * # Unavailable is not denied, and they used to leave here by the same door
 *
 * Everything below the key-recovery seam used to throw, and every throw arrived at the caller as
 * one `Error` with whatever text the failure happened to carry. So a reader whose key server
 * committee was down, or slow, or misconfigured by us, was shown the same tile as a reader who
 * genuinely has not bought the post. **That is the worst available answer.** It is false, it is
 * alarming on a screen somebody reached by paying, and it routes them to support with a billing
 * question during what is actually our outage — while nothing pages the people who could fix it.
 *
 * `SEAL.md` said this on 21 August, before any of it was built: a refusal that is not a refusal
 * "must not surface as 'you do not have access', which is both wrong and alarming on a screen the
 * buyer reached by paying." `components/SealedMedia.tsx` acted on half of it, with the settling
 * retry for a freshly-minted `Unlock` the fullnode has not indexed yet. This file now carries the
 * other half: the two are told apart by what threw, and the answer is classified rather than
 * printed.
 *
 * {@link classifySealFailure} is that classification, and {@link SealOpenError} is how it reaches a
 * caller that only reads `error.message`.
 *
 * # Why the classification is `instanceof` and not a regular expression
 *
 * Because the strings lie, measured rather than assumed. `@mysten/seal` 1.4.6 declares its whole
 * error hierarchy as anonymous class expressions — `var NoAccessError = class extends SealAPIError
 * {}` — and never assigns `name`. So **`error.name` is the string `"Error"` for every one of
 * them**, including the refusal. Anything that matches on `name` matches nothing; anything that
 * matches on `message` is matching English prose from another package's source, which changes
 * without a major version and without anybody here noticing.
 *
 * It is not a hypothetical. `SealedMedia.tsx`'s `looksLikeSettling` tests
 * `` `${error.name} ${error.message}` `` against `/NoAccess|does not have access|InvalidParameter|…/`.
 * `NoAccessError` matches — through its *message*, "User does not have access to one or more of the
 * requested keys", not through the alternative that was written for it. `InvalidParameterError`
 * matches nothing at all: its name is `"Error"` and its message is "PTB contains an invalid
 * parameter, possibly a newly created object that the FN has not yet seen". That is precisely the
 * settling case the retry was written for, and the retry does not fire on it.
 *
 * Seal's own `toMajorityError` uses `error.constructor.name`, which does resolve — an anonymous
 * class expression assigned to a `var` takes the variable's name. That is what this file would use
 * if `instanceof` were unavailable, and it is noted here rather than used because a bundler that
 * mangles class names would silently turn every refusal into an outage.
 *
 * # How a Seal verdict maps onto the SDK's `FailureKind`
 *
 * Until B17 (2026-09-02) `packages/sdk/src/reading.ts` had no member meaning "we asked, we were
 * understood, and the answer was no", and this file recorded that gap as `readingKind: null` for
 * `denied` and `unauthenticated` rather than write `not-found` — which would have made a paywall
 * and a deleted post identical in every log line that groups by kind. The union now carries
 * `denied` (the answer is no) and `precondition` (the answer is not yet), so every verdict here has
 * an honest kind: `denied` → `denied`; `unauthenticated` → `precondition`, because a fresh
 * signature clears it; `unavailable` → `transport` or `timeout`; `corrupt` → `malformed`. The
 * field is no longer nullable, and a reader grouping by kind sees refusals as refusals.
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
  classify,
  periodIdentity,
  unlockIdentity,
  type FailureKind,
  type ProjectXSocialConfig,
} from '@projectx-social/sdk';
import type { Transaction } from '@mysten/sui/transactions';
/*
  Imported as VALUES, not as types, and that is the whole point.

  `instanceof` needs the constructor at run time. A `import type` here would compile, erase, and
  leave every check against `undefined` — which throws at the first failure, inside the handler for
  a failure. See this file's header for why the alternative, matching on `name` or `message`, does
  not work against this package at all.
*/
import {
  DecryptionError,
  ExpiredSessionKeyError,
  InvalidCiphertextError,
  InvalidParameterError,
  InvalidSessionKeySignatureError,
  InvalidUserSignatureError,
  NoAccessError,
  SealAPIError,
} from '@mysten/seal';

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
  /*
    Which entitlement the route accepted, so the browser can name it back to the key servers.

    The reader cannot work this out alone. `seal_approve_unlock` takes `&Unlock` — an owned object —
    and finding which of a reader's unlocks matches this asset means paging their owned objects and
    decoding each one, which the route has *already done* to decide whether to serve these bytes at
    all. Repeating that walk in the tab would be a second chain read to re-derive an answer the
    server just computed.

    Naming it here grants nothing. Every value is either public on chain or already in this
    response, and the key servers do not take the route's word for any of it: they re-execute
    `seal_approve_unlock` with the reader as sender, so an object the reader does not own aborts.
    This is a hint about where to look, not a credential.
  */
  entitlement: 'x-seal-entitlement',
  vault: 'x-seal-vault',
  entitlementObject: 'x-seal-object',
  contentKey: 'x-seal-content-key',
  /** Both `u64`, sent as decimal strings. A subscription descriptor carries them; an unlock does not. */
  tier: 'x-seal-tier',
  period: 'x-seal-period',
  /** The vault's coin type, needed since v5 to call `creator::seal_approve_subscription<T>`. */
  coinType: 'x-seal-coin-type',
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
      /**
       * Which entitlement the route accepted, when it said.
       *
       * Optional, and deliberately not required: a caller that already knows the entitlement passes
       * it to {@link openSealedMedia} directly, which is how the offline tests drive this without a
       * route. Absent here means "the response did not say", never "the reader has none" — the
       * caller that needs it must refuse rather than substitute a guess, because a guessed object
       * id produces an abort inside a key server and reads back as a decryption failure.
       */
      entitlement?: Entitlement;
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

  const descriptor = readDescriptor(response.headers);

  return {
    kind: 'sealed',
    ciphertext: bytes,
    wrappedKey: base64ToBytes(wrapped, SEAL_HEADERS.wrappedKey),
    nonce: base64ToBytes(nonce, SEAL_HEADERS.nonce, NONCE_BYTES),
    sha256,
    contentType,
    ...(descriptor === undefined ? {} : { entitlement: descriptor }),
  };
}

/**
 * The entitlement descriptor, if the route sent one.
 *
 * Returns `undefined` for a response that carries none, and throws for one that carries a partial
 * or unknown descriptor. The distinction matters: silence is a caller's problem to handle, whereas
 * half a descriptor is a bug on the wire, and quietly ignoring it would send the browser to the key
 * servers with a plausible-looking request built from whatever happened to be present.
 */
function readDescriptor(headers: Headers): Entitlement | undefined {
  const kind = headers.get(SEAL_HEADERS.entitlement);
  if (kind === null) return undefined;

  const vaultId = headers.get(SEAL_HEADERS.vault);
  const objectId = headers.get(SEAL_HEADERS.entitlementObject);
  if (vaultId === null || objectId === null) {
    throw new Error('a sealed response named an entitlement without saying which object it is');
  }

  if (kind === 'unlock') {
    const contentKey = headers.get(SEAL_HEADERS.contentKey);
    if (contentKey === null) {
      throw new Error('an unlock entitlement arrived without the content key it covers');
    }
    return { kind: 'unlock', vaultId, contentKey, unlockId: objectId };
  }

  if (kind === 'subscription') {
    const tier = headers.get(SEAL_HEADERS.tier);
    const period = headers.get(SEAL_HEADERS.period);
    if (tier === null || period === null) {
      throw new Error('a subscription entitlement arrived without the tier and period it covers');
    }
    /*
      Parsed as `bigint`, never as `number`.

      Both are `u64` on chain. A `Number` round-trip is lossless for every value anyone will see and
      lossy eventually, and the failure is silent: an identity built from a rounded period is the
      right length and the wrong bytes, so the key server refuses it in a way that reads exactly
      like the reader having no subscription. `BigInt()` throws on anything that is not an integer,
      which is the behaviour worth having on a header a proxy could mangle.
    */
    const coinType = headers.get(SEAL_HEADERS.coinType);
    if (coinType === null) {
      throw new Error('a subscription entitlement arrived without the vault coin type the approval must name');
    }
    return {
      kind: 'subscription',
      vaultId,
      tier: BigInt(tier),
      period: BigInt(period),
      subscriptionId: objectId,
      coinType,
    };
  }

  throw new Error(`this build cannot open media entitled by "${kind}"`);
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
      /** The vault's coin type: the approval names `CreatorVault<T>` (v5). Routes always send it. */
      coinType: string;
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
        vaultId: entitlement.vaultId,
        coinType: entitlement.coinType,
      });
}

/* ------------------------------------------------------------------------------------------------
   Telling a refusal from an outage.
   ------------------------------------------------------------------------------------------------ */

/**
 * The four answers, and the four different things a product should do about them.
 *
 * `denied` — the contract was consulted and said no. Terminal, correct, and the only one of these
 *   a reader should ever be told in the words "you do not have access". Not an alarm: it is the
 *   paywall doing its job, and a deployment with no denials is a deployment with no paywall.
 * `unauthenticated` — the reader's `SessionKey` is missing, expired or badly signed. Terminal until
 *   they sign again, at which point it resolves. Neither a refusal nor an outage, and folding it
 *   into either would be a lie in a different direction: into `denied` and a reader who owns the
 *   post is told they do not; into `unavailable` and a page fires for something no operator can fix.
 * `unavailable` — the key servers, the fullnode or the network did not answer, or answered with a
 *   fault of ours. Retryable, and **the one that must alarm**. Every member of this class is a
 *   thing an operator can act on, and none of them is the reader's fault.
 * `corrupt` — bytes arrived and are not the bytes that were uploaded: a failed GCM tag, a wrapped
 *   key that will not parse, a hash that does not match. Terminal, alarms, and never retried —
 *   retrying returns the same bytes, and rendering them anyway is the failure the hash exists to
 *   prevent.
 */
export type SealOpenFailureKind = 'denied' | 'unauthenticated' | 'unavailable' | 'corrupt';

export interface SealOpenFailure {
  kind: SealOpenFailureKind;
  /**
   * What a route serving this on the reader's behalf should answer with.
   *
   * 403 for `denied` and 503 for `unavailable` are the two the brief for this work named, and they
   * are the pair that were previously indistinguishable. 401 for `unauthenticated` because the
   * remedy is a fresh signature, which is what that code asks for. 502 for `corrupt` because the
   * fault is in what an upstream returned, and a 500 would blame this application for bytes it
   * never held the key to.
   */
  httpStatus: 403 | 401 | 503 | 502;
  /** Whether an identical retry could succeed without the reader doing anything. */
  retryable: boolean;
  /** Whether an operator should be woken. True for exactly the classes an operator can fix. */
  alarm: boolean;
  /** For the reader. Says what happened to them, and never accuses them of not having paid. */
  reason: string;
  /** For the operator and the log. The underlying text, unmodified — never a guess at what it meant. */
  detail: string;
  /**
   * Which class threw, by `constructor.name`.
   *
   * Recorded rather than matched on: it is what Seal's own `toMajorityError` groups by, so it is the
   * string an operator will see in Seal's own diagnostics, and having it here makes our log and
   * theirs joinable. `'unknown'` when the thrown value is not an object with a constructor.
   */
  cause: string;
  /**
   * The SDK `FailureKind` this verdict is, for a log or a dashboard that groups by kind.
   *
   * Never `not-found` for a refusal: that would make a paywall indistinguishable from a deleted
   * post. `denied` is `denied`; `unauthenticated` is `precondition` (a fresh signature clears it).
   * See the header for the mapping and for why this field was once nullable.
   */
  readingKind: FailureKind;
}

/**
 * The vocabulary a reader is shown, in one place.
 *
 * Held as a constant rather than inlined so that the sentence a paying reader sees during our
 * outage is reviewable as a sentence, by somebody who is not reading a `switch`.
 */
const REASONS: Record<SealOpenFailureKind, string> = {
  denied: 'this is not unlocked for you',
  unauthenticated: 'your reading session has expired — sign again to open this',
  unavailable:
    'this could not be opened right now. The key servers that hold the key did not answer; ' +
    'this is not about what you own, and it is worth trying again shortly',
  corrupt: 'this file did not arrive intact, so it was not shown',
};

function failure(
  kind: SealOpenFailureKind,
  cause: string,
  detail: string,
  overrides: Partial<SealOpenFailure> = {},
): SealOpenFailure {
  const base: Record<SealOpenFailureKind, Omit<SealOpenFailure, 'cause' | 'detail'>> = {
    denied: {
      kind: 'denied',
      httpStatus: 403,
      retryable: false,
      alarm: false,
      reason: REASONS.denied,
      readingKind: 'denied',
    },
    unauthenticated: {
      kind: 'unauthenticated',
      httpStatus: 401,
      retryable: false,
      alarm: false,
      reason: REASONS.unauthenticated,
      readingKind: 'precondition',
    },
    unavailable: {
      kind: 'unavailable',
      httpStatus: 503,
      retryable: true,
      alarm: true,
      reason: REASONS.unavailable,
      readingKind: 'transport',
    },
    corrupt: {
      kind: 'corrupt',
      httpStatus: 502,
      retryable: false,
      alarm: true,
      reason: REASONS.corrupt,
      readingKind: 'malformed',
    },
  };
  return { ...base[kind], cause, detail, ...overrides };
}

/**
 * The `corrupt` verdict, for the two failures that do not come from Seal at all.
 *
 * WebCrypto's tag check and this file's own hash comparison both mean "the bytes are wrong", and
 * neither throws anything {@link classifySealFailure} could recognise — its honest default for an
 * unrecognised throw is `unavailable`, which for these two would ask an operator to wait for a
 * network that is working perfectly.
 */
function corruptFailure(cause: string, detail: string): SealOpenFailure {
  return failure('corrupt', cause, detail);
}

/** `constructor.name`, defensively. See {@link SealOpenFailure.cause}. */
function causeOf(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'unknown';
  const name = (error as { constructor?: { name?: unknown } }).constructor?.name;
  return typeof name === 'string' && name !== '' ? name : 'unknown';
}

function detailOf(error: unknown): string {
  /*
    Opaque to the caller, real in the log. These failures name key-server hosts and library
    internals, and this module's readings reach a browser.
  */
  return opaqueDetail('opening a sealed body', error);
}

/**
 * Decide which of the four a thrown value is.
 *
 * # Every branch, and why it is where it is
 *
 * **`denied`** is one class and one status: `NoAccessError`, which the key server returns when it
 * executed `seal_approve_*` with the reader as sender and the Move code aborted. That is the
 * contract's answer, arrived at without our participation, and it is the only thing in this
 * function entitled to tell a reader they have not paid. A bare `SealAPIError` carrying HTTP 403 is
 * admitted alongside it, because a 403 from a key server is that same answer in the transport's
 * vocabulary.
 *
 * **`unauthenticated`** is the three session classes. `ExpiredSessionKeyError` is the ordinary one
 * — sessions are ten minutes and readers linger. `InvalidUserSignatureError` and
 * `InvalidSessionKeySignatureError` mean the signature over the session message did not verify,
 * which is a wallet or a stale session rather than an entitlement, and telling that reader they do
 * not own the post would be wrong about the one thing they can see is true.
 *
 * **`unavailable`** is everything else, and it is deliberately the default rather than a list.
 * That direction is chosen on purpose: an unrecognised failure classified as an outage produces a
 * page for an operator who then discovers it was something else, while an unrecognised failure
 * classified as a refusal produces a paying reader told they have not paid and nobody told anything
 * at all. One of those errors is recoverable by a human; the other is a customer we lose quietly.
 *
 * It is worth naming what falls in here rather than leaving it to the default, because several are
 * *our* faults wearing the key server's clothes: `UnsupportedPackageIdError` means a permissioned
 * committee has not been configured for our package, `InvalidPTBError` and `InvalidPackageError`
 * mean we built the approval wrong, `InvalidKeyServerObjectIdError` means the committee list points
 * at something that is not a key server, and the SDK-version classes mean our dependency has aged
 * out. **Not one of those is the reader's fault, and every one of them would previously have read
 * to that reader as a paywall.**
 *
 * **`corrupt`** is `InvalidCiphertextError` and `DecryptionError` — the bytes, not the permission.
 *
 * # `instanceof`, and the one place it cannot reach
 *
 * A `SealClient` in another realm — a worker, an iframe, a second copy of the package in the
 * bundle — throws instances that fail `instanceof` against the classes imported here. The fallback
 * is `unavailable`, per the default above, which is the safe direction. It is not papered over with
 * a `constructor.name` comparison: that would quietly re-introduce string matching for the exact
 * case where the strings are least trustworthy.
 */
export function classifySealFailure(error: unknown): SealOpenFailure {
  const cause = causeOf(error);
  const detail = detailOf(error);

  if (error instanceof NoAccessError) return failure('denied', cause, detail);

  if (
    error instanceof ExpiredSessionKeyError ||
    error instanceof InvalidUserSignatureError ||
    error instanceof InvalidSessionKeySignatureError
  ) {
    return failure('unauthenticated', cause, detail);
  }

  if (error instanceof InvalidCiphertextError || error instanceof DecryptionError) {
    return failure('corrupt', cause, detail);
  }

  if (error instanceof SealAPIError) {
    // A key server that answered in HTTP but not in Seal's vocabulary. 403 is the contract's no
    // arriving as a status code; everything else here is an outage or a fault of ours.
    if (error.status === 403) return failure('denied', cause, detail);
    return failure('unavailable', cause, detail, {
      readingKind: error.status === 408 || error.status === 504 ? 'timeout' : 'transport',
    });
  }

  // A deadline, an `AbortSignal`, or a fetch that never completed. Classified by the SDK's own
  // `classify`, which is conservative in the same direction and already knows the words a gRPC or
  // fetch timeout uses.
  const readingKind = classify(error, 'Seal key server committee').kind;
  return failure('unavailable', cause, detail, {
    readingKind: readingKind === 'timeout' ? 'timeout' : 'transport',
  });
}

/**
 * A failure with its classification attached, thrown where an `Error` is what a caller catches.
 *
 * # Why this throws rather than returning a union
 *
 * `openSealedMedia` already threw, and `components/SealedMedia.tsx` already catches and renders
 * `error.message`. Turning the return type into a `Reading`-style union would be the tidier shape
 * and would require that component to change in the same breath — so the fix would land in two
 * places at once, in a file this change does not own, and a reader whose committee is down would
 * keep seeing the paywall until the second half arrived.
 *
 * Throwing this instead fixes the defect where it is: the message a caller renders without knowing
 * anything about this type is now the right sentence for the right class of failure. A caller that
 * wants to do better — a 503 with `retry-after` instead of a 403, an alarm, a retry — reads
 * `.failure` and gets the whole decision.
 *
 * `cause` is set to the original error so nothing is lost. That is the standard `Error` option, and
 * it means a log that walks the chain still reaches Seal's own class and its `requestId`.
 */
/**
 * A refusal that is the chain catching up, not a reader without entitlement.
 *
 * # Why this is not `looksLikeSettling`'s regex, and why that regex never worked
 *
 * `SealedMedia.tsx` matched on `` `${error.name} ${error.message}` `` against
 * `/NoAccess|does not have access|InvalidParameter|NotFound|not yet exist/i`. **Measured against
 * `@mysten/seal` 1.4.6, every error in that library reports `error.name === "Error"`** — the
 * hierarchy is declared as anonymous class expressions (`var NoAccessError = class extends
 * SealAPIError {}`) and `name` is never assigned. So the name half of that string matched nothing,
 * ever, and each class had to be caught by its message text instead.
 *
 * `NoAccessError` survived on "does not have access". **`InvalidParameterError` did not.** Its
 * message is *"PTB contains an invalid parameter, possibly a newly created object that the FN has
 * not yet seen"* — the regex looks for "not yet **exist**". One word apart, and it is the exact
 * error a freshly-minted `Unlock` produces while the fullnode is still indexing it.
 *
 * Which means the retry did not fire on the one case it was written for: **a reader who has just
 * paid, told they have no access.** `SEAL.md` predicted this failure on 21 August and the retry was
 * added to prevent it; the predicate silently excluded it.
 *
 * So: `instanceof`, which is the only thing `@mysten/seal` gives us that is reliable. Structural
 * matching on a library's prose is a test of its release notes.
 */
export function isSettling(error: unknown): boolean {
  // The FN has not indexed a just-created object yet. The entitlement is real; the node is behind.
  if (error instanceof InvalidParameterError) return true;

  /*
    A genuine "no" *and* the shape a settling `Unlock` takes when the server maps a `NotFound` to a
    refusal. Retrying it is bounded — four attempts, ~15 seconds — so a reader who truly has no
    entitlement pays those seconds and is then told plainly. The alternative is telling a buyer
    they did not buy.
  */
  if (error instanceof NoAccessError) return true;

  // Any transport-shaped failure: the committee was unreachable, not the reader unentitled.
  return classifySealFailure(error).kind === 'unavailable';
}

export class SealOpenError extends Error {
  readonly failure: SealOpenFailure;

  constructor(failureRecord: SealOpenFailure, cause?: unknown) {
    super(failureRecord.reason, cause === undefined ? undefined : { cause });
    // Assigned, because an anonymous-subclass `name` is exactly the trap this file documents in its
    // header. A caught `SealOpenError` must be identifiable without `instanceof` for the benefit of
    // logs, even though nothing in this codebase identifies it that way.
    this.name = 'SealOpenError';
    this.failure = failureRecord;
  }
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
  /*
    Building the approval reads the reader's owned entitlement object from a fullnode, so it fails
    for network reasons as readily as the key servers do — and it fails BEFORE any key server is
    asked. Classified here rather than left to the catch below so that an unreachable fullnode is
    never reported as a committee problem, which is the wrong page for the wrong team.
  */
  let approval: Uint8Array;
  try {
    approval = await approvalBytes(approvalFor(input.config, input.entitlement), input.client);
  } catch (error) {
    throw new SealOpenError(classifySealFailure(error), error);
  }

  let key: Uint8Array;
  try {
    key = await input.recoverKey({
      wrappedKey: input.media.wrappedKey,
      approvalBytes: approval,
    });
  } catch (error) {
    throw new SealOpenError(classifySealFailure(error), error);
  }

  let bytes: Uint8Array;
  try {
    bytes = await openBlob({
      ciphertext: input.media.ciphertext,
      key,
      nonce: input.media.nonce,
    });
  } catch (error) {
    /*
      A failed GCM tag, or a key of the wrong length. Neither is a permission question: the
      committee released a key and the bytes did not open under it, so either the bytes or the key
      are wrong, and no amount of entitlement changes that. Stated as `corrupt` rather than run
      through `classifySealFailure`, because what threw here is WebCrypto rather than Seal and the
      classifier's honest default for an unrecognised throw is `unavailable` — which would ask an
      operator to wait for a network that is working.
    */
    throw new SealOpenError(corruptFailure(causeOf(error), detailOf(error)), error);
  }

  const digest = await sha256Hex(bytes);
  if (digest !== input.media.sha256) {
    // Not returned with a warning. Bytes that are not what the creator uploaded are not the
    // creator's work, and rendering them under a content type we chose is the failure the hash
    // exists to prevent.
    throw new SealOpenError(
      corruptFailure(
        'hash-mismatch',
        `expected sha256 ${input.media.sha256}, opened bytes hash to ${digest}`,
      ),
    );
  }

  return { bytes, contentType: input.media.contentType };
}
