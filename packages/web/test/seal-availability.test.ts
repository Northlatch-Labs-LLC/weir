// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * A refusal and an outage must not leave by the same door.
 *
 * # The defect this exists to keep closed
 *
 * A reader who has paid, whose committee is down, used to be shown the sentence written for a
 * reader who has not paid. It is false, it is alarming on a screen somebody reached by paying, and
 * it sends them to support with a billing question during what is our outage — while nothing at all
 * pages the people who could fix it. Two failures with opposite remedies, reported identically.
 *
 * So the assertions here are not "it throws". They are about which of the four answers each failure
 * produces, and about the three consequences that follow from it: the status a route should send,
 * whether an identical retry could work, and whether an operator should be woken.
 *
 * # Real error instances, never fabricated ones
 *
 * Every case below constructs the actual `@mysten/seal` class. That is not ceremony — it is the one
 * thing that makes this test worth anything. `lib/seal-open.ts` classifies by `instanceof`, because
 * that package declares its whole hierarchy as anonymous class expressions and never assigns
 * `name`, so `error.name` is the string "Error" for a genuine refusal. A test that threw
 * `new Error('NoAccessError')` would be asserting against a shape the classifier correctly does not
 * recognise, and would go green while proving the opposite of what it claims.
 */

import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DecryptionError,
  DeprecatedSDKVersionError,
  ExpiredSessionKeyError,
  GeneralError,
  InternalError,
  InvalidCiphertextError,
  InvalidKeyServerObjectIdError,
  InvalidPTBError,
  InvalidPackageError,
  InvalidParameterError,
  InvalidSessionKeySignatureError,
  InvalidUserSignatureError,
  NoAccessError,
  TooManyFailedFetchKeyRequestsError,
  UnsupportedPackageIdError,
} from '@mysten/seal';
import type { ProjectXSocialConfig } from '@projectx-social/sdk';

import {
  SealOpenError,
  classifySealFailure,
  openSealedMedia,
  type Entitlement,
} from '../lib/seal-open';

if (globalThis.crypto === undefined) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}

const CONFIG: ProjectXSocialConfig = {
  network: 'mainnet',
  grpcUrl: 'https://fullnode.example.invalid:443',
  packageId: `0x${'a1'.repeat(32)}`,
  latestPackageId: `0x${'b2'.repeat(32)}`,
  platformId: `0x${'c3'.repeat(32)}`,
  registryId: `0x${'d4'.repeat(32)}`,
};

const UNLOCK: Entitlement = {
  kind: 'unlock',
  vaultId: `0x${'11'.repeat(32)}`,
  contentKey: 'sealed-on-walrus-001',
  unlockId: `0x${'22'.repeat(32)}`,
};

/**
 * The Move signatures of `seal_approve_unlock`, as the resolver reads them from chain.
 *
 * Stubbed because `approvalBytes` builds a real transaction, and the builder learns from the
 * contract's own signature that the entitlement reference is immutable. The trailing `&TxContext`
 * is present because the real signature has it: a stub one parameter short throws "Incorrect number
 * of arguments", which is a fixture bug that reads exactly like a real one. Same shape as
 * `test/seal-open.test.ts`, which found that out first.
 */
const APPROVE_UNLOCK_SIGNATURE = [
  { reference: null, body: { $kind: 'vector', vector: { $kind: 'u8' } } },
  {
    reference: 'immutable',
    body: {
      $kind: 'datatype',
      datatype: { typeName: `${CONFIG.latestPackageId}::entitlement::Unlock`, typeParameters: [] },
    },
  },
  {
    reference: 'immutable',
    body: {
      $kind: 'datatype',
      datatype: { typeName: '0x2::tx_context::TxContext', typeParameters: [] },
    },
  },
];

/**
 * A client that resolves the reader's owned entitlement object, and nothing else.
 *
 * `approvalBytes` needs the object's version, digest and owner to build the approval the key
 * servers dry-run. Address-owned, like a soulbound entitlement: a shared object would resolve to a
 * `SharedObjectRef` and prove nothing about the owned path this contract actually takes.
 */
