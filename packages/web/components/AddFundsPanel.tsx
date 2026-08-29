'use client';
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude

/**
 * Buying coins with a card, explained before it is offered.
 *
 * The button inside the deposit panel catches somebody at the moment they run out. This page is
 * the other half: the place a person goes *before* that, when they have decided to support someone
 * and have no crypto at all. It exists because a payment step that appears only as the answer to a
 * failure teaches nobody what is about to happen to their money.
 *
 * The destination address is the connected wallet's and cannot be edited in the widget — so the
 * page refuses to offer the purchase at all until a wallet is connected. Buying to an address
 * nobody has established is how a supporter's money goes somewhere they cannot reach.
 */

import { useState } from 'react';
import { useSigner } from '@/components/SignerProvider';

type Asset = 'SUI' | 'USDC';
type State = { name: 'idle' } | { name: 'opening' } | { name: 'refused'; message: string };

const AMOUNTS = [25, 50, 100] as const;

export function AddFundsPanel() {
  const { signer } = useSigner();
  const [asset, setAsset] = useState<Asset>('SUI');
  const [amount, setAmount] = useState<number>(25);
  const [state, setState] = useState<State>({ name: 'idle' });

  async function open() {
    if (signer === null) return;
    setState({ name: 'opening' });
    // Opened before the await: a browser blocks a popup that appears after an async gap, because
    // by then it is no longer attributable to the click.
    const tab = window.open('', '_blank', 'noopener');
    try {
      const response = await fetch('/api/onramp/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ walletAddress: signer.address, asset, fiatAmount: amount, fiatCurrency: 'USD' }),
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

  if (signer === null) {
    return (
      <div className="note">
        <span className="lbl">Connect a wallet first</span>
        <p>
          A card purchase is delivered straight to your own wallet, so there has to be one to
          deliver it to. Connect, then come back here — the address is filled in for you and cannot
          be edited, which is deliberate: a mistyped address is a permanent loss with nobody to
          appeal to.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <span className="k">WHAT TO BUY</span>
      <div style={{ display: 'flex', gap: 'var(--space-8)', flexWrap: 'wrap', marginTop: 8 }}>
        {(['SUI', 'USDC'] as const).map((a) => (
          <button
            key={a}
            type="button"
            className={a === asset ? 'btn' : 'btn ghost'}
            onClick={() => setAsset(a)}
          >
            {a}
          </button>
        ))}
      </div>
      <p className="section-note">
        SUI is what you pool behind a creator. USDC is the dollar-priced coin memberships are sold
        in. Both arrive on Sui — the network is fixed, because the same ticker exists on a dozen
        chains and the wrong one delivers where you are not standing.
      </p>

      <span className="k" style={{ marginTop: 'var(--space-12)' }}>HOW MUCH</span>
      <div style={{ display: 'flex', gap: 'var(--space-8)', flexWrap: 'wrap', marginTop: 8 }}>
        {AMOUNTS.map((a) => (
          <button
            key={a}
            type="button"
            className={a === amount ? 'btn' : 'btn ghost'}
            onClick={() => setAmount(a)}
          >
            ${a}
          </button>
        ))}
      </div>

      <p className="locked-why" style={{ marginTop: 'var(--space-12)' }}>
        Delivering to <span className="mono">{signer.address.slice(0, 10)}…{signer.address.slice(-6)}</span> — your
        own wallet. The payment happens on the provider&rsquo;s own page, not here: we never see your
        card, and this site never holds your money.
      </p>

      <button className="btn" type="button" disabled={state.name === 'opening'} onClick={() => void open()}>
        {state.name === 'opening' ? 'Opening…' : `Buy $${amount} of ${asset}`}
      </button>

      {state.name === 'refused' && (
        <div className="note crit" style={{ marginTop: 'var(--space-12)' }} role="alert">
          <span className="lbl">Not opened</span>
          <p>{state.message}</p>
        </div>
      )}
    </div>
  );
}
