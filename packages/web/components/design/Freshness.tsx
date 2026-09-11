'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useEffect, useState } from 'react';
import { ago } from '@/lib/freshness';

/**
 * A live "how long ago" for a value read server-side.
 *
 * `app/page.tsx` (and everything under it) is `force-dynamic`: the string is right the instant it
 * is rendered and wrong in a tab held open for an hour. This corrects itself without a page reload.
 *
 * Seeded with `atMs` itself — not `Date.now()` — so the server-rendered markup and the first
 * client paint are character-for-character identical; there is no hydration mismatch to suppress.
 * The effect then corrects `now` within a frame and every 30s after, for as long as the tab stays
 * open.
 */
export function Freshness({ atMs }: { atMs: number }) {
  const [now, setNow] = useState(atMs);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [atMs]);

  return <time dateTime={new Date(atMs).toISOString()}>{ago(now, atMs)}</time>;
}
