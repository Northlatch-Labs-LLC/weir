'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude

/**
 * Tells the server who is asking, on every route.
 *
 * # The defect this fixes
 *
 * So on every one of those routes, connecting a wallet did nothing at all. No `?reader=` was
 * written, no signature was requested, no session was proved. The server saw a guest, and
 * `readEntitlements(null)` returns nothing — a reader looking at the feed with a connected wallet
 * had their own paid posts rendered locked, having genuinely bought them on chain.
 *
 * Nothing errored, and the wallet showed as connected throughout: the account menu reads the same
 * provider this does, so the *browser* knew who it was. Only the server did not.
 *
 * The cause is that a session handshake was a side effect of rendering a navigation bar. It is
 * mounted from the root layout now, so it cannot be lost again by a route choosing a different
 * frame.
 *
 * # What it no longer does
 *
 * Proving the address to the server used to be here too, in an effect ending in `catch {}`. It is
 * `SignerProvider`'s now, because the outcome is a state the account menu and the connect window
 * both have to read — and because a proof that only happens when some particular component is
 * mounted is this file's own bug wearing a different hat.
 *
 * # It grants nothing
 *
 * Naming an address proves nothing and unlocks nothing — entitlement is decided by objects that
 * address owns on chain. What this does is stop the server answering a question about the wrong
 * person, and then prove the claim so it can answer at all.
 */

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSigner } from '@/components/SignerProvider';

export function SessionBridge() {
  const pathname = usePathname();
  const router = useRouter();
  const { signer } = useSigner();

  /*
    Put the connected wallet into `?reader=`.

    Entitlement is read on the server from the objects `?reader=` owns, and the frame threads the
    parameter through its links — but nothing *originated* it from the wallet. Only `JoinFlow` and
    the account menu ever wrote one, so a reader who connected anywhere else stayed anonymous to the
    server. Reported exactly that way: a subscription bought with a second address, and the post
    still withheld from it. The subscription was real and the gate was right. Nobody had told the
    gate who was asking.

    Set, never cleared. `signer` is null for a moment while a wallet reconnects after a reload, and
    clearing on null would strip the parameter and re-add it on every load — a visible flash and a
    wasted round trip.
  */
  useEffect(() => {
    const address = signer?.address;
    if (address === undefined) return;

    /*
      The query string is read from `window` rather than through `useSearchParams`.

      That hook forces this component under a Suspense boundary, and a boundary here does not
      resolve: wrapped in one, the subtree stays in React's hidden staging div and the effects
      below never run — which would make this whole file dead code and hand back the very defect it
      exists to fix. Verified in a browser on the sibling component that hit the same wall.

      Reading `window` is safe precisely because this is an effect: effects run only on the client,
      after paint, so there is no server render to disagree with and no hydration mismatch to
      cause.
    */
    const params = new URLSearchParams(window.location.search);
    const reader = params.get('reader');
    if (reader !== null && reader.toLowerCase() === address.toLowerCase()) return;

    params.set('reader', address);
    // `replace`, not `push`: connecting a wallet is not a place in the reader's history, and a back
    // button that walks them out of their own identity is worse than no back button.
    router.replace(`${pathname}?${params.toString()}`);
  }, [signer?.address, pathname, router]);

  // Nothing to draw. This is behaviour that had been attached to a navigation bar by accident.
  return null;
}
