// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import 'server-only';

/**
 * The encryption key registry, read from chain.
 *
 * # What changed, and why it was worth a package upgrade
 *
 * The registry is now a shared object on Sui. This module reads it. The database table is gone
 * rather than kept as a cache, because a cache of an authority is a second source of truth for the
 * same question, and the two drift — which is the failure the content store's own documentation
 * describes and the whole reason entitlement was never allowed into it.
 *
 * # The cost this moves onto the user, stated rather than hidden
 */

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

/**
 * The registry's table id, cached for the life of the process.
 *
 * Safe to cache because it is fixed at the moment the registry object is created and there is no
 * function anywhere that changes it. Cached because otherwise every key lookup would cost two
 * round trips instead of one.
 *
 * Keyed by registry id so a configuration change within one process cannot serve the old table.
 */
const tableIds = new Map<string, string>();

export function keyRegistryId(): Reading<string> {
  return loadKeyRegistryId(process.env);
}

/**
 * The key published by `address`, or `null` when it has published none.
 *
 * The `null` is inside the `ok` deliberately. "There is no key" and "we could not look" lead to
 * opposite behaviour in a sender — plaintext with a visible label, versus sending nothing — and a
 * caller folding this reading cannot mistake the second for the first.
 */
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

/**
 * Keys for several addresses at once.
 *
 * Bounded by the caller, and every failure is reported per address rather than collapsed. One
 * unreachable lookup must not make the other participants look like they have no keys — that is
 * the same downgrade this module exists to remove, arriving through a convenience API.
 */
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

/** Base64, for the wire. The chain stores raw bytes; base64 is this application's transport. */
export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/** Inverse of {@link toBase64}, with the length rule the contract enforces applied here too. */
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
    // Rejected here as well as on chain, so a user is told before they pay gas for an abort.
    return fail(
      'malformed',
      'x25519 public key',
      'the key is all zeros — every shared secret derived against it is also zero',
    );
  }
  return ok(bytes);
}
