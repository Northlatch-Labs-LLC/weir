// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { fold, type PublishedKey, type Reading } from '@projectx-social/sdk';
import { readKeysOf, toBase64 } from '@/lib/keys';

export const dynamic = 'force-dynamic';

/**
 * A Sui address: hex, optionally `0x`-prefixed, up to 32 bytes.
 *
 * Checked before anything reaches the chain read. Someone typing a handle where an address belongs
 * is an ordinary mistake, and it has to come back as a sentence rather than as an exception from
 * three layers down.
 */
const SUI_ADDRESS = /^(0x)?[0-9a-fA-F]{1,64}$/;

/** Bounded because this endpoint is unauthenticated and each address costs a chain read. */
const MAX_ADDRESSES = 20;

/**
 * Look up published encryption keys.
 *
 * # This server no longer decides
 *
 * The answer comes from the shared `key_registry::KeyRegistry` on Sui. This route reads it and
 * relays it; it cannot add an entry, remove one, or substitute a key of its own. A client that
 * does not want to take even this on trust can do the same read itself — the registry id is in the
 * response, and the derivation from an address to a registry entry is deterministic.
 *
 * That property is the entire reason the registry moved on chain. In the database version, this
 * server could withhold a key and the sender would be told, honestly and wrongly, that the
 * recipient had never set up encryption.
 *
 * # Three outcomes, never merged
 *
 *  - `{ key: "…" }`      — published, and these are the bytes.
 *  - `{ key: null }`     — read the registry, there is no entry. Send plaintext, labelled.
 *  - `{ error: "…" }`    — could not read. Send nothing.
 *
 * They are reported **per address**, so one unreachable lookup cannot make the other participants
 * look like they have no keys.
 */
export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const raw = new URL(request.url).searchParams.get('addresses');
  if (raw === null || raw.trim() === '') {
    return NextResponse.json({ error: 'addresses is required' }, { status: 400 });
  }

  const addresses = raw.split(',').map((a) => a.trim()).filter((a) => a !== '');
  if (addresses.length > MAX_ADDRESSES) {
    return NextResponse.json(
      { error: `at most ${MAX_ADDRESSES} addresses per request` },
      { status: 400 },
    );
  }

  const notAnAddress = addresses.find((a) => !SUI_ADDRESS.test(a));
  if (notAnAddress !== undefined) {
    return NextResponse.json({ error: `${notAnAddress} is not a Sui address` }, { status: 400 });
  }

  const readings = await readKeysOf(addresses);

  const keys: Record<
    string,
    { key: string; version: string; updatedAtMs: string } | { key: null } | { error: string; kind: string }
  > = {};

  for (const [address, reading] of readings) {
    keys[address.toLowerCase()] = fold<
      PublishedKey | null,
      { key: string; version: string; updatedAtMs: string } | { key: null } | { error: string; kind: string }
    >(
      reading as Reading<PublishedKey | null>,
      (published) =>
        published === null
          ? { key: null }
          : {
              key: toBase64(published.x25519Public),
              version: published.version.toString(),
              updatedAtMs: published.updatedAtMs.toString(),
            },
      (failure) => ({ error: failure.detail, kind: failure.kind }),
    );
  }

  return NextResponse.json({ keys });
}
