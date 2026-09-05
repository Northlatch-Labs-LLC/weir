// Built-by: @projectx.sui · Co-authored-by: Claude
import 'server-only';

/**
 * The `.sui` registrar: its configuration and its live fee.
 *
 * This file was the verification system. A badge was awarded to any address that had bought a name
 * through our registrar, proved by walking `NameSold` events, and it was removed entirely.
 *
 * It was removed because it answered a question nobody was asking. The badge was keyed on the
 * *address*, not on the page — so an address owning two creator pages put a check on both, labelled
 * with a domain that had nothing to do with either handle. Worse, it made buying a domain the only
 * route to being trusted on the platform, which is a product decision that was never taken and one
 * the registrar was never meant to carry.
 *
 * A name is something this platform sells. It is not a claim about who somebody is.
 *
 * # What remains, and why
 */

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

/** Both required together. Unset means nobody is verified — a calm absence, not a failure. */
export const NAMES_ENV = [
  'PROJECTX_SOCIAL_NAMES_PACKAGE_ID',
  'PROJECTX_SOCIAL_NAMES_REGISTRAR_ID',
  'PROJECTX_SOCIAL_NAMES_STOREFRONT_URL',
] as const;

export interface NamesConfig {
  packageId: string;
  registrarId: string;
  /** Where a name is bought. Configuration, because a URL in source is a deployment in source. */
  storefrontUrl: string;
}

/**
 * `registrar_v1::Registrar`, positionally.
 *
 * ```move
 * public struct Registrar has key {
 *     id: UID, version: u64, fee_usd_micros: u64, paused: bool,
 *     treasury: Balance<SUI>, sales: u64, gross_mist: u64,
 * }
 * ```
 *
 * Quoted verbatim above the decoder because BCS is positional and unchecked by any compiler here:
 * inserting a field in the contract shifts everything after it, and the wrong field decodes to a
 * plausible number rather than to an error. `Balance<SUI>` is a single u64 on the wire.
 */
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

/**
 * What a name costs, read from the registrar rather than written here.
 *
 * The fee is set on chain with `set_fee_usd` and can change at any time. A price in the interface
 * that came from a constant would be wrong the first time it moved, and wrong silently — somebody
 * would be quoted one number and charged another.
 *
 * `paused` matters too: a storefront advertising names while the contract refuses sales sends
 * people to a dead end.
 */
export async function readRegistrar(): Promise<Reading<RegistrarState>> {
  const site = siteConfig();
  if (!site.ok) return site;
  const names = namesConfig();
  if (!names.ok) return names;

  const source = 'name registrar state';
  try {
    const client = createClient(site.value);
    // `include: { content: true }` is required — without it the object comes back with metadata
    // only and the decode fails on an empty body rather than on anything informative.
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

/**
 * The registrar to read, or a statement of why there is none.
 *
 * `unconfigured` rather than `malformed`, so a deployment that does not sell names shows no badges
 * and no errors. Verification is an addition; its absence must not look like a fault.
 */
export function namesConfig(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): Reading<NamesConfig> {
  const source = 'name registrar';
  const missing = NAMES_ENV.filter((name) => (env[name] ?? '').trim() === '');
  if (missing.length > 0) return fail('unconfigured', source, `not set: ${missing.join(', ')}`);

  const packageId = (env['PROJECTX_SOCIAL_NAMES_PACKAGE_ID'] ?? '').trim();
  const registrarId = (env['PROJECTX_SOCIAL_NAMES_REGISTRAR_ID'] ?? '').trim();
  const storefrontUrl = (env['PROJECTX_SOCIAL_NAMES_STOREFRONT_URL'] ?? '').trim();

  // https only. The storefront takes payment, and a link this deployment hands out over plain HTTP
  // is one an attacker on the path can redirect.
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
