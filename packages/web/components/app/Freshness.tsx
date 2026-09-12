'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useEffect, useState } from 'react';
import { ago } from '@/lib/freshness';

export function Freshness({ atMs }: { atMs: number }) {
  const [now, setNow] = useState(atMs);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [atMs]);

  return <time dateTime={new Date(atMs).toISOString()}>{ago(now, atMs)}</time>;
}
