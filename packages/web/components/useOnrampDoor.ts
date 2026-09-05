'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude

/**
 * Opening the card door — the one implementation, because there used to be two.
 *
 * The button inside the deposit panel and the `/add-funds` page each carried their own copy of
 * this, and each copy carried the same defect. One place now, so a fix reaches both.
 *
 * # The defect this exists to hold shut
 *
 * The tab was opened as `window.open('', '_blank', 'noopener')`. Passing `noopener` in the feature
 * string makes `window.open` **return null by specification** — the tab is still created, but the
 * caller is handed nothing, because severing the opener relationship is exactly what makes the
 * handle unavailable. The old code then read that null as "the browser blocked the popup" and fell
 * back to `window.location.href = widgetUrl`.
 *
 * So every single press did both halves of the wrong thing: a blank tab opened and stayed blank
 * forever, and the page the person was standing on navigated itself into the payment widget. That
 * is not a cosmetic bug — it takes somebody off the page they were trying to fund, which is where
 * they were about to come back to.
 *
 * The opener is still severed, just from the other side: `tab.opener = null` while the tab is
 * still `about:blank` and same-origin, before it is pointed anywhere. That disowns the browsing
 * context permanently, so the payment page cannot reach back through `window.opener` and navigate
 * ours — while leaving us the handle we need to fill it in.
 *
 * # A blocked popup is now told, not worked around
 *
 * With `noopener` gone, a null return means what it says: the browser refused to open a tab. That
 * is reported as `blocked`, carrying the URL, so the caller can offer a link the person clicks
 * themselves. It is never resolved by navigating the current page out from under them — the
 * behaviour that made the original bug indistinguishable from a redirect.
 */

import { useState } from 'react';

export type DoorState =
  | { name: 'idle' }
  | { name: 'opening' }
  /** The browser refused a tab. The session is real and single-use; the person opens it. */
  | { name: 'blocked'; widgetUrl: string }
  | { name: 'refused'; message: string };

export interface DoorRequest {
  walletAddress: string;
  asset: 'SUI' | 'USDC';
  fiatAmount?: number;
  fiatCurrency?: string;
}

export function useOnrampDoor(): {
  state: DoorState;
  open: (request: DoorRequest) => Promise<void>;
} {
  const [state, setState] = useState<DoorState>({ name: 'idle' });

  async function open(request: DoorRequest): Promise<void> {
    setState({ name: 'opening' });

    /*
      Opened before the await, and without `noopener`.

      Before: a browser blocks a popup that appears after an async gap, because by then it is no
      longer attributable to the click, so the tab has to be claimed synchronously and filled in
      when the session arrives.

      Without `noopener`: see the note at the top of this file. The feature string would hand back
      null and cost us the handle to the tab we just opened.
    */
    const tab = window.open('', '_blank');
    if (tab !== null) {
      // While it is still about:blank. Disowning it here is permanent, and it is the reason
      // dropping `noopener` costs nothing.
      try {
        tab.opener = null;
      } catch {
        // Some environments make `opener` read-only. Losing the disown is worth far less than
        // losing the tab, and the destination is our own provider session either way.
      }
    }

    try {
      const response = await fetch('/api/onramp/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          walletAddress: request.walletAddress,
          asset: request.asset,
          ...(request.fiatAmount === undefined ? {} : { fiatAmount: request.fiatAmount }),
          ...(request.fiatCurrency === undefined ? {} : { fiatCurrency: request.fiatCurrency }),
        }),
      });
      const body = (await response.json()) as { widgetUrl?: string; error?: string };

      if (body.widgetUrl === undefined) {
        tab?.close();
        setState({ name: 'refused', message: body.error ?? 'the card door did not open' });
        return;
      }
      if (tab === null) {
        setState({ name: 'blocked', widgetUrl: body.widgetUrl });
        return;
      }
      tab.location.href = body.widgetUrl;
      setState({ name: 'idle' });
    } catch (error) {
      tab?.close();
      setState({ name: 'refused', message: error instanceof Error ? error.message : String(error) });
    }
  }

  return { state, open };
}
