// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

/* The signed-in reader's home: their account in the rail, their alerts, their vault, the feed. */
export const FEED = '/feed';

/* Doors. A reader who has just come through one is never sent back to it. */
const DOORS: ReadonlySet<string> = new Set(['/signin', '/join', '/auth/callback']);

/*
  Does a path that arrived in a request name a page on this site?

  This is the one question every "send the reader back where they were going" feature has to
  answer, so it is answered once, here: the sign-in panel, the Google callback and the access-code
  panel all ask it.

  Until 2026-11-25 the answer was `startsWith('/') && !startsWith('//')`, in two places. That is
  not the question a browser asks. A browser edits the string before it resolves it — it deletes
  tab, line-feed and carriage-return wherever they appear, and it reads `\` as `/` — and only then
  looks for an authority. So `/\evil.example`, `/<tab>/evil.example` and `/%09/evil.example` all
  pass a check written on the raw string, and all resolve to `https://evil.example/`. A reader who
  signed in from a link that carried one of those was handed to another site with a session fresh
  from ours. Five spellings of it were confirmed against the same URL parser a browser uses.

  Two checks, in this order:

  1. The characters a browser deletes or reinterprets are refused outright. Refusing the raw
     characters is what makes the second check honest: there is then nothing left for a browser to
     rewrite before it resolves the path.
  2. What remains is resolved by that same parser against a fixed base, and has to come back on
     that base's origin. The base is not this deployment's — it cannot be, nothing here knows which
     deployment it is — and it does not need to be: a reference that stays on one origin when it is
     resolved stays on any other, and one that leaves, leaves from everywhere.

  A space in a query is not touched by either rule. It is neither deleted nor reinterpreted, and
  refusing it would turn `/explore?q=some words` into the feed.
*/
const SAME_SITE = 'https://same-site.invalid';

export function isPathOnThisSite(raw: string): boolean {
  if (!raw.startsWith('/') || raw.startsWith('//')) return false;
  if (/[\\\u0009\u000a\u000d]/.test(raw)) return false;
  try {
    return new URL(raw, SAME_SITE).origin === SAME_SITE;
  } catch {
    return false;
  }
}

/*
  Where a reader lands once signed in.

  `next` is honoured when it names a page on this site, because the reader was on their way
  somewhere — a post, a creator, a tip — and the sign-in was in the way. Everything else lands
  on the feed: nothing asked for, the front page itself, another origin, a protocol-relative
  trick, a door. The front page is addressed to a stranger; nobody who has just signed in
  should be put back outside it.
*/
export function afterSignIn(raw: string | null | undefined): string {
  if (raw === undefined || raw === null || raw === '') return FEED;
  if (!isPathOnThisSite(raw)) return FEED;
  if (raw === '/') return FEED;
  const path = raw.split(/[?#]/, 1)[0] ?? raw;
  if (DOORS.has(path.length > 1 ? path.replace(/\/+$/, '') : path)) return FEED;
  return raw;
}
