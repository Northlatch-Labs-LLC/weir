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
/*
  `/security` is here for a fourth reason: the waiting list links to it.

  The closed page carries one outbound link — "Read the contracts" — and it points here. Without
  this entry the proxy answered 307 back to `/waitlist`, so the only door out of the only reachable
  page returned the reader to the page they were standing on.

  It is safe to open because it assumes nothing about who is reading. `app/security/page.tsx`
  resolves the viewer with `fold(..., () => null)` and passes `signedIn`/`myHandle` down; both props
  are unused by the render, so a signed-out reader sees exactly what a signed-in one sees. Every
  figure on it is read from chain state that is public regardless of the gate, and it makes the
  ownership argument checkable — which is what the waiting list is asking to be believed.
*/
/*
  `/.well-known/` is here for a fifth reason, and it is the only entry whose reader is not a person.

  `/.well-known/weir-agent.json` is the agent manifest: the document from which a machine learns
  our package ids, the exact statement it must sign, and which endpoints exist. Without this entry
  the proxy answered 307 to `/waitlist` — **a discovery document that cannot be discovered**, and a
  redirect an HTTP client reads as "this endpoint returns HTML", not as "come back later".

  It is safe to open on the same reasoning as `/security`: nothing in the response assumes anything
  about who is reading. Every value in it is already public — ids that appear in every event on
  chain, statement shapes that any signed request reveals, endpoint paths already in the bundle —
  and knowing them grants nothing, because every write still needs a fresh single-use signature.

  The matcher above exempts static assets by extension, and `.json` is deliberately NOT in that
  list, so this route is reached by the proxy rather than skipped by it. This entry is the fix.
*/
export const ALWAYS_OPEN = [
  /*
    The two files an agent reads before it decides anything, and the one it runs.

    `llms.txt` is the discovery convention; `register-agent.mjs` is the registration path it names.
    Both must be readable without an account, because an agent with no account is precisely who
    they are for — gating them behind the thing they exist to obtain would be a closed loop.
  */
  '/llms.txt',
  '/register-agent.mjs',
  '/waitlist',
  '/signin',
  '/auth/callback',
  '/api/',
  '/legal',
  '/opengraph-image',
  '/security',
  /*
    `/agents` is open for the same reason `/security` is, and one more.

    The reader is an operator deciding whether to point a program at us. They have no
    account and are not asking for one — they are checking whether the ids, the fee and the
    endpoints are what our manifest claims. Redirecting that reader to a waiting list
    answers a question they did not ask, and the manifest at `/.well-known/` — which is
    already open — points at this page as its human-readable companion. Opening one and
    gating the other would publish a document whose own reference 307s.
  */
  '/agents',
  '/.well-known/',
  /*
    `robots.txt` and `sitemap.xml` are read by crawlers, and a crawler behind the gate reads a 307
    to `/waitlist` — which it records as "this site has no robots.txt", and then does whatever its
    defaults say. The two files exist to say otherwise, so they are open.
  */
  '/robots.txt',
  '/sitemap.xml',
  /*
    `/unsubscribe` is here for a sixth reason, and it is the only entry whose reader arrived from
    outside the web entirely.

    They are holding a link out of a message we sent, and the page they signed up on promised that
    one click on it takes them off the list. Behind the gate that link answers 307 to `/waitlist` —
    the very list they are trying to leave — so the promise would be broken by the door rather than
    by the code, and broken invisibly, because a redirect to a signup page looks like a working
    link.

    It is safe to open on the same reasoning as `/security`: the response assumes nothing about who
    is reading and discloses nothing. It renders the same document whether or not the address was on
    the list, and a request without a signature this deployment minted is refused before anything is
    read or written. `app/sitemap.ts` keeps the path out of the sitemap, and the route sets
    `x-robots-tag` on every answer, so opening it does not publish it.
  */
  '/unsubscribe',
  /*
    `/explore` — the creators directory — and `/explore/agents` beneath it are the two sides of
    the funnel on the waiting-list page: "see what is here before you commit". A funnel whose
    both doors 307 back to the page the visitor is standing on is a drawing of a funnel. Only the
    directories are opened; a creator's own page (`/c/…`) and the feed stay behind the gate, and a
    visitor who follows a card is returned here with `?from=` set so a code takes them onward.
  */
  '/explore',
];

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
