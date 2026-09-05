// Built-by: @projectx.sui · Co-authored-by: Claude
import 'server-only';

/**
 * Who administers the *website*, as opposed to the protocol.
 *
 * # These are two different questions and were being answered by one capability
 *
 * `lib/admin.ts` resolves `PlatformCap`, and that is protocol authority: fees, pauses, sweeping the
 * treasury, migrating. It is deliberately heavyweight, and on this deployment it has spent time in
 * a 2-of-3 multisig precisely because it should be hard to use.
 *
 * Closing the front door is not that. It changes no rate, moves no money and touches no contract —
 * it decides whether a web server hands somebody a marketing page or a signup form. Requiring the
 * protocol's governing capability to flip it would mean either a multisig ceremony to close a
 * landing page, or keeping that capability somewhere convenient *so that* the landing page stays
 * operable. The second is how a protocol's custody quietly degrades for a reason that has nothing
 * to do with the protocol.
 *
 * So site administration hangs off a different object: `Publisher`.
 *
 * # Why `Publisher`
 *
 * It is minted to whoever published the package and it is what Sui itself treats as "the party
 * behind this package" — it is the object that authorises `Display` and claims ownership of a type.
 * Saying "whoever published this package administers its website" is close to a tautology, which is
 * what you want from an authority rule.
 *
 * # It is read from chain, never from a list
 *
 * There is no admin table, no allowlist and no environment variable naming an address. Those are
 * all a second answer to a question the chain already settles, and the expensive direction of
 * disagreement is somebody holding a switch the contract never gave them.
 *
 * # A failed read is not permission
 */

import { createClient } from '@projectx-social/sdk';
import { bcs } from '@mysten/sui/bcs';
import { siteConfig } from './chain';

/**
 * `Publisher { id: UID, package: String, module_name: String }`, positionally.
 *
 * Quoted from `0x2::package` rather than remembered. Both string fields are `ascii::String`, which
 * BCS encodes as a length-prefixed byte vector — the same wire shape `bcs.string()` reads. A
 * positional decode that drifts from the struct reads the wrong field and announces it in no way at
 * all, which is why this is written out rather than indexed by guesswork.
 */
const PublisherBcs = bcs.struct('Publisher', {
  id: bcs.fixedArray(32, bcs.u8()),
  package: bcs.string(),
  moduleName: bcs.string(),
});

/** `0x…abc` and `abc` are the same package. The chain returns the field without the prefix. */
function samePackage(a: string, b: string): boolean {
  const strip = (v: string) => v.replace(/^0x/i, '').toLowerCase().replace(/^0+/, '');
  return strip(a) === strip(b);
}

/**
 * Does this address administer the website?
 *
 * `address` must be a **proved** session — an address that signed for itself — never the `?reader=`
 * query parameter, which is a claim anybody can type. The caller is responsible for that; this
 * function only answers whether the address holds the object.
 *
 * # Asked as "what do you own", not "who owns this id"
 *
 * The question is put to the *address*: list the `Publisher` objects it owns. That is the same
 * shape `lib/admin.ts` uses for `PlatformCap`, it needs no object id in configuration, and it stays
 * correct if the Publisher is ever transferred — the authority follows the object, which is the
 * whole point of deriving it from chain rather than recording it in a file.
 *
 * # Holding *a* Publisher is not holding *ours*
 *
 * `0x2::package::Publisher` is a framework type. Anybody who has ever published any package on Sui
 * owns one, and every one of them lists under this filter. So the `package` field is decoded and
 * compared against the package this deployment is configured for — exactly as `lib/admin.ts`
 * compares a cap's `platform` field, and for the same reason: without it, "administers this
 * website" would mean "has published something, once, anywhere".
 */
export async function isSiteAdmin(address: string | null): Promise<boolean> {
  if (address === null) return false;

  const config = siteConfig();
  if (!config.ok) return false;

  try {
    const client = createClient(config.value);
    const response = await client.listOwnedObjects({
      owner: address,
      // The framework type, not this package's. See above.
      type: '0x2::package::Publisher',
      // A handful, because an address may legitimately hold several from other packages.
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
    // Unreachable, malformed, or nothing there. None of those is a reason to grant a switch.
    return false;
  }
}
