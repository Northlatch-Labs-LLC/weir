'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude

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
 *
 * How the tab is opened lives in `useOnrampDoor`, which the `/add-funds` page shares. It was
 * duplicated here once, and the duplicate carried the same bug.
 */

import { useOnrampDoor } from '@/components/useOnrampDoor';

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
  const { state, open } = useOnrampDoor();

  return (
    <>
      <button
        className="btn ghost"
        type="button"
        disabled={state.name === 'opening'}
        onClick={() => void open({ walletAddress, asset, fiatAmount })}
      >
        {state.name === 'opening' ? 'Opening…' : (label ?? `Add ${asset} with a card`)}
      </button>
      {state.name === 'blocked' && (
        <p className="k" style={{ marginTop: 8 }}>
          Your browser blocked the new tab.{' '}
          {/* The person's own click, so nothing is blocked and this page stays where it is. */}
          <a href={state.widgetUrl} target="_blank" rel="noopener noreferrer">
            Open the payment page
          </a>{' '}
          — the link is good for five minutes.
        </p>
      )}
      {state.name === 'refused' && (
        <p className="k" style={{ marginTop: 8, color: 'var(--crit, #dd8172)' }}>
          {state.message}
        </p>
      )}
    </>
  );
}
