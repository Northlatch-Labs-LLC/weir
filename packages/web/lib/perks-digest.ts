// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * The exact bytes a perk list is signed over.
 *
 * Shared, and deliberately not `server-only`: the browser computes this to build the statement the
 * wallet signs, and the route computes it again to check that the signature covers the list it was
 * handed. Two implementations of "canonical" is how a signature comes to authorise something other
 * than what was displayed, so there is one, here, with its output pinned by a test.
 *
 * The encoding is unambiguous rather than pretty: every field is length-prefixed, so no title
 * containing a newline or a colon can be arranged to look like a different list. `JSON.stringify`
 * would depend on key order and escaping decisions that are not ours to rely on.
 */
export interface DigestPerk {
  thresholdUnits: string;
  title: string;
  detail: string;
}

function field(value: string): string {
  // Byte length, not character count: a multi-byte character must not let two lists share a digest.
  return `${new TextEncoder().encode(value).length}:${value}`;
}

/** The canonical string. Exported for the test; callers want `perksDigest`. */
export function canonicalPerks(perks: readonly DigestPerk[], supportersFirst: boolean): string {
  const body = perks
    .map((p) => [field(p.thresholdUnits), field(p.title), field(p.detail)].join('|'))
    .join('\n');
  return `perks/v1\ncount:${perks.length}\nsupporters-first:${supportersFirst ? 'yes' : 'no'}\n${body}`;
}

/** SHA-256 of the canonical string, lower-case hex. Uses Web Crypto, present in both runtimes. */
export async function perksDigest(
  perks: readonly DigestPerk[],
  supportersFirst: boolean,
): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalPerks(perks, supportersFirst));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
