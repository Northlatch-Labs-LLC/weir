// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { createDecipheriv, createHash } from 'node:crypto';

import { EncryptedObject, InvalidParameterError, NoAccessError, SealClient, SessionKey } from '@mysten/seal';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import type { Transaction } from '@mysten/sui/transactions';
import {
  approvalBytes,
  approveSubscription,
  approveUnlock,
  createClient,
  periodIdentity,
  sealId,
  sealPackageId,
  unlockIdentity,
  type ProjectXSocialConfig,
  type SealConfig,
} from '@projectx-social/sdk';

import type { AgentKey } from './keys.js';

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

const SESSION_TTL_MIN = 10;

const SETTLING_ATTEMPTS = 4;
const SETTLING_BACKOFF_MS = [1500, 3500, 6000] as const;

export const PUBLIC_WALRUS_AGGREGATORS = [
  'https://aggregator.walrus-mainnet.walrus.space',
  'https://walrus.globalstake.io',
] as const;

export type SealApproval =
  | { kind: 'unlock'; vaultId: string; contentKey: string; unlockId: string }
  | {
      kind: 'subscription';
      vaultId: string;
      tier: bigint;
      period: bigint;
      subscriptionId: string;
      coinType: string;
    };

export interface SealedRef {
  blobId: string;
  sealWrappedKey: string;
  nonce: string;
  sha256: string;
  approval: SealApproval;
}

export class SealHashMismatchError extends Error {
  override readonly name = 'SealHashMismatchError';
  constructor(
    readonly blobId: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(
      `the bytes returned for blob ${blobId} do not match the hash recorded at publish ` +
        `(expected ${expected}, got ${actual})`,
    );
  }
}

export type RecoverKey = (input: {
  wrappedKey: Uint8Array;
  txBytes: Uint8Array;
}) => Promise<Uint8Array>;

export interface SealDecryptorOptions {
  config: ProjectXSocialConfig;
  seal?: SealConfig;
  key: AgentKey;
  suiClient?: SuiGrpcClient;
  aggregators?: readonly string[];
  fetch?: typeof fetch;
  sessionTtlMin?: number;
  recoverKey?: RecoverKey;
  sleep?: (ms: number) => Promise<void>;
}

export function identityForApproval(approval: SealApproval): Uint8Array {
  return approval.kind === 'unlock'
    ?
      unlockIdentity(approval.vaultId, new TextEncoder().encode(approval.contentKey))
    : periodIdentity(approval.vaultId, approval.tier, approval.period);
}

