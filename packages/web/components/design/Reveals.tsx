'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude

/**
 * # Why the application pages had no motion
 *
 * This is the missing half. It renders nothing, mounts once from `AppFrame`, and starts the same
 * observer the design routes use — so `data-reveal` becomes safe to use on a server-rendered page.
 *
 * # Why it is safe with no script
 *
 * The hidden state is scoped to `[data-js]`, which the inline script in the root layout sets before
 * first paint. A reader whose script failed never gets the attribute, so nothing is ever hidden
 * from them. That is the same guarantee the design routes rely on, unchanged.
 */

import { useEffect } from 'react';
import { useReveals } from '@/components/design/use-weir-line';

export function Reveals() {
  useReveals();

  /*
    The safety net, and the reason this component is not a one-liner.

    An IntersectionObserver does not deliver entries while the document is hidden. A tab restored
    from the background, opened in a background tab, or prerendered can therefore mount, observe,
    and show nothing — and stay that way until the reader scrolls, which they will not do on a page
    that looks empty.

    So after a beat, anything still unrevealed is revealed unconditionally. In the normal case the
    observer has already done its work and this finds nothing to do. In the failure case the reader
    gets the content, slightly late and without its entrance, which is the right way round: the
    animation is decoration and the words are the product.
  */
  useEffect(() => {
    const settle = window.setTimeout(() => {
      for (const node of document.querySelectorAll('[data-reveal]:not([data-revealed])')) {
        node.setAttribute('data-revealed', '');
      }
    }, 1200);
    return () => window.clearTimeout(settle);
  }, []);

  return null;
}
