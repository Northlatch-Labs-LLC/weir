// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import type { MetadataRoute } from 'next';
import { ALWAYS_OPEN } from '@/proxy';

/**
 * The pages a crawler can actually read, derived from the list that decides it.
 *
 * `proxy.ts` holds the one list of paths that answer without an account while the waiting list
 * is closed. A sitemap that named anything else would send a crawler to a 307, and a crawler
 * that is redirected off a listed page learns that the sitemap lies. So this lists the subset of
 * that list which are pages — not the API, not the manifest, not the redirect targets — and
 * nothing that is not in it.
 */

/** Entries in the open list that are documents rather than pages a person reads. */
const NOT_PAGES = new Set([
  '/api/',
  '/auth/callback',
  '/opengraph-image',
  '/.well-known/',
  '/llms.txt',
  '/register-agent.mjs',
  '/robots.txt',
  '/sitemap.xml',
  '/signin',
  '/waitlist',
  /*
    `/unsubscribe` is reachable behind the gate and must never be listed.

    It is not a destination: without a token minted for one address it does nothing, and with one it
    is that person's link and nobody else's. A sitemap entry would invite crawlers to fetch a URL
    whose whole purpose is to be fetched once, by one reader, holding one signature. The route sets
    `x-robots-tag: noindex` as well, for a crawler that finds it some other way.
  */
  '/unsubscribe',
]);

export function openPages(): string[] {
  // Deduplicated defensively, the same way `privatePaths()` in `robots.txt/route.ts` is: the
  // source list has one entry per reason a path is open, and two reasons can name the same path
  // (as `/disclosure` did until this pass). A `Set` makes that a non-event instead of a repeated
  // `<url>` a crawler has to notice is pointless on its own.
  return [...new Set(ALWAYS_OPEN.filter((path) => !NOT_PAGES.has(path)))].sort();
}

/**
 * The documents an agent reads, which are not pages a person reads.
 *
 * They were excluded on the reasoning that a sitemap lists pages. That reasoning is right for a
 * human crawler and wrong for the reader this site is trying to reach: measured 2026-09-03,
 * `llms.txt` was in no sitemap, linked from no page, and named only inside a robots.txt comment —
 * so the one file written for agent discovery was reachable only by guessing its name.
 *
 * A sitemap is a machine-readable index of what is worth fetching, and these are the most worth
 * fetching of anything here. Listed last and at a lower priority than the pages, because they are
 * documents rather than destinations.
 */
const AGENT_DOCUMENTS = ['/llms.txt', '/.well-known/weir-agent.json', '/.well-known/mcp.json'];

/**
 * The one page not drawn from {@link ALWAYS_OPEN}, and why it still belongs here.
 *
 * `ALWAYS_OPEN` is the front door's exemption list — the paths that stay reachable during an
 * *active* waiting-list closure. `/` isn't on it, but it doesn't need to be: `DEFAULT_SITE_MODE`
 * in `lib/site-mode.ts` has `waitlistMode: false`, so under the site's normal, non-gated operation
 * the root answers 200 for everyone — a guest sees the landing argument, a proven reader sees the
 * feed (see `app/page.tsx`) — and never a redirect. The same transient closure that would turn `/`
 * into a 307 also closes `/join`, `/feed` and every other page not named in `ALWAYS_OPEN`, none of
 * which this sitemap lists either; that's a property of the closure, not a reason to omit the
 * front page of the site from its own sitemap. Highest priority, because it is the one URL every
 * other listed page is reachable from.
 */
const HOME_PAGE = '/';

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = 'https://weir.social';
  return [
    { url: origin + HOME_PAGE, changeFrequency: 'weekly' as const, priority: 1.0 },
    ...openPages().map((path) => ({ url: `${origin}${path}`, changeFrequency: 'weekly' as const, priority: 0.8 })),
    ...AGENT_DOCUMENTS.map((path) => ({ url: `${origin}${path}`, changeFrequency: 'weekly' as const, priority: 0.5 })),
  ];
}
