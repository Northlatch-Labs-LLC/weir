// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';
import { opaqueDetail } from './opaque';
import { bcs } from '@mysten/sui/bcs';
import { SuinsClient } from '@mysten/suins';
import { createClient, fail, ok, type Reading } from '@projectx-social/sdk';
import { siteConfig } from './chain';

const Domain = bcs.struct('Domain', { labels: bcs.vector(bcs.string()) });
const SuinsRegistration = bcs.struct('SuinsRegistration', {
  id: bcs.Address,
  domain: Domain,
  domain_name: bcs.string(),
  expiration_timestamp_ms: bcs.u64(),
  image_url: bcs.string(),
});

function registrationType(): string | null {
  const configured = (process.env['PROJECTX_SOCIAL_SUINS_REGISTRATION_TYPE'] ?? '').trim();
  return configured === '' ? null : configured;
}

const MAX_NAMES = 50;

export interface OwnedName {
  nftId: string;
  name: string;
  expiresAtMs: number;
  targetAddress: string | null;
}

export interface OwnedNames {
  names: OwnedName[];
  unconfirmed: number;
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
        unconfirmed += 1;
        continue;
      }

      const record = await suins.getNameRecord(candidate).catch(() => null);
      if (record === null || record.nftId.toLowerCase() !== object.objectId.toLowerCase()) {
        unconfirmed += 1;
        continue;
      }

      names.push({
        nftId: object.objectId,
        name: candidate,
        expiresAtMs: record.expirationTimestampMs,
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
