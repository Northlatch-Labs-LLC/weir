'use client';
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude

import { useEffect, useRef, useState } from 'react';
import { handleShapeProblem } from '@/lib/waitlist';

/**
 * Is this handle free, as of right now?
 *
 * # `unreadable` is not `available`
 *
 * The states below are deliberately six rather than three. "We could not reach the registry" is a
 * different fact from "nobody holds this name", and collapsing them is the one mistake that costs a
 * real person money: told a handle is free, they pay gas to mint it and the transaction aborts. So a
 * failed look reports itself, and the interface says "unchecked" rather than "free".
 *
 * # Nothing here is a reservation
 *
 * Even `available` is only true at the instant it was read. A handle is claimed by the transaction
 * that mints it and stays first-come until somebody signs one, so every caller must present this as
 * a reading rather than a hold.
 */
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
      // Shape first, locally — a malformed handle must never become a chain read.
      setState('malformed');
      return;
    }

    setState('checking');

    /*
      `stale` guards ordering, not just cleanup.

      Responses can arrive out of order, and without this a slow answer for "ali" lands after a fast
      one for "alice" and reports the wrong name's availability — with the input showing the newer
      text. The debounce alone does not prevent that; only ignoring superseded replies does.
    */
    let stale = false;
    if (timer.current !== null) clearTimeout(timer.current);

    timer.current = setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(`/api/account?handle=${encodeURIComponent(wanted)}`);
          if (stale) return;
          const body = (await response.json()) as { handle?: { state?: string } };
          if (stale) return;

          // The endpoint keeps failures in their own shape, so anything without a recognised
          // `state` is "we could not look" rather than an answer.
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
