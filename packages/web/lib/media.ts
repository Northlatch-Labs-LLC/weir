// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';
import { opaqueDetail } from './opaque';

import { createHash, randomBytes } from 'node:crypto';
import { fail, ok, type Reading } from '@projectx-social/sdk';
import { decryptBlob, encryptBlob } from './blob-crypto';
import { grantUpload, type StorageTier } from './publisher-token';
import { sealPeriodKey, sealUnlockKey } from './seal';
import { readBlob, storeBlob } from './walrus';

export interface Asset {
  id: string;
  postId: string;
  contentType: string;
  bytes: number;
  label: string;
  sha256: string;
  blobId: string;
  endEpoch: number;
  encryption: AssetEncryption | null;
}

export type AssetEncryption =
  | {
      scheme: 'platform';
      key: string;
      nonce: string;
    }
  | {
      scheme: 'seal';
      wrappedKey: string;
      tier?: string;
      period?: string;
      nonce: string;
    };

export type AssetGate =
  | { kind: 'unlock'; vaultId: string; contentKey: string }
  | { kind: 'period'; vaultId: string; tier: bigint; period: bigint };

const ALLOWED: ReadonlyArray<{ type: string; magic: readonly number[] }> = [
  { type: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47] },
  { type: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  { type: 'image/gif', magic: [0x47, 0x49, 0x46, 0x38] },
  { type: 'image/webp', magic: [0x52, 0x49, 0x46, 0x46] },
];

export const MAX_BYTES = 8 * 1024 * 1024;

const ASSET_ID = /^[0-9a-f]{32}$/;

export function detectType(bytes: Uint8Array): string | null {
  for (const { type, magic } of ALLOWED) {
    if (magic.every((byte, index) => bytes[index] === byte)) {
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

export async function storeAsset(input: {
  postId: string;
  label: string;
  bytes: Uint8Array;
  owner: string;
  tier: StorageTier;
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

  const encrypted = input.gated === null ? null : encryptBlob(input.bytes);
  const outgoing = encrypted === null ? input.bytes : encrypted.ciphertext;

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
    custody = {
      scheme: 'seal',
      wrappedKey: wrapped.value.wrappedKey,
      nonce: encrypted.nonce,
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
    label: input.label.replace(/[^\w.\- ]+/g, '').slice(0, 120),
    sha256: createHash('sha256').update(input.bytes).digest('hex'),
    blobId: stored.value.blobId,
    endEpoch: stored.value.endEpoch,
    encryption: custody,
  });
}

export type OpenedAsset =
  | {
      kind: 'plaintext';
      bytes: Uint8Array;
    }
  | {
      kind: 'sealed';
      ciphertext: Uint8Array;
      wrappedKey: string;
      nonce: string;
    };

export async function readAsset(
  record: Pick<Asset, 'blobId' | 'sha256' | 'encryption'>,
): Promise<Reading<OpenedAsset>> {
  const source = `media asset ${record.blobId}`;

  const blob = await readBlob(record.blobId);
  if (!blob.ok) return blob;

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
