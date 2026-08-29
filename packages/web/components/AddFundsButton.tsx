'use client';
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude

/**
 * The card door, offered where somebody runs out of money.
 *
 * A supporter who arrives with a debit card and no crypto reaches the deposit panel, finds they
 * hold nothing, and leaves. This is the step that used to end the story: it buys SUI or USDC
 * directly onto Sui and delivers it to the address already connected, which the widget will not
 * let anybody edit.
 *
 * The session is minted by our server on each press — single use, five-minute life — so this
 * cannot be a plain link, and a stale tab cannot hand somebody a dead door.
 */

import { useState } from 'react';

type State = { name: 'idle' } | { name: 'opening' } | { name: 'refused'; message: string };

export function AddFundsButton({
  walletAddress,
  asset = 'SUI',
  fiatAmount,
  label,
}: {
  walletAddress: string;
  asset?: 'SUI' | 'USDC';
  fiatAmount?: number;
  label?: string;
}) {
  const [state, setState] = useState<State>({ name: 'idle' });

  async function open() {
    setState({ name: 'opening' });
    // Opened before the await: a browser blocks a popup that appears after an async gap, because
    // by then it is no longer attributable to the click. The tab is filled in when the session
    // arrives, and closed if it does not.
    const tab = window.open('', '_blank', 'noopener');
    try {
      const response = await fetch('/api/onramp/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          walletAddress,
          asset,
          ...(fiatAmount === undefined ? {} : { fiatAmount }),
        }),
      });
      const body = (await response.json()) as { widgetUrl?: string; error?: string };
      if (body.widgetUrl === undefined) {
        tab?.close();
        setState({ name: 'refused', message: body.error ?? 'the card door did not open' });
        return;
      }
      if (tab === null) window.location.href = body.widgetUrl;
      else tab.location.href = body.widgetUrl;
      setState({ name: 'idle' });
    } catch (error) {
      tab?.close();
      setState({ name: 'refused', message: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <>
      <button className="btn ghost" type="button" disabled={state.name === 'opening'} onClick={() => void open()}>
        {state.name === 'opening' ? 'Opening…' : (label ?? `Add ${asset} with a card`)}
      </button>
      {state.name === 'refused' && (
        <p className="k" style={{ marginTop: 8, color: 'var(--crit, #dd8172)' }}>
          {state.message}
        </p>
      )}
    </>
  );
}
