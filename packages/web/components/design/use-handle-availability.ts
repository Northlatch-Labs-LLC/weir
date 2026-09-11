'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useEffect, useRef, useState } from 'react';
import { handleShapeProblem } from '@/lib/waitlist';

export type HandleAvailability =
  | 'idle'
  | 'checking'
  | 'available'
  | 'taken'
  | 'malformed'
  | 'unreadable';

export function useHandleAvailability(handle: string, delayMs = 400): HandleAvailability {
  const [state, setState] = useState<HandleAvailability>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const wanted = handle.trim().replace(/^@/, '').toLowerCase();

    if (wanted === '') {
      setState('idle');
      return;
    }
    if (handleShapeProblem(wanted) !== null) {
      setState('malformed');
      return;
    }

    setState('checking');

    let stale = false;
    if (timer.current !== null) clearTimeout(timer.current);

    timer.current = setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(`/api/account?handle=${encodeURIComponent(wanted)}`);
          if (stale) return;
          const body = (await response.json()) as { handle?: { state?: string } };
          if (stale) return;

          const status = body.handle?.state;
          if (status === 'available') setState('available');
          else if (status === 'taken') setState('taken');
          else if (status === 'invalid') setState('malformed');
          else setState('unreadable');
        } catch {
          if (!stale) setState('unreadable');
        }
      })();
    }, delayMs);

    return () => {
      stale = true;
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [handle, delayMs]);

  return state;
}
