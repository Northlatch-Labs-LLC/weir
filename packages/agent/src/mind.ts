// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { createHash } from 'node:crypto';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import {
  KEY_STATEMENT,
  decryptBytes,
  deriveSecret,
  encryptBytes,
  fail,
  fromB64,
  ok,
  publicFromSecret,
  readKeyRegistryTableId,
  readPublishedKey,
  toB64,
  tx as sdkTx,
  type EncryptedPayload,
  type Envelope,
  type ProjectXSocialConfig,
  type Reading,
} from '@projectx-social/sdk';
import type { Transaction } from '@mysten/sui/transactions';
import { PUBLIC_WALRUS_AGGREGATORS } from './seal-node.js';
import type { FetchLike } from './session.js';

export type MindSigner = (message: Uint8Array) => Promise<string>;

export interface MindKeyPair {
  secret: Uint8Array;
  x25519Public: string;
}

export const LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface Remembered {
  label: string;
  blobId: string;
  endEpoch: number;
  sha256: string;
  bytes: number;
  createdAtMs: number;
}

export interface Recalled extends Remembered {
  plaintext: Uint8Array;
}

export async function deriveMindKey(sign: MindSigner): Promise<Reading<MindKeyPair>> {
  const source = 'mind key';
  let signature: string;
  try {
    signature = await sign(new TextEncoder().encode(KEY_STATEMENT));
  } catch (error) {
    return fail('malformed', source, `the signer refused: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof signature !== 'string' || signature.trim() === '') {
    return fail('malformed', source, 'the signer returned no signature');
  }
  const secret = deriveSecret(signature.trim());
  return ok({ secret, x25519Public: toB64(publicFromSecret(secret)) });
}

export type RegistryState =
  | { kind: 'absent' }
  | { kind: 'same' }
  | { kind: 'different'; published: string; version: bigint };

export async function registryStateFor(input: {
  client: SuiGrpcClient;
  keyRegistryId: string;
  address: string;
  x25519Public: string;
}): Promise<Reading<RegistryState>> {
  const table = await readKeyRegistryTableId(input.client, input.keyRegistryId);
  if (!table.ok) return table;
  const published = await readPublishedKey(input.client, table.value, input.address);
  if (!published.ok) return published;
  if (published.value === null) return ok({ kind: 'absent' });
  const held = toB64(published.value.x25519Public);
  if (held === input.x25519Public) return ok({ kind: 'same' });
  return ok({ kind: 'different', published: held, version: published.value.version });
}

export function buildPublishKey(
  config: ProjectXSocialConfig,
  args: { keyRegistryId: string; x25519Public: string },
): Transaction {
  return sdkTx.publishEncryptionKey({ config }, { keyRegistryId: args.keyRegistryId, x25519Public: fromB64(args.x25519Public) });
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function sealMind(input: {
  address: string;
  x25519Public: string;
  plaintext: Uint8Array;
}): { payload: EncryptedPayload; sha256: string; bytes: number } {
  const payload = encryptBytes(input.plaintext, [{ address: input.address, x25519Public: input.x25519Public }]);
  const ciphertext = fromB64(payload.ciphertext);
  return { payload, sha256: sha256Hex(ciphertext), bytes: ciphertext.length };
}

export const AGGREGATOR_TIMEOUT_MS = 20_000;

export async function fetchBlob(input: {
  blobId: string;
  aggregators: readonly string[];
  doFetch: FetchLike;
}): Promise<Reading<Uint8Array>> {
  const source = `Walrus blob ${input.blobId}`;
  if (!/^[A-Za-z0-9_-]{40,50}$/.test(input.blobId)) return fail('malformed', source, 'that is not a Walrus blob id');
  let last = 'no aggregator was configured';
  let missing = 0;
  for (const base of input.aggregators) {
    try {
      const response = await input.doFetch(`${base.replace(/\/+$/, '')}/v1/blobs/${input.blobId}`, {
        method: 'GET',
        signal: AbortSignal.timeout(AGGREGATOR_TIMEOUT_MS),
      });
      if (response.status === 404) {
        missing += 1;
        last = `${base} does not hold it`;
        continue;
      }
      if (!response.ok) {
        last = `${base} answered ${response.status}`;
        continue;
      }
      return ok(new Uint8Array(await response.arrayBuffer()));
    } catch (error) {
      last = `${base}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  if (missing > 0 && missing === input.aggregators.length) {
    return fail('not-found', source, 'no aggregator holds this blob; its storage lease may have expired');
  }
  return fail('transport', source, last);
}

export function openMind(input: {
  address: string;
  secret: Uint8Array;
  ciphertext: Uint8Array;
  expectedSha256: string;
  nonce: string;
  envelope: Envelope;
}): Reading<Uint8Array> {
  const source = 'mind';
  const digest = sha256Hex(input.ciphertext);
  if (digest !== input.expectedSha256) {
    return fail('malformed', source, `the aggregator served bytes with sha256 ${digest}; the record says ${input.expectedSha256}. Refused.`);
  }
  const plaintext = decryptBytes(
    { ciphertext: toB64(input.ciphertext), nonce: input.nonce, envelopes: [input.envelope] },
    input.address,
    input.secret,
  );
  if (plaintext === null) {
    return fail(
      'malformed',
      source,
      'this key cannot open the mind: it was remembered under a different key (rotated since?), or the envelope is not this agent’s.',
    );
  }
  return ok(plaintext);
}

export { PUBLIC_WALRUS_AGGREGATORS };
