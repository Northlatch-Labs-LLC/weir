// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

/**
 * The front door's exemption list, and the questions that can be asked of it.
 *
 * # Why this is not in `proxy.ts` any more
 *
 * It has two readers now. `proxy.ts` uses it to decide a request, and `lib/agent-manifest.ts` uses
 * it to answer, in the signed document, "may a machine act here today". That second reader is the
 * reason this file exists: the manifest must not carry a sentence somebody typed about the door. It
 * has to carry the door's own list, so that removing `/api/` from the array below changes what the
 * published document says on the next request rather than leaving a stale promise signed and
 * served.
 *
 * Nothing is imported here, deliberately. `proxy.ts` pulls in `next/server`, the read session, the
 * site-admin check and the access-code pass; the manifest needs none of that to read an array of
 * strings, and importing the proxy to get at one constant would drag the whole gate into every
 * module that wants to describe it.
 */

/** Reachable with the door closed. See the comment above each entry for why it is there. */
/*
  `/legal` is here for a different reason from the rest.

  `/opengraph-image` is here for a third reason: it is not a page at all.

  It is the picture a link preview fetches, requested by a scraper acting for somebody who was
  *sent* a link and who will never sign in. Behind the gate it answered 307 to `/waitlist`, so every
  link to weir.social pasted into a chat client rendered with no preview whatsoever — which reads as
  a broken link rather than a closed one, and is a worse first impression than the closed page it is
  guarding.

  `proxy.ts`'s matcher already exempts every other asset by file extension. This one is a route only
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

  `proxy.ts`'s matcher exempts static assets by extension, and `.json` is deliberately NOT in that
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
  /*
    The API is deliberately open. It carries no marketing surface, every route on it already
    resolves its own authority, and closing it would break the very call that reopens the site.

    This one entry is also the whole of the answer the manifest gives a machine. Declaring,
    opening an account, naming a vault, publishing and buying are all calls under this prefix, so
    while it is here a declared agent's day does not touch the waiting list at any point. See
    `agentDoorClosures` below, which reads that off this array rather than asserting it.
  */
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

    The prefix also covers `/agents/declare`, where an operator signs their half, and
    `/agents/{handle}`, the record page a declaration produces. Both belong to the same reader.
  */
  '/agents',
  '/.well-known/',
  /*
    `/unsubscribe` is the one entry whose reader arrived from outside the web entirely: a link out
    of a message we sent, promised to take them off the list in one click. Behind the gate it would
    307 to the very list they are leaving. The response assumes nothing about who is reading, a
    request without a signature this deployment minted is refused, the sitemap keeps the path out
    and the route sets `x-robots-tag`, so opening it does not publish it.
  */
  '/unsubscribe',
  /*
    `robots.txt` and `sitemap.xml` are read by crawlers, and a crawler behind the gate reads a 307
    to `/waitlist` — which it records as "this site has no robots.txt", and then does whatever its
    defaults say. The two files exist to say otherwise, so they are open.
  */
  '/robots.txt',
  '/sitemap.xml',
  /*
    `/explore` — the creators directory — and `/explore/agents` beneath it are the two sides of
    the funnel on the waiting-list page: "see what is here before you commit". A funnel whose
    both doors 307 back to the page the visitor is standing on is a drawing of a funnel. Only the
    directories are opened; a creator's own page (`/c/…`) and the feed stay behind the gate, and a
    visitor who follows a card is returned here with `?from=` set so a code takes them onward.
  */
  '/explore',
];

/** The one rule, in one place, so the proxy and every description of it agree by construction. */
export function isAlwaysOpen(pathname: string): boolean {
  return ALWAYS_OPEN.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

/**
 * Every path a machine has to reach to go from nothing to a paid post.
 *
 * Each is a step in the order `llms.txt` gives them: read the guide, fetch the script, fetch the
 * signed manifest, call the API, and — for the human who answers for it — read `/agents` and press
 * the button at `/agents/declare`. A machine that can reach all six is not waiting on anything.
 *
 * Written as the paths themselves rather than as a boolean, because the useful answer when one of
 * them closes is *which one*.
 */
export const AGENT_DOOR_PATHS = [
  '/llms.txt',
  '/register-agent.mjs',
  '/.well-known/weir-agent.json',
  '/api/',
  '/agents',
  '/agents/declare',
] as const;

/**
 * Which of those the front door would turn away while the waiting list is up. Empty means open.
 *
 * This is the derivation the manifest publishes. It is a fold over {@link ALWAYS_OPEN} and nothing
 * else, so a change to that array is a change to the signed document on the next request — which is
 * the only way a claim about a gate can be kept true without somebody remembering to edit prose.
 */
export function agentDoorClosures(): string[] {
  return AGENT_DOOR_PATHS.filter((path) => !isAlwaysOpen(path));
}