function objectClient(): never {
  return {
    core: {
      resolveTransactionPlugin: () => undefined,
      getMoveFunction: () => ({ function: { parameters: APPROVE_UNLOCK_SIGNATURE } }),
      getObjects: ({ objectIds }: { objectIds: string[] }) => ({
        objects: objectIds.map((objectId) => ({
          objectId,
          version: '7',
          digest: '11111111111111111111111111111111',
          owner: { $kind: 'AddressOwner', AddressOwner: `0x${'99'.repeat(32)}` },
        })),
      }),
    },
  } as never;
}

/** A sealed response with real AES-GCM bytes, so the success path is a real decrypt. */
async function sealedMedia(): Promise<{
  media: Parameters<typeof openSealedMedia>[0]['media'];
  key: Uint8Array;
  plaintext: Uint8Array;
}> {
  const plaintext = new TextEncoder().encode('the picture somebody paid for');
  const key = webcrypto.getRandomValues(new Uint8Array(32));
  const nonce = webcrypto.getRandomValues(new Uint8Array(12));
  const imported = await webcrypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, imported, plaintext),
  );
  const digest = new Uint8Array(await webcrypto.subtle.digest('SHA-256', plaintext));
  const sha256 = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');

  return {
    media: { kind: 'sealed', ciphertext, wrappedKey: new Uint8Array([1, 2, 3]), nonce, sha256, contentType: 'image/png' },
    key,
    plaintext,
  };
}

/** Open, with the network step supplied. The seam `lib/seal-open.ts` exists for. */
async function open(recoverKey: () => Promise<Uint8Array>) {
  const { media } = await sealedMedia();
  return openSealedMedia({
    config: CONFIG,
    media,
    entitlement: UNLOCK,
    client: objectClient(),
    recoverKey,
  });
}

/* ------------------------------------------------------------------------------------------------
   A committee that returns a refusal.
   ------------------------------------------------------------------------------------------------ */

describe('a committee that refuses', () => {
  it('is denied: 403, terminal, and NOT an alarm', () => {
    /*
      The one failure in this file that is the product working. `seal_approve_unlock` was executed
      with the reader as sender and the Move code aborted, so the contract said no without our
      participation. A deployment with no denials is a deployment with no paywall — which is why
      this is the only case that must not page anybody.
    */
    const failure = classifySealFailure(new NoAccessError('req-1'));
    expect(failure.kind).toBe('denied');
    expect(failure.httpStatus).toBe(403);
    expect(failure.retryable).toBe(false);
    expect(failure.alarm).toBe(false);
    expect(failure.reason).toBe('this is not unlocked for you');
    expect(failure.cause).toBe('NoAccessError');
  });

  it('reaches a caller that only reads `error.message` as a refusal', async () => {
    // `components/SealedMedia.tsx` renders `error.message` and knows nothing about this type. The
    // fix has to land in the message, or it has not landed where the reader is.
    await expect(open(() => Promise.reject(new NoAccessError('req-1')))).rejects.toThrow(
      'this is not unlocked for you',
    );
  });

  it('carries the whole decision on the thrown error, for a caller that can do better', async () => {
    const error = await open(() => Promise.reject(new NoAccessError('req-1'))).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(SealOpenError);
    expect((error as SealOpenError).failure).toMatchObject({
      kind: 'denied',
      httpStatus: 403,
      alarm: false,
    });
    // The original is kept, so a log that walks the chain still reaches Seal's own requestId.
    expect((error as SealOpenError).cause).toBeInstanceOf(NoAccessError);
  });

  it('maps a paywall to `denied` and an expired session to `precondition`, never to not-found', () => {
    /*
      Before B17 the SDK union had no member meaning "we asked, we were understood, and the answer
      was no", and this field was null for both. `not-found` was never an option: it would make a
      paywall and a deleted post identical in every log line that groups by kind. Now the answer
      "no" is `denied`, and "sign again first" is `precondition` — the loop may wait on the second
      and must stop on the first.
    */
    expect(classifySealFailure(new NoAccessError()).readingKind).toBe('denied');
    expect(classifySealFailure(new ExpiredSessionKeyError()).readingKind).toBe('precondition');
  });
});

