// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { MANIFEST_HEADERS, servedManifest } from '@/lib/agent-manifest';
import { rateLimit } from '@/lib/rate-limit';

/**
 * The agent manifest, at a well-known path.
 *
 * # Why `/.well-known/` and not `/api/`
 *
 * Because a program that has never heard of us has to be able to find it. `/.well-known/` (RFC
 * 8615) is the one place on an origin where a stranger may look without being told a path, which is
 * the entire difference between a document an agent can discover and a document an agent's author
 * has to be sent a link to.
 *
 * `lib/agent-manifest.ts` holds the path as `AGENT_MANIFEST_PATH` and names itself in its own
 * endpoint list from that constant. This file's location is the other half of that claim, and it is
 * not left to memory: `test/agent-manifest.test.ts` resolves the constant to a path on disk and
 * fails if no route handler is sitting at it.
 *
 * # What it is
 *
 * See the header of `lib/agent-manifest.ts`. In one line: every public fact an agent needs to
 * transact — ids, denominations, the live fee, the endpoints, and the exact bytes to sign — with
 * nothing in it that grants anybody anything.
 *
 * # It is the root of trust, so it is signed
 *
 * Everything an agent does afterwards follows from this file: which package to call, which ids to
 * filter types with, and the exact bytes it must sign. **An intermediary who rewrites it redirects
 * every agent that trusts us**, and until this change there was nothing in the response a program
 * could check — no digest, no signature, no version. A discovery document with no integrity is a
 * discovery document you have asked strangers to trust on the strength of TLS to whatever host
 * their DNS returned.
 *
 * So three headers go out beside the body, and `lib/agent-manifest.ts` documents each:
 *
 *   * `content-digest` — RFC 9530, SHA-256 of the exact bytes below. Catches mangling.
 *   * `etag` — a strong validator, the same digest in hex.
 *   * `x-weir-manifest-jws` — a detached compact JWS over those same bytes, signed by an operator
 *     key whose Sui address is published inside the body and, out of band, in a DNS TXT record.
 *     Catches rewriting.
 *
 * The body is a **string built once** and served verbatim, never an object re-serialised here. A
 * signature is over bytes: serialise twice and any difference between the two — key order, number
 * formatting, a runtime change — produces a document whose own signature does not verify. That is
 * why this handler no longer calls `NextResponse.json`.
 *
 * # `access-control-expose-headers`, and why omitting it would waste all of the above
 *
 * `access-control-allow-origin: *` lets a browser-based agent FETCH this. It does not let it READ
 * the headers: cross-origin JavaScript sees only the CORS-safelisted set, which none of these three
 * is in. Without the expose header the signature and the digest would be sent to every browser
 * agent and readable by none of them — present, correct, and invisible to exactly the caller least
 * able to verify anything else.
 *
 * # Caching
 *
 * Sixty seconds when the document is whole, and `no-store` when it is not.
 *
 * The document carries one live measurement, the platform's economic terms, and `observedAtMs`
 * says when it was taken — so a minute of staleness is stated rather than hidden, and an agent that
 * needs the fee at settlement time reads it from chain regardless, as `feeNote` tells it to.
 *
 * The degraded case is not cached at all, and that is the half worth stating. A configuration
 * failure or an unreachable fullnode is a transient shape of this document; caching it at an edge
 * would keep serving `platform: null` to every agent for a minute after the node came back, and
 * the agent has no way to tell a cached outage from a current one.
 *
 * # Reachable while the door is closed?
 *
 * **Yes, now.** `proxy.ts` admits `/.well-known/` in `ALWAYS_OPEN`, alongside `/waitlist`,
 * `/signin`, `/auth/callback`, `/api/`, `/legal`, `/opengraph-image` and `/security`. It had to be
 * added explicitly: the matcher exempts static files by extension and `.json` is not among them, so
 * while `waitlistMode` was on an unauthenticated agent asking for this path was answered 307 to
 * `/waitlist` — a discovery document that could not be discovered. The admission is safe by that
 * file's own reasoning: nothing here assumes a reader, and everything in the response is public
 * whether the gate is open or shut.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const served = await servedManifest(originOf(request));
  const { manifest } = served;
  const whole = manifest.unavailable === null && manifest.money?.platform != null;

  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': whole ? 'public, max-age=60' : 'no-store',
    /*
      Readable from another origin on purpose. An agent running in a browser tab, or any tool
      built on `fetch` with an origin, must be able to read a document whose entire content is
      public — and refusing it there would push people to a proxy that then becomes the thing they
      trust instead of us. Nothing behind this header is credentialed: the manifest is identical
      for every caller and is built without reading the request's cookies.
    */
    'access-control-allow-origin': '*',
    // See the header of this file. Without this line the integrity headers are unreadable to the
    // one class of caller that cannot fall back to inspecting the transport.
    'access-control-expose-headers': [
      MANIFEST_HEADERS.digest,
      MANIFEST_HEADERS.etag,
      MANIFEST_HEADERS.jws,
      'x-weir-manifest',
      'x-weir-manifest-version',
    ].join(', '),
    [MANIFEST_HEADERS.digest]: served.contentDigest,
    [MANIFEST_HEADERS.etag]: served.etag,
    'x-weir-manifest': manifest.manifest,
    // The revision, echoed where a client can read it without parsing the body — which is what a
    // cache or a monitor checking for a rollback would rather do.
    'x-weir-manifest-version': String(manifest.version),
  };

  /*
    Omitted rather than sent empty when there is no key.

    An empty signature header is a header a naive verifier will try to parse, and the failure it
    produces reads as a bad signature rather than as an unsigned document. The body says so
    properly, in `integrity.signerUnavailable`, where it is a sentence rather than an absence.
  */
  if (served.jws !== null) headers[MANIFEST_HEADERS.jws] = served.jws;

  return new Response(served.body, { headers });
}

/**
 * The origin the caller actually reached, echoed back.
 *
 * `x-forwarded-*` first, because behind the edge the origin request arrives as plain http against
 * an internal host, and `request.url` alone would publish `http://10.x.x.x:3000` as this service's
 * origin in the one place a machine is most likely to believe it. Same reasoning as `isSecure` in
 * `app/api/session/route.ts`, and the same fallback for a development server.
 *
 * The headers are caller-influenced where nothing overwrites them, which is why this value decides
 * nothing: it is a convenience for building absolute URLs from the relative paths below, and every
 * agent already knows the origin it sent the request to. Nothing in this application reads it back.
 */
function originOf(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (host === null || host.trim() === '') return url.origin;
  return `${proto === undefined || proto === '' ? url.protocol.replace(':', '') : proto}://${host.trim()}`;
}
