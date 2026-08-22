// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { fold } from '@projectx-social/sdk';
import { rateLimit } from '@/lib/rate-limit';
import { verifyAction } from '@/lib/identity';
import {
  clearedReadSessionCookie,
  mintReadSession,
  provenReaderFor,
  readSessionCookie,
  revokeReadSessions,
} from '@/lib/read-session';

export const dynamic = 'force-dynamic';

/**
 * The one place a read session may be issued.
 *
 * # What this replaces
 *
 * `?reader=0x…` — an address in the URL, believed on sight. Entitlement was then resolved for
 * whoever was named, so anybody could enumerate buyers from public chain events, name one, and be
 * handed the post bodies, paid comments and decrypted media that buyer had paid for.
 *
 * The proof now happens once, here, and what leaves is a cookie rather than an assertion.
 *
 * # Ordering is the security argument
 *
 * `verifyAction` first, `mintReadSession` second, and nothing between them. `mintReadSession`
 * checks nothing — it cannot, having no signature — so the moment those two are separated, or the
 * second is called from anywhere else, the vulnerability is back one layer down.
 *
 * # Why the signature is spent
 *
 * `read-content` is single-use, unlike `read`. A captured mint statement would otherwise be
 * replayable for the whole ten-minute window, and replaying *this* one does not re-grant the signer
 * what they already had — it issues a second session, to whoever captured it, for an address they
 * do not control. That is the original attack, rebuilt out of the fix.
 */
export async function POST(request: Request) {
  const limited = rateLimit(request, 'write');
  if (limited !== null) return limited;

  const body = (await request.json()) as {
    address?: string;
    signature?: string;
    timestampMs?: number;
  };

  const { address, signature, timestampMs } = body;
  if (!address || !signature || timestampMs === undefined) {
    return NextResponse.json(
      { error: 'address, signature and timestampMs are required' },
      { status: 400 },
    );
  }

  const proven = await verifyAction({
    address,
    signature,
    timestampMs,
    action: { kind: 'read-content' },
  });
  if (!proven.ok) {
    return NextResponse.json({ error: proven.failure.detail }, { status: 401 });
  }

  const session = await mintReadSession(address);

  return NextResponse.json(
    { address, expiresAtMs: session.expiresAtMs },
    {
      headers: {
        'set-cookie': readSessionCookie({
          token: session.token,
          expiresAtMs: session.expiresAtMs,
          secure: isSecure(request),
        }),
        // Never cached. The body names an address and the header carries a bearer token; a shared
        // cache holding either would serve one reader's session to the next.
        'cache-control': 'no-store',
      },
    },
  );
}

/**
 * Who the caller is, as far as this server is concerned.
 *
 * The interface needs this to tell "connected, and we know it is you" from "connected, but you have
 * not proved it yet" — the difference between showing somebody their unlocked posts and asking them
 * to confirm. Without it, a reader whose session had quietly expired would see everything they had
 * paid for rendered as a paywall, with nothing on the page explaining why.
 */
export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const reading = await provenReaderFor(request);

  /*
    The failure is reported, not flattened to `null`.

    The client uses this to decide whether to ask for a signature. Told `null` when the truth is "we
    could not look", it would prompt for a wallet signature to replace a session that is probably
    fine — a prompt caused by our own outage, and exactly the kind people learn to approve without
    reading. `checked: false` lets it wait instead.
  */
  return fold(
    reading,
    (reader) =>
      NextResponse.json({ reader, checked: true }, { headers: { 'cache-control': 'no-store' } }),
    (failure) =>
      NextResponse.json(
        { reader: null, checked: false, error: failure.detail, kind: failure.kind },
        { status: 503, headers: { 'cache-control': 'no-store' } },
      ),
  );
}

/**
 * Sign out, and mean it.
 *
 * Every session the address holds is withdrawn, not merely the one presented — if the reason for
 * signing out is that a device was lost, revoking only the cookie in hand revokes the wrong one.
 *
 * Requires no signature: proving control of the cookie is enough to give it up, and demanding a
 * wallet prompt in order to *reduce* access is a prompt people learn to dismiss.
 */
export async function DELETE(request: Request) {
  const limited = rateLimit(request, 'write');
  if (limited !== null) return limited;

  const reader = fold(
    await provenReaderFor(request),
    (v) => v,
    // A session we could not read is one we cannot name an address for, so there is nothing to
    // revoke by address. The cookie is still cleared below, which is the part the caller asked for.
    () => null,
  );
  if (reader !== null) await revokeReadSessions(reader);

  return NextResponse.json(
    { reader: null },
    {
      headers: {
        'set-cookie': clearedReadSessionCookie(isSecure(request)),
        'cache-control': 'no-store',
      },
    },
  );
}

/**
 * Was this request served over https?
 *
 * `x-forwarded-proto` first, because behind the edge the origin request arrives as plain http, and
 * reading `request.url` alone would drop the `Secure` attribute in production — the one place it
 * matters. Falling back to the URL keeps a local http development server working, where a `Secure`
 * cookie is discarded by the browser and looks exactly like a failed sign-in.
 */
function isSecure(request: Request): boolean {
  const forwarded = request.headers.get('x-forwarded-proto');
  if (forwarded !== null) return forwarded.split(',')[0]?.trim() === 'https';
  return new URL(request.url).protocol === 'https:';
}
