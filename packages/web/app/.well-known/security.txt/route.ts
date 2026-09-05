// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { rateLimit } from '@/lib/rate-limit';

/**
 * `/.well-known/security.txt` — RFC 9116: the one place a security researcher looks without being
 * told a path, the same reason `/.well-known/weir-agent.json` sits here for a machine.
 *
 * # Why this file did not exist until now
 *
 * It simply was not written. `Contact:` and `Expires:` are the two fields RFC 9116 requires, and
 * both need an answer the deployment already has: the site publishes no dedicated `security@`
 * mailbox, but `abuse@weir.social` is live, routed, and already published in `/legal/terms` — so
 * this file reuses it rather than minting a new inbox nobody is watching yet. `/security` is the
 * human-readable page the manifest and `/agents` already point at; `Policy:` names it so a
 * researcher lands on the same page an operator does.
 *
 * # Why the fields are literal and not derived from the request
 *
 * Every other `/.well-known/` document in this tree builds its URLs from the origin it was asked
 * on, because a preview deployment or a mirror should describe itself, not production. This file
 * is different on purpose: RFC 9116 requires `Canonical:` — the URI of THIS exact file — to help a
 * client that found a copy through a cache or a proxy tell it apart from the original, which only
 * works if the value names the one real origin rather than echoing back whatever host the request
 * happened to arrive on. `weir.social` is that origin.
 *
 * # `Expires:`
 *
 * RFC 9116 requires it and recommends refreshing "no less than annually" so a stale, unmaintained
 * copy is distinguishable from an abandoned one. Bump the date below when this file is next
 * reviewed; a year out is the recommendation's own ceiling, not a promise this is reviewed only
 * once a year.
 */
export const dynamic = 'force-dynamic';

export const SECURITY_TXT = `Contact: mailto:abuse@weir.social
Expires: 2027-09-04T00:00:00Z
Policy: https://weir.social/security
Preferred-Languages: en
Canonical: https://weir.social/.well-known/security.txt
`;

export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  return new Response(SECURITY_TXT, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
