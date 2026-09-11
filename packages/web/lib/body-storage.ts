// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import 'server-only';

import { createHash } from 'node:crypto';
import { fail, ok, type Reading } from '@projectx-social/sdk';
import { encryptBlob } from './blob-crypto';
import { grantUpload } from './publisher-token';
import { sealPeriodKey, sealUnlockKey } from './seal';
import { storeBlob } from './walrus';

const MAX_BODY_BYTES = 512 * 1024;

export type BodyGate =
  | { kind: 'unlock'; contentKey: string }
  | { kind: 'period'; tier: bigint; period: bigint };

export interface SealedBody {
  blobId: string;
  endEpoch: number;
  nonce: string;
  sealWrappedKey: string;
  sha256: string;
  bytes: number;
  tier?: string;
  period?: string;
}

export async function storeBody(input: {
  body: string;
  vaultId: string;
  gate: BodyGate;
  owner: string;
}): Promise<Reading<SealedBody>> {
  const source = 'body storage';

  const plaintext = new TextEncoder().encode(input.body);
  if (plaintext.length === 0) {
    return fail('malformed', source, 'a gated body cannot be empty');
  }
  if (plaintext.length > MAX_BODY_BYTES) {
    return fail('malformed', source, `body exceeds ${MAX_BODY_BYTES} bytes once encoded`);
  }

  const encrypted = encryptBlob(plaintext);

  const wrapped =
    input.gate.kind === 'unlock'
      ? await sealUnlockKey({
          vaultId: input.vaultId,
          contentKey: input.gate.contentKey,
          key: encrypted.key,
        })
      : await sealPeriodKey({
          vaultId: input.vaultId,
          tier: input.gate.tier,
          period: input.gate.period,
          key: encrypted.key,
        });
  if (!wrapped.ok) return wrapped;

  const grant = await grantUpload({
    owner: input.owner,
    size: encrypted.ciphertext.length,
    tier: 'durable',
  });
  if (!grant.ok) return grant;

  const stored = await storeBlob(encrypted.ciphertext, {
    epochs: grant.value.epochs,
    token: grant.value.token,
    sendObjectTo: input.owner,
  });
  if (!stored.ok) return stored;

  return ok({
    blobId: stored.value.blobId,
    endEpoch: stored.value.endEpoch,
    nonce: encrypted.nonce,
    sealWrappedKey: wrapped.value.wrappedKey,
    sha256: createHash('sha256').update(plaintext).digest('hex'),
    bytes: plaintext.length,
    ...(input.gate.kind === 'period'
      ? { tier: input.gate.tier.toString(), period: input.gate.period.toString() }
      : {}),
  });
}
