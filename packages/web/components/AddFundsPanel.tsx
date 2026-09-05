'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude

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
import { useOnrampDoor } from '@/components/useOnrampDoor';

type Asset = 'SUI' | 'USDC';

const AMOUNTS = [25, 50, 100] as const;

export function AddFundsPanel() {
  const { signer } = useSigner();
  const [asset, setAsset] = useState<Asset>('SUI');
  const [amount, setAmount] = useState<number>(25);
  // How the tab is opened is shared with the button inside the deposit panel. It was written
  // twice, and both copies opened a blank tab while navigating this page into the widget.
  const { state, open } = useOnrampDoor();

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

      <button
        className="btn"
        type="button"
        disabled={state.name === 'opening'}
        onClick={() =>
          void open({ walletAddress: signer.address, asset, fiatAmount: amount, fiatCurrency: 'USD' })
        }
      >
        {state.name === 'opening' ? 'Opening…' : `Buy $${amount} of ${asset}`}
      </button>

      {state.name === 'blocked' && (
        <div className="note" style={{ marginTop: 'var(--space-12)' }}>
          <span className="lbl">Your browser blocked the tab</span>
          <p>
            The purchase is ready and nothing has been charged.{' '}
            {/* Opened by the person's own click, so this page stays where it is. */}
            <a href={state.widgetUrl} target="_blank" rel="noopener noreferrer">
              Open the payment page
            </a>{' '}
            — the link is single use and good for five minutes.
          </p>
        </div>
      )}

      {state.name === 'refused' && (
        <div className="note crit" style={{ marginTop: 'var(--space-12)' }} role="alert">
          <span className="lbl">Not opened</span>
          <p>{state.message}</p>
        </div>
      )}
    </div>
  );
}
