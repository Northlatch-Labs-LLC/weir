// Built-by: @projectx.sui · Co-authored-by: Claude
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
 * # What leaves is also a token, for callers that are not browsers
 *
 * The response carries `{address, expiresAtMs, token}` alongside the `Set-Cookie`. It is the same
 * token, the same row and the same day; `lib/read-session.ts` accepts it as `Authorization: Bearer`
 * and states what that does and does not change. `GET` and `DELETE` below take it too, through
 * `provenReaderFor`, so a machine can ask who it is proved to be and can sign itself out — an agent
 * that cannot revoke its own session is an agent whose only remedy for a leak is waiting a day.
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
    origin: new URL(request.url).origin,
    address,
    signature,
    timestampMs,
    action: { kind: 'read-content' },
  });
  if (!proven.ok) {
    return NextResponse.json({ error: proven.failure.detail }, { status: 401 });
  }

  const session = await mintReadSession(address);

  /*
    SUPERSEDED, and left standing because it is the record of why the body token exists at all.
    What follows it, below, is what the route does now.

    It read: "The token goes out twice: in `Set-Cookie`, and in the body." That was true until the
    body token became something a caller has to ask for. The paragraph is a description of the
    response SHAPE, which is what a reader opens this file to find, so it is the sentence most
    likely to be believed — and it is now the wrong half of a file that answers the question twice.

    Two of its claims survive unchanged and are the reason it is not deleted. The cookie is for
    browsers and is untouched, same attributes and same lifetime. And the body is for callers that
    are not browsers: a program holding a key has no cookie jar, so without it that program would
    parse `Set-Cookie` and replay the value — reimplementing a browser to obtain a credential we
    just minted for it. `lib/read-session.ts` accepts the same token as `Authorization: Bearer`.

    One claim is now wrong in the reader's favour. It said script running during the exchange "can
    now read the response", and that script has to be looking at a response that carries a token —
    which a browser's no longer does, because a browser does not ask. The window it called
    "genuinely widened" is closed for every caller that does not opt in.
  */
  /*
    The body token is now ASKED FOR rather than handed out.

    It exists for callers that are not browsers, and the reasoning above still holds for them: a
    program holding a key has no cookie jar and would otherwise parse `Set-Cookie` to obtain a
    credential we just minted for it. What was wrong is that everybody got it, including the one
    caller that has no use for it — `SessionBridge` fires this POST and never reads the response,
    because the cookie does the work.

    So the exposure had no beneficiary. Script running on this origin during the exchange could read
    a day-long bearer out of the response and use it from somewhere else; `HttpOnly` stops it
    reading the stored cookie and does nothing about a body. Now a caller that wants the token says
    so, and a browser never does.

    A header rather than a body field, so the signed statement is untouched and no client has to
    change what it signs. An agent that does not send it still works: `packages/agent/src/session.ts`
    falls back to the `Set-Cookie` value, which it already implements and which yields the same
    credential.
  */
  const wantsBearer = (request.headers.get('x-weir-bearer') ?? '').trim() === '1';

  return NextResponse.json(
    {
      address,
      expiresAtMs: session.expiresAtMs,
      ...(wantsBearer ? { token: session.token } : {}),
    },
    {
      headers: {
        'set-cookie': readSessionCookie({
          token: session.token,
          expiresAtMs: session.expiresAtMs,
          secure: isSecure(request),
        }),
        // Never cached, and now for two reasons rather than one: the header carries a bearer token,
        // the body names an address, and the body carries that same token. A shared cache holding
        // this response would serve one reader's session to the next.
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