/* ------------------------------------------------------------------------------------------------
   A committee that times out, or is otherwise unavailable.
   ------------------------------------------------------------------------------------------------ */

describe('a committee that does not answer', () => {
  it('is unavailable: 503, retryable, and it alarms', () => {
    const failure = classifySealFailure(new Error('the operation was aborted due to timeout'));
    expect(failure.kind).toBe('unavailable');
    expect(failure.httpStatus).toBe(503);
    expect(failure.retryable).toBe(true);
    expect(failure.alarm).toBe(true);
    // A timeout is distinct from a dead socket in the SDK's own vocabulary, and it stays distinct
    // here: one may succeed on retry and the other usually will not.
    expect(failure.readingKind).toBe('timeout');
  });

  it('never tells the reader anything about what they own', async () => {
    /*
      The sentence this whole change exists for. A reader who paid, during our outage, must not be
      told they have not paid — and must be told the retry is worth making.
    */
    const error = await open(() =>
      Promise.reject(new Error('the operation was aborted due to timeout')),
    ).catch((e: unknown) => e);

    const message = (error as Error).message;
    expect(message).toContain('not about what you own');
    expect(message).toContain('trying again');
    expect(message).not.toContain('access');
    expect(message).not.toContain('unlocked');
  });

  it('classifies a dead connection as transport rather than as a timeout', () => {
    expect(classifySealFailure(new Error('connection refused')).readingKind).toBe('transport');
  });

  it('treats an internal key server fault as ours to fix, not the reader’s to explain', () => {
    // Seal's own doc comment on this class: "Internal server error, caller should retry".
    const failure = classifySealFailure(new InternalError('req-2'));
    expect(failure).toMatchObject({ kind: 'unavailable', httpStatus: 503, alarm: true });
  });

  it('puts our own misconfiguration in the class that pages us, not in the paywall', () => {
    /*
      Every one of these is a fault on this side wearing the key server's clothes, and every one of
      them would previously have reached a paying reader as "you do not have access":

        UnsupportedPackageId      the committee is permissioned and has not been told about us
        InvalidPTB / InvalidPackage   we built the approval transaction wrong
        InvalidKeyServerObjectId  the committee list points at something that is not a key server
        DeprecatedSDKVersion      our dependency has aged out of what the servers accept
        InvalidParameter          the object is real and the fullnode has not indexed it yet
        TooManyFailedFetchKeyRequests  we are being shed by the committee

      Not one is the reader's fault. All of them are actionable by an operator, which is the whole
      definition of `alarm`.
    */
    for (const error of [
      new UnsupportedPackageIdError('r'),
      new InvalidPTBError('r'),
      new InvalidPackageError('r'),
      new InvalidKeyServerObjectIdError('r'),
      new DeprecatedSDKVersionError('r'),
      new InvalidParameterError('r'),
      new TooManyFailedFetchKeyRequestsError('shed'),
      new GeneralError('Not Found', 'r', 404),
    ]) {
      const failure = classifySealFailure(error);
      expect([failure.cause, failure.kind]).toEqual([failure.cause, 'unavailable']);
      expect([failure.cause, failure.alarm]).toEqual([failure.cause, true]);
    }
  });

  it('defaults an unrecognised failure to unavailable rather than to a refusal', () => {
    /*
      The direction is deliberate and it is the one that fails safe. An unknown failure called an
      outage produces a page for an operator who discovers it was something else; an unknown failure
      called a refusal produces a paying reader told they have not paid, and nobody told anything.
      One of those is recoverable by a human.
    */
    expect(classifySealFailure({ weird: true }).kind).toBe('unavailable');
    expect(classifySealFailure('a string').kind).toBe('unavailable');
    expect(classifySealFailure(undefined).cause).toBe('unknown');
  });

  it('is not fooled by an error whose text merely says "NoAccess"', () => {
    /*
      The substitution this file's header warns about. A plain `Error` carrying the words is not a
      refusal — it is an unrecognised throw, and treating it as a refusal on the strength of its
      prose is exactly the string-matching that `@mysten/seal`'s unnamed classes make unreliable.
    */
    expect(classifySealFailure(new Error('NoAccessError: threshold not met')).kind).toBe(
      'unavailable',
    );
  });
});

