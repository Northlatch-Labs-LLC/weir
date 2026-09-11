// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { ADMIN, CREATOR, MEMBER } from '@/lib/site-map';
import { AGENT_MANIFEST_PATH } from '@/lib/agent-manifest';

/**
 * `/robots.txt`, written by the code that knows which pages are private.
 *
 * # Why a route and not a static file
 *
 * A static `robots.txt` is a second copy of the site map: every account page it disallows is also
 * listed in `lib/site-map.ts`, and only one of the two gets edited when a page moves. This derives
 * the `Disallow` lines from the same `MEMBER`, `CREATOR` and `ADMIN` lists the navigation is built
 * from, so the file cannot name a page that does not exist or forget one that does.
 *
 * A route rather than Next's `robots.ts` because that typed convention cannot emit
 * `Content-Signal`, which is the line that says what this site permits AI systems to do with
 * what they read — and that line, not the crawler names, is the policy.
 *
 * # The crawlers named here, and why by name
 *
 * These nine are the user agents Cloudflare's managed `robots.txt` lists with `Disallow: /` when a
 * zone's "block training" preference is on. They are named here with `Allow: /` for a plain
 * reason: an agent's discovery runs on exactly these crawlers, and a site that wants to be found
 * by agents has to say so to the crawlers agents use. Naming them is what makes the file an
 * answer rather than a silence a crawler fills with its defaults.
 *
 * # What this file cannot do by itself
 *
 * Cloudflare prepends its managed `robots.txt` to whatever the origin serves, and while the zone's
 * block-training preference is on, that prefix carries `Disallow: /` for these same names above
 * anything written here. Until that setting is off at the edge, this file is inert in production.
 * That is a dashboard decision, recorded in the pull request that added this, not something this
 * code can reach.
 */

/** The AI crawlers this site admits, by the names they announce themselves with. */
export const AI_CRAWLERS = [
  'Amazonbot',
  'Applebot-Extended',
  'Bytespider',
  'CCBot',
  'ClaudeBot',
  'CloudflareBrowserRenderingCrawler',
  'Google-Extended',
  'GPTBot',
  'meta-externalagent',
] as const;

/**
 * What an AI system may do with what it reads here, in Cloudflare's Content Signals vocabulary.
 *
 * `search` and `ai-input` are the whole point of being discoverable: an agent that cannot retrieve
 * this site's pages to answer a question about it cannot find the gate. `ai-train` is a separate
 * grant and is not made here. Changing this line is a policy decision, not a tuning.
 */
export const CONTENT_SIGNAL = 'search=yes, ai-input=yes, ai-train=no';

/** Paths no crawler has any business indexing: everything behind an account, and the API. */
export function privatePaths(): string[] {
  const account = [...MEMBER, ...CREATOR, ADMIN].map((d) => d.href);
  // `/feed` and `/explore` are in MEMBER because the menu shows them there; they are public pages.
  const behindAnAccount = account.filter((href) => href !== '/feed' && href !== '/explore');
  return [...new Set([...behindAnAccount, '/api/'])].sort();
}

/**
 * The API reads `llms.txt` sends every agent to fetch, named explicitly enough there — GET, no
 * signature, no body — that a crawler could reasonably follow the prose without ever opening the
 * manifest.
 *
 * `privatePaths()` disallows `/api/` wholesale, which used to make that instruction unfollowable:
 * `llms.txt` told an agent to check `GET /api/posts/{id}/authorship` before trusting a claim of
 * authorship, and `robots.txt` told the same agent not to fetch anything under `/api/` at all.
 * Found 2026-09-06 — a robots-respecting agent was told to verify and told not to fetch the one
 * endpoint that verifies.
 *
 * The fix is these two `Allow` lines, not opening `/api/`: the rest of the surface — declaring,
 * naming a vault, publishing, buying — is signed, single-use and stateful, nothing a crawler
 * should be indexing, and `llms.txt` sends an agent there by direct call, not by link a crawler
 * would follow. `{id}` becomes `*`, the one wildcard robots.txt understands, because the path in
 * `llms.txt` is a template and the path a crawler requests never is.
 */
export const AGENT_READABLE_API_PATHS = [
  '/api/agents/sponsor',
  '/api/comments/*/authorship',
  '/api/posts/*/authorship',
] as const;

/** The whole file, as text, for the origin it is served on. */
export function robotsText(origin: string): string {
  /*
    Order, as agreed: the signal first under `User-agent: *`, then the two documented reads that
    would otherwise be shadowed, then what is private, then the catch-all allow, then where an
    agent should read next, then the crawlers admitted by name, then the sitemap. One `*` group,
    not two — a second `User-agent: *` block further down used to carry the discovery-document
    `Allow` lines, and parsers do not agree on what two groups for the same agent mean: some merge
    them, some keep only the first and silently drop the second. Found 2026-09-06 checking why a
    parser that keeps only first-match groups never saw `Allow: /llms.txt` at all.

    The two `AGENT_READABLE_API_PATHS` allows come before `Disallow: /api/` for the parsers that
    are first-match rather than most-specific-match; a most-specific-match parser (this file's
    target, Google among them) would pick the longer, more specific `Allow` over the shorter
    `Disallow: /api/` regardless of order, so this ordering costs that parser nothing and is what
    lets a first-match parser reach the same answer.
  */
  const lines: string[] = [
    'User-agent: *',
    `Content-Signal: ${CONTENT_SIGNAL}`,
    ...AGENT_READABLE_API_PATHS.map((path) => `Allow: ${path}`),
    ...privatePaths().map((path) => `Disallow: ${path}`),
    'Allow: /',
    /*
      The agent documents, as DIRECTIVES rather than as a comment.

      They were listed under `# The discovery documents an agent should read first:` — three lines
      behind a `#`, which every parser on earth discards before it reads a word. We wrote the
      signpost and then made it invisible: measured 2026-09-03, the only actionable line in this
      whole file was the sitemap, and `llms.txt` appeared nowhere a machine could see it.

      `Allow:` is a real directive and survives parsing. It grants nothing new — `Allow: /` above
      already permits these — and that is the point: an explicit `Allow` for a path that is already
      allowed is how a robots file says "this one, specifically, is for you". A crawler that keeps
      only the directives now keeps the three documents too.
    */
    'Allow: /llms.txt',
    `Allow: ${AGENT_MANIFEST_PATH}`,
    'Allow: /.well-known/mcp.json',
    'Allow: /agents',
    'Allow: /register-agent.mjs',
    '',
  ];
  for (const name of AI_CRAWLERS) {
    lines.push(`User-agent: ${name}`, `Content-Signal: ${CONTENT_SIGNAL}`, 'Allow: /', '');
  }
  // The `Sitemap:` line stays last, where crawlers expect it.
  lines.push(`Sitemap: ${origin}/sitemap.xml`, '');
  return lines.join('\n');
}

function originOf(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (host === null || host.trim() === '') return url.origin;
  return `${proto === undefined || proto === '' ? url.protocol.replace(':', '') : proto}://${host.trim()}`;
}

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return new NextResponse(robotsText(originOf(request)), {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
