import { opaqueDetail } from './opaque';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

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

const TAG_BYTES = 16;
const NONCE_BYTES = 12;
const KEY_BYTES = 32;

export const SEAL_HEADERS = {
  encryption: 'x-encryption',
  wrappedKey: 'x-seal-wrapped-key',
  nonce: 'x-blob-nonce',
  sha256: 'x-plaintext-sha256',
  contentType: 'x-plaintext-content-type',
  entitlement: 'x-seal-entitlement',
  vault: 'x-seal-vault',
  entitlementObject: 'x-seal-object',
  contentKey: 'x-seal-content-key',
  tier: 'x-seal-tier',
  period: 'x-seal-period',
  coinType: 'x-seal-coin-type',
} as const;

export type MediaResponse =
  | { kind: 'plain'; bytes: Uint8Array; contentType: string }
  | {
      kind: 'sealed';
      ciphertext: Uint8Array;
      wrappedKey: Uint8Array;
      nonce: Uint8Array;
      sha256: string;
      contentType: string;
      entitlement?: Entitlement;
    };

function base64ToBytes(value: string, field: string, expected?: number): Uint8Array {
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

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type Entitlement =
  | { kind: 'unlock'; vaultId: string; contentKey: string; unlockId: string }
  | {
      kind: 'subscription';
      vaultId: string;
      tier: bigint;
      period: bigint;
      subscriptionId: string;
      coinType: string;
    };

export function identityFor(entitlement: Entitlement): Uint8Array {
  return entitlement.kind === 'unlock'
    ? unlockIdentity(entitlement.vaultId, new TextEncoder().encode(entitlement.contentKey))
    : periodIdentity(entitlement.vaultId, entitlement.tier, entitlement.period);
}

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

export type SealOpenFailureKind = 'denied' | 'unauthenticated' | 'unavailable' | 'corrupt';

export interface SealOpenFailure {
  kind: SealOpenFailureKind;
  httpStatus: 403 | 401 | 503 | 502;
  retryable: boolean;
  alarm: boolean;
  reason: string;
  detail: string;
  cause: string;
  readingKind: FailureKind;
}

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

function corruptFailure(cause: string, detail: string): SealOpenFailure {
  return failure('corrupt', cause, detail);
}

function causeOf(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'unknown';
  const name = (error as { constructor?: { name?: unknown } }).constructor?.name;
  return typeof name === 'string' && name !== '' ? name : 'unknown';
}

function detailOf(error: unknown): string {
  return opaqueDetail('opening a sealed body', error);
}

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
    if (error.status === 403) return failure('denied', cause, detail);
    return failure('unavailable', cause, detail, {
      readingKind: error.status === 408 || error.status === 504 ? 'timeout' : 'transport',
    });
  }

  const readingKind = classify(error, 'Seal key server committee').kind;
  return failure('unavailable', cause, detail, {
    readingKind: readingKind === 'timeout' ? 'timeout' : 'transport',
  });
}

export function isSettling(error: unknown): boolean {
  if (error instanceof InvalidParameterError) return true;

  if (error instanceof NoAccessError) return true;

  return classifySealFailure(error).kind === 'unavailable';
}

export class SealOpenError extends Error {
  readonly failure: SealOpenFailure;

  constructor(failureRecord: SealOpenFailure, cause?: unknown) {
    super(failureRecord.reason, cause === undefined ? undefined : { cause });
    this.name = 'SealOpenError';
    this.failure = failureRecord;
  }
}

export type RecoverKey = (input: {
  wrappedKey: Uint8Array;
  approvalBytes: Uint8Array;
}) => Promise<Uint8Array>;

export async function openSealedMedia(input: {
  config: ProjectXSocialConfig;
  media: Extract<MediaResponse, { kind: 'sealed' }>;
  entitlement: Entitlement;
  client: Parameters<typeof approvalBytes>[1];
  recoverKey: RecoverKey;
}): Promise<{ bytes: Uint8Array; contentType: string }> {
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
    throw new SealOpenError(corruptFailure(causeOf(error), detailOf(error)), error);
  }

  const digest = await sha256Hex(bytes);
  if (digest !== input.media.sha256) {
    throw new SealOpenError(
      corruptFailure(
        'hash-mismatch',
        `expected sha256 ${input.media.sha256}, opened bytes hash to ${digest}`,
      ),
    );
  }

  return { bytes, contentType: input.media.contentType };
}
