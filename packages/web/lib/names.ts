// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';

/**
 * The `.sui` name an address answers to.
 *
 * # Why this exists
 *
 * Every other Sui application shows `projectx.sui` where this one showed `0xda78…715d`. The name is
 * how somebody recognises their own address at a glance, and a 66-character hex string is how they
 * fail to.
 *
 * # The default name, not a name they happen to own
 *
 * An address may hold several `SuinsRegistration` NFTs. Listing them and picking one would be a
 * guess, and it is the guess the old verification badge made — it showed whichever name it found a
 * purchase event for, which is why it displayed a name that had nothing to do with the page it sat
 * on.
 *
 * SuiNS has an explicit answer: the default name, set by the holder. `defaultNameServiceName` asks
 * for exactly that, so what appears here is the name that person chose to be known by.
 *
 * # Three outcomes, and only one of them is a failure
 *
 * A name, no name, or could-not-ask. `NOT_FOUND` from the node means this address has set no
 * default name — an ordinary state for most addresses, and it must render as the plain address
 * rather than as an error. Only a transport problem is a failure, and even that falls back to the
 * address rather than showing nothing.
 */

import { createClient, fail, ok, type Reading } from '@projectx-social/sdk';
import { siteConfig } from '@/lib/chain';

export async function reverseName(address: string): Promise<Reading<string | null>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const source = `default .sui name for ${address}`;
  try {
    const client = createClient(config.value);
    const response = await client.defaultNameServiceName({ address });
    const name = (response as { data?: { name?: unknown } })?.data?.name;
    return ok(typeof name === 'string' && name !== '' ? name : null, Date.now());
  } catch (cause) {
    /*
      `NOT_FOUND` is the node saying this address has no default name. That is a measured absence,
      not a fault — most addresses are in that state — so it returns `null` rather than a failure
      that a caller would have to decide how to render.
    */
    const detail = cause instanceof Error ? cause.message : String(cause);
    if (/NOT_FOUND/i.test(detail)) return ok(null, Date.now());
    return fail('transport', source, `could not resolve a name: ${detail}`);
  }
}
