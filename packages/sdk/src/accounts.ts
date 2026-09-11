// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { decodeObjectBytes } from './objectbytes.js';
import { bcs } from '@mysten/sui/bcs';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { deriveDynamicFieldID } from '@mysten/sui/utils';
import { classify, fail, ok, type Reading } from './reading.js';
import type { ProjectXSocialConfig } from './config.js';

const RegistryBcs = bcs.struct('Registry', {
  id: bcs.Address,
  byHandle: bcs.struct('Table', { id: bcs.Address, size: bcs.u64() }),
  byAddress: bcs.struct('Table', { id: bcs.Address, size: bcs.u64() }),
});

const HandleFieldBcs = bcs.struct('Field', {
  id: bcs.Address,
  name: bcs.string(),
  value: bcs.Address,
});

const AddressFieldBcs = bcs.struct('Field', {
  id: bcs.Address,
  name: bcs.Address,
  value: bcs.string(),
});

export const REGISTRY_BCS_FIELDS = ['id', 'by_handle', 'by_address'] as const;

export const MIN_HANDLE_LEN = 3;
export const MAX_HANDLE_LEN = 30;

export const HANDLE_CHARSET_PATTERN = /^[a-z0-9_]$/;

export type HandleProblem =
  | { kind: 'too-short'; min: number }
  | { kind: 'too-long'; max: number }
  | { kind: 'bad-character'; character: string };

export function handleProblem(handle: string): HandleProblem | null {
  const bytes = new TextEncoder().encode(handle);
  if (bytes.length < MIN_HANDLE_LEN) return { kind: 'too-short', min: MIN_HANDLE_LEN };
  if (bytes.length > MAX_HANDLE_LEN) return { kind: 'too-long', max: MAX_HANDLE_LEN };

  for (const character of handle) {
    const ok =
      HANDLE_CHARSET_PATTERN.test(character) && new TextEncoder().encode(character).length === 1;
    if (!ok) return { kind: 'bad-character', character };
  }
  return null;
}

function toBytes(content: unknown): Uint8Array | null {
  const decoded = decodeObjectBytes(content, 'registry');
  return decoded.ok ? decoded.value : null;
}

export interface RegistryTables {
  byHandle: string;
  byAddress: string;
  accounts: bigint;
}

export async function readRegistryTables(
  client: SuiGrpcClient,
  config: ProjectXSocialConfig,
): Promise<Reading<RegistryTables>> {
  const source = `account::Registry ${config.registryId}`;
  try {
    const response = await client.getObject({
      objectId: config.registryId,
      include: { content: true },
    });
    const object = (response as { object?: { content?: unknown } }).object;
    if (object === undefined || object === null) {
      return fail('not-found', source, 'no object exists at that id on this network');
    }

    const bytes = toBytes(object.content);
    if (bytes === null) {
      return fail('malformed', source, 'the object carried no decodable content');
    }
    if (bytes.length < 32 + (32 + 8) * 2) {
      return fail(
        'malformed',
        source,
        `content is ${bytes.length} bytes, expected at least 112 — the id probably names ` +
          `something that is not a Registry`,
      );
    }

    const decoded = RegistryBcs.parse(bytes);
    if (BigInt(decoded.id) !== BigInt(config.registryId)) {
      return fail(
        'malformed',
        source,
        `decoded id ${decoded.id} does not match the requested id — not a Registry`,
      );
    }

    return ok({
      byHandle: decoded.byHandle.id,
      byAddress: decoded.byAddress.id,
      accounts: BigInt(decoded.byHandle.size),
    });
  } catch (error) {
    const failure = classify(error, source);
    return fail(failure.kind, source, failure.detail);
  }
}

export async function resolveHandle(
  client: SuiGrpcClient,
  byHandleTableId: string,
  handle: string,
): Promise<Reading<string | null>> {
  const source = `handle ${handle}`;
  try {
    const fieldId = deriveDynamicFieldID(
      byHandleTableId,
      '0x0000000000000000000000000000000000000000000000000000000000000001::string::String',
      bcs.string().serialize(handle).toBytes(),
    );

    const response = await client.getObject({ objectId: fieldId, include: { content: true } });
    const object = (response as { object?: { content?: unknown } }).object;
    if (object === undefined || object === null) return ok(null);

    const bytes = toBytes(object.content);
    if (bytes === null) return fail('malformed', source, 'the registry entry had no content');

    const decoded = HandleFieldBcs.parse(bytes);
    if (decoded.name !== handle) {
      return fail(
        'malformed',
        source,
        `the entry at the derived id is for "${decoded.name}", not "${handle}"`,
      );
    }
    return ok(decoded.value);
  } catch (error) {
    const failure = classify(error, source);
    if (failure.kind === 'not-found') return ok(null);
    return fail(failure.kind, source, failure.detail);
  }
}

export async function handleOf(
  client: SuiGrpcClient,
  byAddressTableId: string,
  address: string,
): Promise<Reading<string | null>> {
  const source = `account of ${address}`;
  try {
    const fieldId = deriveDynamicFieldID(
      byAddressTableId,
      'address',
      bcs.Address.serialize(address).toBytes(),
    );

    const response = await client.getObject({ objectId: fieldId, include: { content: true } });
    const object = (response as { object?: { content?: unknown } }).object;
    if (object === undefined || object === null) return ok(null);

    const bytes = toBytes(object.content);
    if (bytes === null) return fail('malformed', source, 'the registry entry had no content');

    const decoded = AddressFieldBcs.parse(bytes);
    if (BigInt(decoded.name) !== BigInt(address)) {
      return fail(
        'malformed',
        source,
        `the entry at the derived id belongs to ${decoded.name}, not ${address}`,
      );
    }
    return ok(decoded.value);
  } catch (error) {
    const failure = classify(error, source);
    if (failure.kind === 'not-found') return ok(null);
    return fail(failure.kind, source, failure.detail);
  }
}