/* ------------------------------------------------------------------------------------------------
   A session that has run out, which is neither.
   ------------------------------------------------------------------------------------------------ */

describe('a reader whose session has expired', () => {
  it('is told to sign again, not that they do not own it and not that we are broken', () => {
    for (const error of [
      new ExpiredSessionKeyError('r'),
      new InvalidUserSignatureError('r'),
      new InvalidSessionKeySignatureError('r'),
    ]) {
      const failure = classifySealFailure(error);
      expect([failure.cause, failure.kind]).toEqual([failure.cause, 'unauthenticated']);
      expect([failure.cause, failure.httpStatus]).toEqual([failure.cause, 401]);
      // Not an alarm: nothing is broken and no operator can shorten a reader's session for them.
      expect([failure.cause, failure.alarm]).toEqual([failure.cause, false]);
      expect(failure.reason).toContain('sign again');
    }
  });
});

/* ------------------------------------------------------------------------------------------------
   Bytes that arrive and are wrong.
   ------------------------------------------------------------------------------------------------ */

describe('bytes that are not the bytes that were uploaded', () => {
  it('is corrupt: terminal, alarming, and never retried', () => {
    for (const error of [new InvalidCiphertextError('bad'), new DecryptionError('bad')]) {
      const failure = classifySealFailure(error);
      // Retrying returns the same bytes. Telling a reader to try again would be a spinner with no
      // end, and rendering them anyway is the failure the hash exists to prevent.
      expect([failure.cause, failure.kind]).toEqual([failure.cause, 'corrupt']);
      expect([failure.cause, failure.retryable]).toEqual([failure.cause, false]);
      expect([failure.cause, failure.httpStatus]).toEqual([failure.cause, 502]);
    }
  });

  it('reports a key that opens nothing as corrupt rather than as an outage', async () => {
    /*
      The committee released a key and the bytes did not open under it. WebCrypto throws here, not
      Seal, so the classifier's honest default would be `unavailable` — which would ask an operator
      to wait for a network that is working perfectly.
    */
    const error = await open(() => Promise.resolve(new Uint8Array(32))).catch((e: unknown) => e);
    expect((error as SealOpenError).failure).toMatchObject({ kind: 'corrupt', httpStatus: 502 });
  });
});

/* ------------------------------------------------------------------------------------------------
   And the case that must keep working.
   ------------------------------------------------------------------------------------------------ */

describe('a committee that succeeds', () => {
  it('returns exactly the bytes that were uploaded, under the recorded content type', async () => {
    const { media, key, plaintext } = await sealedMedia();
    const opened = await openSealedMedia({
      config: CONFIG,
      media,
      entitlement: UNLOCK,
      client: objectClient(),
      recoverKey: () => Promise.resolve(key),
    });

    expect(new TextDecoder().decode(opened.bytes)).toBe(new TextDecoder().decode(plaintext));
    expect(opened.contentType).toBe('image/png');
  });

  it('is not classified at all — nothing is thrown on the path that works', async () => {
    /*
      Worth its own assertion because every other test here is about a throw. A classifier that
      accidentally rejected the success case would have turned the whole paid-media surface into an
      outage, and every one of the tests above would still be green.
    */
    const { media, key } = await sealedMedia();
    await expect(
      openSealedMedia({
        config: CONFIG,
        media,
        entitlement: UNLOCK,
        client: objectClient(),
        recoverKey: () => Promise.resolve(key),
      }),
    ).resolves.toBeDefined();
  });
});