export function approvalTransactionFor(
  config: ProjectXSocialConfig,
  approval: SealApproval,
): Transaction {
  const identity = identityForApproval(approval);
  return approval.kind === 'unlock'
    ? approveUnlock(config, { identity, unlockId: approval.unlockId })
    : approveSubscription(config, {
        identity,
        tier: approval.tier,
        period: approval.period,
        subscriptionId: approval.subscriptionId,
        vaultId: approval.vaultId,
        coinType: approval.coinType,
      });
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function openBlob(input: {
  ciphertext: Uint8Array;
  key: Uint8Array;
  nonce: Uint8Array;
}): Uint8Array {
  if (input.key.length !== KEY_BYTES) {
    throw new Error(`a blob key must be ${KEY_BYTES} bytes; this one is ${input.key.length}`);
  }
  if (input.nonce.length !== NONCE_BYTES) {
    throw new Error(`a blob nonce must be ${NONCE_BYTES} bytes; this one is ${input.nonce.length}`);
  }
  if (input.ciphertext.length <= TAG_BYTES) {
    throw new Error('this ciphertext is too short to carry an authentication tag');
  }

  const split = input.ciphertext.length - TAG_BYTES;
  const decipher = createDecipheriv('aes-256-gcm', input.key, input.nonce);
  decipher.setAuthTag(input.ciphertext.subarray(split));
  return new Uint8Array(
    Buffer.concat([decipher.update(input.ciphertext.subarray(0, split)), decipher.final()]),
  );
}

export function looksLikeSettling(error: unknown): boolean {
  if (error instanceof InvalidParameterError) return true;
  if (error instanceof NoAccessError) return true;
  const text = error instanceof Error ? error.message : String(error);
  return /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|timed? ?out|503|502/i.test(text);
}

function base64(value: string, field: string, expected?: number): Uint8Array {
  const bytes = new Uint8Array(Buffer.from(value, 'base64'));
  if (bytes.length === 0) throw new Error(`${field} decoded to nothing; it is not base64`);
  if (expected !== undefined && bytes.length !== expected) {
    throw new Error(`${field} must be ${expected} bytes; this one is ${bytes.length}`);
  }
  return bytes;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class SealDecryptor {
  readonly #options: SealDecryptorOptions;
  readonly #client: SuiGrpcClient;
  readonly #fetch: typeof fetch;
  readonly #aggregators: readonly string[];
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #ttlMin: number;

  #session: Promise<SessionKey> | null = null;
  #seal: SealClient | null = null;

  constructor(options: SealDecryptorOptions) {
    this.#options = options;
    this.#client = options.suiClient ?? createClient(options.config);
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#aggregators = options.aggregators ?? PUBLIC_WALRUS_AGGREGATORS;
    this.#sleep = options.sleep ?? realSleep;
    this.#ttlMin = options.sessionTtlMin ?? SESSION_TTL_MIN;

    if (this.#aggregators.length === 0) {
      throw new Error('a decryptor needs at least one Walrus aggregator to read ciphertext from');
    }
  }

  get address(): string {
    return this.#options.key.address;
  }

  async decrypt(ref: SealedRef): Promise<Uint8Array> {
    const identity = identityForApproval(ref.approval);
    const wrappedKey = base64(ref.sealWrappedKey, 'sealWrappedKey');
    const nonce = base64(ref.nonce, 'nonce', NONCE_BYTES);

    const sealedTo = EncryptedObject.parse(wrappedKey).id;
    const asked = sealId(identity);
    if (sealedTo !== asked) {
      throw new Error(
        `this content is sealed to identity ${sealedTo} and the approval offered covers ` +
          `${asked} — the entitlement named does not open this blob`,
      );
    }

    const ciphertext = await this.#fetchBlob(ref.blobId);

    const txBytes = await this.approvalBytesFor(ref.approval);
    const recover = this.#options.recoverKey ?? ((input) => this.recoverKeyFromCommittee(input));

    let key: Uint8Array | undefined;
    let last: unknown;
    for (let attempt = 0; attempt < SETTLING_ATTEMPTS; attempt += 1) {
      try {
        key = await recover({ wrappedKey, txBytes });
        break;
      } catch (error) {
        last = error;
        if (!looksLikeSettling(error)) throw error;
        const backoff = SETTLING_BACKOFF_MS[attempt];
        if (backoff === undefined) break;
        await this.#sleep(backoff);
      }
    }
    if (key === undefined) throw last ?? new Error('the key could not be recovered');

    const bytes = openBlob({ ciphertext, key, nonce });

    const digest = sha256Hex(bytes);
    if (digest !== ref.sha256) {
      throw new SealHashMismatchError(ref.blobId, ref.sha256, digest);
    }

    return bytes;
  }

  async approvalBytesFor(approval: SealApproval): Promise<Uint8Array> {
    const tx = approvalTransactionFor(this.#options.config, approval);
    tx.setSender(this.address);
    return approvalBytes(tx, this.#client);
  }

  async sessionKey(): Promise<SessionKey> {
    const existing = this.#session;
    if (existing !== null) {
      const session = await existing;
      if (!session.isExpired()) return session;
      this.#session = null;
    }

    this.#session ??= (async () => {
      const session = await SessionKey.create({
        address: this.address,
        packageId: sealPackageId(this.#options.config),
        ttlMin: this.#ttlMin,
        signer: this.#options.key.keypair,
        suiClient: this.#client,
      });
      await session.getCertificate();
      return session;
    })().catch((error: unknown) => {
      this.#session = null;
      throw error;
    });

    return this.#session;
  }

  async recoverKeyFromCommittee(input: {
    wrappedKey: Uint8Array;
    txBytes: Uint8Array;
  }): Promise<Uint8Array> {
    const seal = this.#options.seal;
    if (seal === undefined) {
      throw new Error(
        'this decryptor was built with no key server committee and no recoverKey seam, so it ' +
          'cannot open sealed content — set PROJECTX_SOCIAL_SEAL_KEY_SERVERS and pass loadSealConfig()',
      );
    }

    this.#seal ??= new SealClient({
      suiClient: this.#client,
      serverConfigs: seal.keyServers.map((server) => ({
        objectId: server.objectId,
        weight: server.weight,
        ...(server.aggregatorUrl === undefined ? {} : { aggregatorUrl: server.aggregatorUrl }),
        ...(server.apiKeyName === undefined || server.apiKey === undefined
          ? {}
          : { apiKeyName: server.apiKeyName, apiKey: server.apiKey }),
      })),
      verifyKeyServers: true,
    });

    const sessionKey = await this.sessionKey();
    const key = await this.#seal.decrypt({
      data: input.wrappedKey,
      sessionKey,
      txBytes: input.txBytes,
    });
    return new Uint8Array(key);
  }

  async #fetchBlob(blobId: string): Promise<Uint8Array> {
    const failures: string[] = [];
    for (const base of this.#aggregators) {
      const url = `${base.replace(/\/+$/, '')}/v1/blobs/${encodeURIComponent(blobId)}`;
      try {
        const response = await this.#fetch(url);
        if (!response.ok) {
          failures.push(`${base} answered ${response.status}`);
          continue;
        }
        return new Uint8Array(await response.arrayBuffer());
      } catch (error) {
        failures.push(`${base} ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error(
      `no aggregator served blob ${blobId} — its storage lease may have expired. ` +
        `Tried: ${failures.join('; ')}`,
    );
  }
}
