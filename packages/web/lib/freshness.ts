// Built-by: @projectx.sui · Co-authored-by: Claude
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
