// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse, type NextRequest } from 'next/server';
import { fold } from '@projectx-social/sdk';
import { provenReaderFor } from '@/lib/read-session';
import { isSiteAdmin } from '@/lib/site-admin';
import { readSiteMode } from '@/lib/site-mode';
import { passIsValid, passTokenFrom } from '@/lib/access-codes';
import { isAlwaysOpen } from '@/lib/front-door';

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

/*
  The exemption list itself lives in `lib/front-door.ts`, with the reasoning for every entry.

  It moved out of this file when it grew a second reader: `lib/agent-manifest.ts` publishes, in the
  signed document, whether a machine's own paths are behind this gate — and it answers that by
  folding over the same array rather than by carrying a sentence somebody typed. Re-exported here
  because this is still where a reader looks for it.
*/
export { ALWAYS_OPEN } from '@/lib/front-door';

/**
 * The path, carried to the layout that renders it.
 *
 * A layout renders above the page and Next hands it no pathname, so `components/shell/AppShell.tsx`
 * cannot tell whether the screen beneath it already carries its own frame. It has to know: a
 * rebuilt screen draws its own rail, header and footer, and wrapping it in the legacy shell as well
 * puts two navigations on one page — which is two different answers to "where am I", not a
 * cosmetic defect.
 *
 * This is the only place that knows, so it writes it down. The header is namespaced so it cannot
 * collide with a platform one, and it is set on the REQUEST rather than the response, which is what
 * makes it readable from a server component.
 *
 * Nothing else about it is load-bearing: no redirect, no auth, no cookie. When every route carries
 * its own frame, the shell and this header are deleted together.
 */
export const PATHNAME_HEADER = 'x-weir-pathname';

/** Let the request through, with the path attached. Replaces a bare `NextResponse.next()`. */
function letThrough(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  headers.set(PATHNAME_HEADER, request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isAlwaysOpen(pathname)) return letThrough(request);

  const mode = await readSiteMode();
  if (!mode.waitlistMode) return letThrough(request);

  const viewer = fold(
    await provenReaderFor(request),
    (value) => value,
    () => null,
  );
  if (await isSiteAdmin(viewer)) return letThrough(request);

  // A pass from a redeemed code. `passIsValid` fails closed on any error — see its header.
  if (await passIsValid(passTokenFrom(request.headers.get('cookie')))) return letThrough(request);

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
