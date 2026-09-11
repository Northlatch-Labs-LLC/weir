'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useUnlock } from '@/components/app/use-unlock';
import { SignIn } from '@/components/SignIn';

export function UnlockButton({
  vaultId,
  contentKey,
  expectedPrice,
  priceLabel,
}: {
  vaultId: string;
  contentKey: string;
  expectedPrice: string;
  priceLabel: string;
}) {
  const { signer, quote, blocked, digest, busy, error, simulate, signAndSubmit, cancel } = useUnlock({
    vaultId,
    contentKey,
    expectedPrice,
  });

  if (digest !== null) {
    return (
      <div className="note">
        <span className="lbl">Unlocked</span>
        <p>
          This post is yours permanently.{' '}
          <a href={`https://suiscan.xyz/mainnet/tx/${digest}`} target="_blank" rel="noreferrer">
            <span className="mono">{digest.slice(0, 14)}…</span>
          </a>{' '}
          Reload to read it. The page checks what your wallet holds on every load.
        </p>
      </div>
    );
  }

  if (signer === null) {
    return (
      <div>
        <p className="locked-why" style={{ marginTop: 0 }}>
          Sign in to buy this post for {priceLabel}.
        </p>
        <SignIn compact />
      </div>
    );
  }

  if (blocked !== null) {
    return (
      <p className="unmeasured" style={{ margin: 0 }}>
        {blocked.kind === 'no-account' ? (
          <>
            Buying needs an account. It is free apart from gas. <a href="/join">Claim a handle</a>.
          </>
        ) : blocked.kind === 'self-payment' ? (
          'This is your own vault, so there is nothing to buy.'
        ) : blocked.kind === 'insufficient-balance' ? (
          <>
            Your wallet holds {blocked.have}, and this costs {blocked.need}.{' '}
            <a href="/add-funds">Add funds</a>, then try again.
          </>
        ) : blocked.kind === 'price-moved' ? (
          'The price changed after this page loaded. Reload to see the current price before buying.'
        ) : (
          'This post is not currently for sale.'
        )}
      </p>
    );
  }

  if (quote !== null) {
    return (
      <div className="note">
        <span className="lbl">Checked against the chain. Nothing signed yet</span>
        <p>
          {priceLabel} for this post, permanently. The creator receives{' '}
          <strong>{quote.creatorReceives}</strong> and the platform{' '}
          <strong>{quote.platformReceives}</strong>.
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-8)', marginTop: 'var(--space-12)' }}>
          <button className="btn" type="button" disabled={busy} onClick={() => void signAndSubmit()}>
            {busy ? 'Confirming…' : 'Confirm and pay'}
          </button>
          <button className="btn ghost" type="button" disabled={busy} onClick={cancel}>
            Cancel
          </button>
        </div>
        {error !== null && <p className="unmeasured">{error}</p>}
      </div>
    );
  }

  if (signer === null) {
    return (
      <div className="ramp">
        <p className="ramp__lead">
          {priceLabel} to open this post, and it stays yours.
        </p>
        <ol className="ramp__steps">
          <li>
            <span className="ramp__n">1</span>
            <span>
              <strong>Get a Sui wallet.</strong> A browser extension that holds your key. It takes a
              minute and costs nothing.{' '}
              <a href="https://sui.io/ecosystem" rel="noreferrer nofollow" target="_blank">
                See wallets
              </a>
            </span>
          </li>
          <li>
            <span className="ramp__n">2</span>
            <span>
              <strong>Claim a handle.</strong> Free apart from the gas the chain charges.{' '}
              <a href="/join">Create an account</a>
            </span>
          </li>
          <li>
            <span className="ramp__n">3</span>
            <span>
              <strong>Add {priceLabel}.</strong> Then this button opens the post, and what you paid
              for lands in your wallet as an object you keep.
            </span>
          </li>
        </ol>
        <p className="ramp__foot">
          Already have a wallet? Connect it from the account menu at the top of the page.
        </p>
      </div>
    );
  }

  return (
    <>
      <button className="btn" type="button" disabled={busy} onClick={() => void simulate()}>
        {busy ? 'Checking…' : 'Unlock'}
      </button>
      {error !== null && <p className="unmeasured">{error}</p>}
    </>
  );
}
