// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';

import {
  classify,
  createClient,
  fail,
  ok,
  loadKeyRegistryId,
  readKeyRegistryTableId,
  readPublishedKey,
  type PublishedKey,
  type Reading,
} from '@projectx-social/sdk';
import { siteConfig } from './chain';

const tableIds = new Map<string, string>();

export function keyRegistryId(): Reading<string> {
  return loadKeyRegistryId(process.env);
}

export async function readKeyOf(address: string): Promise<Reading<PublishedKey | null>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const registryId = keyRegistryId();
  if (!registryId.ok) return registryId;

  const client = createClient(config.value);

  let tableId = tableIds.get(registryId.value);
  if (tableId === undefined) {
    const read = await readKeyRegistryTableId(client, registryId.value);
    if (!read.ok) return read;
    tableId = read.value;
    tableIds.set(registryId.value, tableId);
  }

  return readPublishedKey(client, tableId, address);
}

export async function readKeysOf(
  addresses: readonly string[],
): Promise<Map<string, Reading<PublishedKey | null>>> {
  const out = new Map<string, Reading<PublishedKey | null>>();
  for (const address of addresses) {
    try {
      out.set(address, await readKeyOf(address));
    } catch (error) {
      const failure = classify(error, `key of ${address}`);
      out.set(address, fail(failure.kind, failure.source, failure.detail));
    }
  }
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

export function fromBase64(text: string): Reading<Uint8Array> {
  const bytes = Uint8Array.from(Buffer.from(text, 'base64'));
  if (bytes.length !== 32) {
    return fail(
      'malformed',
      'x25519 public key',
      `an X25519 public key is 32 bytes, this decodes to ${bytes.length}`,
    );
  }
  if (bytes.every((b) => b === 0)) {
    return fail(
      'malformed',
      'x25519 public key',
      'the key is all zeros — every shared secret derived against it is also zero',
    );
  }
  return ok(bytes);
}
