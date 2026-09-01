// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import 'server-only';
import { opaqueDetail } from './opaque';
/**
 * The .sui names an address holds, and where each one points.
 *
 * # Why the decode is checked rather than trusted
 *
 * gRPC returns an object's fields as raw BCS, so reading a `SuinsRegistration` means declaring its
 * layout here — a copy of a struct whose source lives in SuiNS's repository, not ours. This
 * codebase's rule for a mirrored layout is that something must fail when the original moves, and
 * here nothing can: there is no local Move file to assert against.
 *
 * So the decode is not trusted. It produces one thing — a candidate name — and that name is then
 * put to the registry, which returns the record's own `nftId`. If the registry's id is not the
 * object we decoded it from, the decode is wrong or the object is not what its type claims, and the
 * entry is dropped and counted rather than shown. Everything a caller then sees — the expiry, the
 * target address — comes from the registry, not from these bytes.
 *
 * A wrong layout therefore renders an empty list and says how many entries it could not confirm.
 * It cannot render a name pointing somewhere it does not point.
 */
import { bcs } from '@mysten/sui/bcs';
import { SuinsClient } from '@mysten/suins';
import { createClient, fail, ok, type Reading } from '@projectx-social/sdk';
import { siteConfig } from './chain';

/**
 * `suins_registration::SuinsRegistration`, as published on mainnet.
 *
 * ```move
 * public struct SuinsRegistration has key, store {
 *     id: UID,
 *     domain: Domain,                  // { labels: vector<String> }
 *     domain_name: String,
 *     expiration_timestamp_ms: u64,
 *     image_url: String,
 * }
 * ```
 *
 * Only `domain_name` is used, and it is confirmed against the registry before anything is shown.
 */
const Domain = bcs.struct('Domain', { labels: bcs.vector(bcs.string()) });
const SuinsRegistration = bcs.struct('SuinsRegistration', {
  id: bcs.Address,
  domain: Domain,
  domain_name: bcs.string(),
  expiration_timestamp_ms: bcs.u64(),
  image_url: bcs.string(),
});

/** The mainnet type whose objects are names. Configuration, so a testnet deployment can differ. */
function registrationType(): string | null {
  const configured = (process.env['PROJECTX_SOCIAL_SUINS_REGISTRATION_TYPE'] ?? '').trim();
  return configured === '' ? null : configured;
}

/** Nobody holds hundreds of names, and a ceiling that a caller cannot raise is the point. */
const MAX_NAMES = 50;

export interface OwnedName {
  nftId: string;
  name: string;
  /** From the registry, not from the object's bytes. */
  expiresAtMs: number;
  /** Where the name resolves, or null when it resolves nowhere. */
  targetAddress: string | null;
}

export interface OwnedNames {
  names: OwnedName[];
  /**
   * Objects of the right type whose name the registry would not confirm. Surfaced rather than
   * swallowed: a non-zero count with an empty list is what a broken layout looks like, and the
   * page says so instead of telling somebody they own nothing.
   */
  unconfirmed: number;
  /** The ceiling stopped the walk; there may be more names than these. */
  truncated: boolean;
}

export async function readOwnedNames(owner: string): Promise<Reading<OwnedNames>> {
  const config = siteConfig();
  if (!config.ok) return config;
  const type = registrationType();
  if (type === null) {
    return fail(
      'unconfigured',
      `names owned by ${owner}`,
      'PROJECTX_SOCIAL_SUINS_REGISTRATION_TYPE is not set, so names cannot be listed',
    );
  }

  const source = `names owned by ${owner}`;
  try {
    const client = createClient(config.value);
    const suins = new SuinsClient({ client, network: 'mainnet' });

    const response = await client.listOwnedObjects({
      owner,
      type,
      limit: MAX_NAMES,
      include: { content: true },
    });
    const objects =
      (response as { objects?: Array<{ objectId?: unknown; content?: unknown }> }).objects ?? [];
    const truncated =
      objects.length >= MAX_NAMES ||
      (response as { hasNextPage?: boolean }).hasNextPage === true;

    const names: OwnedName[] = [];
    let unconfirmed = 0;

    for (const object of objects) {
      if (typeof object.objectId !== 'string') continue;
      const raw = (object.content as { value?: unknown } | undefined)?.value ?? object.content;
      const bytes =
        raw instanceof Uint8Array
          ? raw
          : typeof raw === 'string'
            ? Uint8Array.from(Buffer.from(raw, 'base64'))
            : null;
      if (bytes === null) {
        unconfirmed += 1;
        continue;
      }

      let candidate: string;
      try {
        candidate = SuinsRegistration.parse(bytes).domain_name;
      } catch {
        // A layout that no longer matches. Counted, never guessed at.
        unconfirmed += 1;
        continue;
      }

      /*
        The check that makes the decode safe. `getNameRecord` is the registry's own answer, and its
        `nftId` is the object that currently holds this name — so a match proves both that the name
        was decoded correctly and that this object is the live registration for it.
      */
      const record = await suins.getNameRecord(candidate).catch(() => null);
      if (record === null || record.nftId.toLowerCase() !== object.objectId.toLowerCase()) {
        unconfirmed += 1;
        continue;
      }

      names.push({
        nftId: object.objectId,
        name: candidate,
        expiresAtMs: record.expirationTimestampMs,
        /*
          SuiNS writes the zero address for "points nowhere". Rendering that as a destination would
          show somebody their name resolving to an address nobody controls.
        */
        targetAddress:
          record.targetAddress && !/^0x0+$/.test(record.targetAddress) ? record.targetAddress : null,
      });
    }

    names.sort((a, b) => a.name.localeCompare(b.name));
    return ok({ names, unconfirmed, truncated });
  } catch (error) {
    return fail('transport', source, opaqueDetail(source, error));
  }
}
