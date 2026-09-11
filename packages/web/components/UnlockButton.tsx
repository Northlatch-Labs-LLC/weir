'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

/**
 * Buy one paid post.
 *
 * # The route existed and nothing called it
 *
 * `prepareUnlock` and `/api/checkout/unlock` were written, tested and complete. The feed rendered
 * the lock, the price and the words "one payment", and the only control was a link to the creator
 * page — which has no unlock control either. Two hops to nowhere, for the product's own paid-post
 * economics. The reachability test names this as the first gap it found.
 *
 * # What the buyer keeps
 *
 * An `Unlock` object at their own address. Not a row saying they may read: entitlement is checked
 * against objects the reader owns, so it survives this platform and cannot be revoked by it. That
 * is why the copy is allowed to say permanent.
 *
 * # Nothing is signed before a simulation passes
 *
 * `unlock` reads the price from the vault, so a client-supplied one buys nothing. The quote states
 * what the creator and the platform each receive before a signing button exists, and the bytes
 * submitted are the bytes that were simulated.
 */

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
  /**
   * The price this reader was shown, in smallest units.
   *
   * A guard, not an instruction: it lets the contract refuse a purchase at a price that changed
   * between the page rendering and the button being pressed. `unlock` reads the real price from the
   * vault and takes exactly that.
   */
  expectedPrice: string;
  /** The same figure already formatted, so this component assumes nothing about decimals. */
  priceLabel: string;
}) {
  /*
    The sequence lives in `use-unlock`, shared with the dialog the application frame opens. It was
    extracted rather than copied: two implementations of one payment is how they stop agreeing.
  */
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
    /*
      Each refusal names what to do about it. All are knowable from a read, so none of them needs a
      transaction to discover — an abort code is a poor way to learn you needed an account.
    */
    return (
      <p className="unmeasured" style={{ margin: 0 }}>
        {blocked.kind === 'no-account' ? (
          <>
            Buying needs an account. It is free apart from gas. <a href="/join">Claim a handle</a>.
          </>
        ) : blocked.kind === 'self-payment' ? (
          'This is your own vault, so there is nothing to buy.'
        ) : blocked.kind === 'insufficient-balance' ? (
          /*
            A dead end became a next step. It read "Not enough to cover 2 SUI." and stopped — true,
            and the one moment where a reader who has decided to pay is told only that they cannot.
          */
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

  /*
    Nothing to sign with.

    `simulate()` opens with `if (signer === null) return`, so before this existed the button was
    live, took the press, and did nothing at all — no message, no error, no next step. That is the
    single worst state in the product: a reader recruited by a page promising writing they can pay
    for, at the exact moment they try to pay, given silence.

    A reader who arrived to read is not a reader who already holds SUI. So this states the whole
    path, in the order it happens, and does not pretend the first two steps are not there.
  */
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
