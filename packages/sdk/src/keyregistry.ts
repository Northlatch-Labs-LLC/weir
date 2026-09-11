// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { decodeObjectBytes } from './objectbytes.js';
import { bcs } from '@mysten/sui/bcs';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { deriveDynamicFieldID } from '@mysten/sui/utils';
import { classify, fail, ok, type Reading } from './reading.js';

const PublishedKeyBcs = bcs.struct('PublishedKey', {
  x25519Public: bcs.vector(bcs.u8()),
  version: bcs.u64(),
  updatedAtMs: bcs.u64(),
});

const KeyRegistryBcs = bcs.struct('KeyRegistry', {
  id: bcs.Address,
  keys: bcs.struct('Table', { id: bcs.Address, size: bcs.u64() }),
});

const FieldBcs = bcs.struct('Field', {
  id: bcs.Address,
  name: bcs.Address,
  value: PublishedKeyBcs,
});

export const PUBLISHED_KEY_BCS_FIELDS = ['x25519_public', 'version', 'updated_at_ms'] as const;

export const KEY_REGISTRY_BCS_FIELDS = ['id', 'keys'] as const;

export interface PublishedKey {
  x25519Public: Uint8Array;
  version: bigint;
  updatedAtMs: bigint;
}

export const KEY_BYTES = 32;

function toBytes(content: unknown): Uint8Array | null {
  const decoded = decodeObjectBytes(content, 'key registry');
  return decoded.ok ? decoded.value : null;
}

export async function readKeyRegistryTableId(
  client: SuiGrpcClient,
  registryId: string,
): Promise<Reading<string>> {
  const source = `KeyRegistry ${registryId}`;
  try {
    const response = await client.getObject({ objectId: registryId, include: { content: true } });
    const object = (response as { object?: { content?: unknown } }).object;
    if (object === undefined || object === null) {
      return fail('not-found', source, 'no object exists at that id on this network');
    }

    const bytes = toBytes(object.content);
    if (bytes === null) {
      return fail(
        'malformed',
        source,
        'the object carried no decodable content — request it with include: { content: true }',
      );
    }
    if (bytes.length < 32 + 32 + 8) {
      return fail(
        'malformed',
        source,
        `content is ${bytes.length} bytes, expected at least 72 — the id probably names ` +
          `something that is not a KeyRegistry`,
      );
    }

    const decoded = KeyRegistryBcs.parse(bytes);
    if (BigInt(decoded.id) !== BigInt(registryId)) {
      return fail(
        'malformed',
        source,
        `decoded id ${decoded.id} does not match the requested id — not a KeyRegistry`,
      );
    }
    return ok(decoded.keys.id);
  } catch (error) {
    const failure = classify(error, source);
    return fail(failure.kind, source, failure.detail);
  }
}

export async function readPublishedKey(
  client: SuiGrpcClient,
  tableId: string,
  address: string,
): Promise<Reading<PublishedKey | null>> {
  const source = `key of ${address}`;

  let fieldId: string;
  try {
    fieldId = deriveDynamicFieldID(tableId, 'address', bcs.Address.serialize(address).toBytes());
  } catch (error) {
    return fail(
      'malformed',
      source,
      `could not derive the registry entry id: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  try {
    const response = await client.getObject({ objectId: fieldId, include: { content: true } });
    const object = (response as { object?: { content?: unknown } }).object;

    if (object === undefined || object === null) return ok(null);

    const bytes = toBytes(object.content);
    if (bytes === null) {
      return fail('malformed', source, 'the registry entry carried no decodable content');
    }

    const decoded = FieldBcs.parse(bytes);

    if (BigInt(decoded.name) !== BigInt(address)) {
      return fail(
        'malformed',
        source,
        `the entry at the derived id belongs to ${decoded.name}, not ${address}`,
      );
    }

    const key = Uint8Array.from(decoded.value.x25519Public);
    if (key.length !== KEY_BYTES) {
      return fail(
        'malformed',
        source,
        `the published key is ${key.length} bytes, expected ${KEY_BYTES} — the decoder and the ` +
          `contract disagree about the layout`,
      );
    }

    return ok({
      x25519Public: key,
      version: BigInt(decoded.value.version),
      updatedAtMs: BigInt(decoded.value.updatedAtMs),
    });
  } catch (error) {
    const failure = classify(error, source);
    if (failure.kind === 'not-found') return ok(null);
    return fail(failure.kind, source, failure.detail);
  }
}
