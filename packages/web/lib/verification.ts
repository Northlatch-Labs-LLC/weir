// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';

import { bcs } from '@mysten/sui/bcs';
import { SuinsClient } from '@mysten/suins';
import {
  classify,
  createClient,
  decodeObjectBytes,
  fail,
  ok,
  type Reading,
} from '@projectx-social/sdk';
import { siteConfig } from './chain';
import { listProfiles } from './content';

export const NAMES_ENV = [
  'PROJECTX_SOCIAL_NAMES_PACKAGE_ID',
  'PROJECTX_SOCIAL_NAMES_REGISTRAR_ID',
  'PROJECTX_SOCIAL_NAMES_STOREFRONT_URL',
] as const;

export interface NamesConfig {
  packageId: string;
  registrarId: string;
  storefrontUrl: string;
}

const RegistrarBcs = bcs.struct('Registrar', {
  id: bcs.Address,
  version: bcs.u64(),
  feeUsdMicros: bcs.u64(),
  paused: bcs.bool(),
  treasuryMist: bcs.u64(),
  sales: bcs.u64(),
  grossMist: bcs.u64(),
});

export interface RegistrarState {
  feeUsdMicros: bigint;
  paused: boolean;
  sales: bigint;
}

export async function readRegistrar(): Promise<Reading<RegistrarState>> {
  const site = siteConfig();
  if (!site.ok) return site;
  const names = namesConfig();
  if (!names.ok) return names;

  const source = 'name registrar state';
  try {
    const client = createClient(site.value);
    const response = await client.getObject({
      objectId: names.value.registrarId,
      include: { content: true },
    });
    const content = (response as { object?: { content?: unknown } }).object?.content;

    const bytes = decodeObjectBytes(content, source);
    if (!bytes.ok) return bytes;
    if (bytes.value === null) {
      return fail('malformed', source, 'the registrar object carried no content');
    }

    const decoded = RegistrarBcs.parse(bytes.value);
    return ok({
      feeUsdMicros: BigInt(decoded.feeUsdMicros),
      paused: decoded.paused,
      sales: BigInt(decoded.sales),
    });
  } catch (error) {
    const failure = classify(error, source);
    return fail(failure.kind, source, failure.detail);
  }
}

export function namesConfig(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): Reading<NamesConfig> {
  const source = 'name registrar';
  const missing = NAMES_ENV.filter((name) => (env[name] ?? '').trim() === '');
  if (missing.length > 0) return fail('unconfigured', source, `not set: ${missing.join(', ')}`);

  const packageId = (env['PROJECTX_SOCIAL_NAMES_PACKAGE_ID'] ?? '').trim();
  const registrarId = (env['PROJECTX_SOCIAL_NAMES_REGISTRAR_ID'] ?? '').trim();
  const storefrontUrl = (env['PROJECTX_SOCIAL_NAMES_STOREFRONT_URL'] ?? '').trim();

  if (!storefrontUrl.startsWith('https://')) {
    return fail('malformed', source, 'PROJECTX_SOCIAL_NAMES_STOREFRONT_URL must be https');
  }

  for (const [name, value] of [
    ['PROJECTX_SOCIAL_NAMES_PACKAGE_ID', packageId],
    ['PROJECTX_SOCIAL_NAMES_REGISTRAR_ID', registrarId],
  ] as const) {
    if (!/^0x[0-9a-fA-F]{1,64}$/.test(value)) {
      return fail('malformed', source, `${name} is not an object id`);
    }
  }

  return ok({ packageId, registrarId, storefrontUrl });
}
