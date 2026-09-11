// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';

import { createClient } from '@projectx-social/sdk';
import { bcs } from '@mysten/sui/bcs';
import { siteConfig } from './chain';

const PublisherBcs = bcs.struct('Publisher', {
  id: bcs.fixedArray(32, bcs.u8()),
  package: bcs.string(),
  moduleName: bcs.string(),
});

function samePackage(a: string, b: string): boolean {
  const strip = (v: string) => v.replace(/^0x/i, '').toLowerCase().replace(/^0+/, '');
  return strip(a) === strip(b);
}

export async function isSiteAdmin(address: string | null): Promise<boolean> {
  if (address === null) return false;

  const config = siteConfig();
  if (!config.ok) return false;

  try {
    const client = createClient(config.value);
    const response = await client.listOwnedObjects({
      owner: address,
      type: '0x2::package::Publisher',
      limit: 25,
      include: { content: true },
    });

    const objects = (response as { objects?: Array<{ content?: unknown }> }).objects ?? [];

    for (const object of objects) {
      const raw = (object.content as { value?: unknown } | undefined)?.value ?? object.content;
      const bytes =
        raw instanceof Uint8Array
          ? raw
          : typeof raw === 'string'
            ? Uint8Array.from(Buffer.from(raw, 'base64'))
            : null;
      if (bytes === null) continue;

      let decoded: { package: string };
      try {
        decoded = PublisherBcs.parse(bytes);
      } catch {
        continue;
      }

      if (samePackage(decoded.package, config.value.packageId)) return true;
    }

    return false;
  } catch {
    return false;
  }
}
