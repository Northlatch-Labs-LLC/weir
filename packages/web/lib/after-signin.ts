// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

/* The signed-in reader's home: their account in the rail, their alerts, their vault, the feed. */
export const FEED = '/feed';

/* Doors. A reader who has just come through one is never sent back to it. */
const DOORS: ReadonlySet<string> = new Set(['/signin', '/join', '/auth/callback']);

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
  if (!raw.startsWith('/') || raw.startsWith('//')) return FEED;
  if (raw === '/') return FEED;
  const path = raw.split(/[?#]/, 1)[0] ?? raw;
  if (DOORS.has(path.length > 1 ? path.replace(/\/+$/, '') : path)) return FEED;
  return raw;
}
