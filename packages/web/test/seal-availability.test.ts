// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

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

describe('a committee that refuses', () => {
  it('is denied: 403, terminal, and NOT an alarm', () => {
    const failure = classifySealFailure(new NoAccessError('req-1'));
    expect(failure.kind).toBe('denied');
    expect(failure.httpStatus).toBe(403);
    expect(failure.retryable).toBe(false);
    expect(failure.alarm).toBe(false);
    expect(failure.reason).toBe('this is not unlocked for you');
    expect(failure.cause).toBe('NoAccessError');
  });

  it('reaches a caller that only reads `error.message` as a refusal', async () => {
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
    expect((error as SealOpenError).cause).toBeInstanceOf(NoAccessError);
  });

  it('maps a paywall to `denied` and an expired session to `precondition`, never to not-found', () => {
    expect(classifySealFailure(new NoAccessError()).readingKind).toBe('denied');
    expect(classifySealFailure(new ExpiredSessionKeyError()).readingKind).toBe('precondition');
  });
});

describe('a committee that does not answer', () => {
  it('is unavailable: 503, retryable, and it alarms', () => {
    const failure = classifySealFailure(new Error('the operation was aborted due to timeout'));
    expect(failure.kind).toBe('unavailable');
    expect(failure.httpStatus).toBe(503);
    expect(failure.retryable).toBe(true);
    expect(failure.alarm).toBe(true);
    expect(failure.readingKind).toBe('timeout');
  });

  it('never tells the reader anything about what they own', async () => {
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
    const failure = classifySealFailure(new InternalError('req-2'));
    expect(failure).toMatchObject({ kind: 'unavailable', httpStatus: 503, alarm: true });
  });

  it('puts our own misconfiguration in the class that pages us, not in the paywall', () => {
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
    expect(classifySealFailure({ weird: true }).kind).toBe('unavailable');
    expect(classifySealFailure('a string').kind).toBe('unavailable');
    expect(classifySealFailure(undefined).cause).toBe('unknown');
  });

  it('is not fooled by an error whose text merely says "NoAccess"', () => {
    expect(classifySealFailure(new Error('NoAccessError: threshold not met')).kind).toBe(
      'unavailable',
    );
  });
});

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
      expect([failure.cause, failure.alarm]).toEqual([failure.cause, false]);
      expect(failure.reason).toContain('sign again');
    }
  });
});

describe('bytes that are not the bytes that were uploaded', () => {
  it('is corrupt: terminal, alarming, and never retried', () => {
    for (const error of [new InvalidCiphertextError('bad'), new DecryptionError('bad')]) {
      const failure = classifySealFailure(error);
      expect([failure.cause, failure.kind]).toEqual([failure.cause, 'corrupt']);
      expect([failure.cause, failure.retryable]).toEqual([failure.cause, false]);
      expect([failure.cause, failure.httpStatus]).toEqual([failure.cause, 502]);
    }
  });

  it('reports a key that opens nothing as corrupt rather than as an outage', async () => {
    const error = await open(() => Promise.resolve(new Uint8Array(32))).catch((e: unknown) => e);
    expect((error as SealOpenError).failure).toMatchObject({ kind: 'corrupt', httpStatus: 502 });
  });
});

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
