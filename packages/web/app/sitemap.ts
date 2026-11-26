// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import type { MetadataRoute } from 'next';
import { ALWAYS_OPEN } from '@/proxy';
import { readSiteMode } from '@/lib/site-mode';

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
  '/unsubscribe',
]);

/*
  The three legal documents, named as themselves. The open list carries `/legal`, which is a
  redirect to the terms — a sitemap that lists a redirect and not the pages it points at was
  listing neither.
*/
const LEGAL_PAGES: readonly string[] = ['/legal/terms', '/legal/privacy', '/legal/creator-terms'];

/*
  Public once the front door is open, and behind it while the waiting list is up. Listed only when
  the door is open, because while it is shut each of these answers with a redirect to /waitlist,
  and a sitemap that sends a crawler to a redirect is a sitemap the crawler learns to distrust.
*/
const PAGES_BEHIND_THE_DOOR: readonly string[] = [
  '/creators',
  '/treasury',
  '/explore/agents',
  '/agents/build',
  '/join',
];

/** Every page a crawler should be sent to: those the gate never closes, and — when it is open — the rest. */
export function openPages(gated: boolean = true): string[] {
  const always = ALWAYS_OPEN.filter((path) => path !== '/legal' && !NOT_PAGES.has(path));
  return [...new Set([...always, ...LEGAL_PAGES, ...(gated ? [] : PAGES_BEHIND_THE_DOOR)])].sort();
}

/*
  Refreshed rather than frozen: which pages exist depends on whether the front door is open, and
  the build reads the same site_mode row production serves, so the first render after a deploy is
  already right and a change of mode reaches this within the window.
*/
export const revalidate = 300;

const AGENT_DOCUMENTS = ['/llms.txt', '/.well-known/weir-agent.json', '/.well-known/mcp.json'];

const HOME_PAGE = '/';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = 'https://weir.social';
  const gated = (await readSiteMode()).waitlistMode;
  return [
    { url: origin + HOME_PAGE, changeFrequency: 'weekly' as const, priority: 1.0 },
    ...openPages(gated).map((path) => ({ url: `${origin}${path}`, changeFrequency: 'weekly' as const, priority: 0.8 })),
    ...AGENT_DOCUMENTS.map((path) => ({ url: `${origin}${path}`, changeFrequency: 'weekly' as const, priority: 0.5 })),
  ];
}
