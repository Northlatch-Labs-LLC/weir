// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { NextResponse, type NextRequest } from 'next/server';
import { fold } from '@projectx-social/sdk';
import { provenReaderFor } from '@/lib/read-session';
import { isSiteAdmin } from '@/lib/site-admin';
import { readSiteMode } from '@/lib/site-mode';
import { passIsValid, passTokenFrom } from '@/lib/access-codes';

/**
 * The front door.
 *
 * # Why `proxy.ts` and not `middleware.ts`
 *
 * `middleware.js` is **deprecated in Next.js 16** and renamed to `proxy.js`; the bundled docs say
 * so and a codemod exists. Same behaviour, different filename. Worth stating in the file itself,
 * because every tutorial and every model's memory still says `middleware`.
 *
 * Proxy defaults to the **Node.js runtime**, which is what makes this possible at all: the gate has
 * to read Postgres, and the old edge default could not.
 *
 * # What stays reachable when the door is closed
 *
 * The API is deliberately open. It carries no marketing surface, every route on it already resolves
 * its own authority, and closing it would break the very call that reopens the site.
 *
 * # A redeemed access code is the other way in
 *
 * # This is a front door, not a security boundary
 *
 * Nothing behind it is secret. Every page beyond still resolves entitlement from chain objects, and
 * a paid body is no more readable with the site open than closed. Treating this as authorisation
 * would be a mistake in the other direction: it would invite somebody to put something genuinely
 * private behind a switch that fails open on a database blip, by design.
 */

export const config = {
  /*
    Everything except Next's own plumbing and static files.
  */
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest|txt|xml)$).*)',
  ],
};

/** Reachable with the door closed. See the header for why each one is here. */
/*
  `/legal` is here for a different reason from the rest.

  `/opengraph-image` is here for a third reason: it is not a page at all.

  It is the picture a link preview fetches, requested by a scraper acting for somebody who was
  *sent* a link and who will never sign in. Behind the gate it answered 307 to `/waitlist`, so every
  link to weir.social pasted into a chat client rendered with no preview whatsoever — which reads as
  a broken link rather than a closed one, and is a worse first impression than the closed page it is
  guarding.

  The matcher above already exempts every other asset by file extension. This one is a route only
  because it is drawn per request instead of sitting in `public/`, and it discloses nothing the
  waiting list does not: the product name and the public tagline. Both `og:image` and
  `twitter:image` point at it.
*/
const ALWAYS_OPEN = ['/waitlist', '/signin', '/auth/callback', '/api/', '/legal', '/opengraph-image'];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (ALWAYS_OPEN.some((prefix) => pathname === prefix || pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  const mode = await readSiteMode();
  if (!mode.waitlistMode) return NextResponse.next();

  const viewer = fold(
    await provenReaderFor(request),
    (value) => value,
    () => null,
  );
  if (await isSiteAdmin(viewer)) return NextResponse.next();

  // A pass from a redeemed code. `passIsValid` fails closed on any error — see its header.
  if (await passIsValid(passTokenFrom(request.headers.get('cookie')))) return NextResponse.next();

  const to = request.nextUrl.clone();
  to.pathname = '/waitlist';
  /*
    Where they were headed, so signing in can return them there. Dropped unless it is a local path —
    an open redirect through a marketing gate is still an open redirect.
  */
  to.search =
    pathname.startsWith('/') && !pathname.startsWith('//')
      ? `?from=${encodeURIComponent(pathname)}`
      : '';

  /*
    307, not 308. The closure is temporary by definition — a permanent redirect would be cached by
    browsers and would outlive the switch being turned off, leaving readers stranded on the waiting
    list after the site reopened, with nothing on the server able to correct it.
  */
  return NextResponse.redirect(to, 307);
}
