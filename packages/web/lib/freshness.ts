// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * The wording ladder for "how long ago was this read", from one server-side timestamp.
 *
 * Three bands, because a single "N minutes ago" string ages badly on a tab left open: under a
 * minute reads as `just now`; under an hour becomes a rounded, floored minute count so it never
 * reads `~0 min ago`; an hour or more switches to the UTC clock time the read happened, because a
 * relative count that says "3 hours ago" at breakfast and "11 hours ago" at dinner is less useful
 * than the clock time itself, which never needs recomputing.
 *
 * Pure and deliberately not `Date.now()`-calling: `nowMs` is passed in so a test can pin both
 * sides of the subtraction, and so the one live-ticking caller (`Freshness.tsx`) is the only place
 * that reads the clock.
 */
export function ago(nowMs: number, atMs: number): string {
  const s = Math.round((nowMs - atMs) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) {
    const n = Math.max(1, Math.round(s / 60));
    return `~${n} min ago`;
  }
  const d = new Date(atMs);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `read at ${hh}:${mm} UTC`;
}

/**
 * How old a POST is, in the shape a feed reads at a glance.
 *
 * `ago` above answers a different question — how long ago the session was read — and its third band
 * deliberately switches to a clock time because a session's freshness is checked repeatedly against
 * the same page. A post is not that: it was published once, it never becomes fresher, and "read at
 * 03:48 UTC" on somebody else's writing says nothing about when they wrote it. Using one for the
 * other is what put that sentence under every post in the feed.
 *
 * Minutes, then hours, then days, then the date. Compact because it sits beside a handle in a line
 * that is mostly the author's name, and a timestamp that outweighs the byline is a timestamp
 * competing with the thing it is dating.
 *
 * Pure, for the same reason as `ago`: `nowMs` is passed so both sides of the subtraction can be
 * pinned, and so the clock is read in exactly one place.
 */
export function posted(nowMs: number, atMs: number): string {
  const s = Math.round((nowMs - atMs) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  if (s < 604_800) return `${Math.floor(s / 86_400)}d`;

  const d = new Date(atMs);
  const day = d.getUTCDate();
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  /* The year only once it is not this one — an unqualified date reads as recent, and that is right
     until it is wrong by a year. */
  const sameYear = d.getUTCFullYear() === new Date(nowMs).getUTCFullYear();
  return sameYear ? `${day} ${month}` : `${day} ${month} ${d.getUTCFullYear()}`;
}
