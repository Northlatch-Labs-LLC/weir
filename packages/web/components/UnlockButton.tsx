'use client';
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude

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

import { useState } from 'react';
import { useSigner } from '@/components/SignerProvider';
import { SignIn } from '@/components/SignIn';

/** Shared with subscribing — refusals a read can name before a transaction is built. */
type Blocker =
  | { kind: 'no-account' }
  | { kind: 'self-payment' }
  | { kind: 'insufficient-balance'; have: string; need: string }
  | { kind: 'tier-inactive' };

interface Quote {
  bytes: string;
  gasMist: string;
  contentKey: string;
  creatorReceives: string;
  platformReceives: string;
}

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
  const { signer } = useSigner();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [blocked, setBlocked] = useState<Blocker | null>(null);
  const [digest, setDigest] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function simulate() {
    if (signer === null) return;
    setBusy(true);
    setError(null);
    setBlocked(null);
    setQuote(null);
    try {
      const response = await fetch('/api/checkout/unlock', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // No coin type. The route reads the vault's own denomination — a caller naming one would be
        // choosing which generic instantiation of `unlock` executes.
        body: JSON.stringify({ sender: signer.address, vaultId, contentKey, expectedPrice }),
      });
      const body = (await response.json()) as { quote?: Quote; blocked?: Blocker; error?: string };
      if (body.blocked !== undefined) setBlocked(body.blocked);
      else if (body.quote === undefined) setError(body.error ?? 'this could not be simulated');
      else setQuote(body.quote);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function signAndSubmit() {
    if (signer === null || quote === null) return;
    setBusy(true);
    setError(null);
    try {
      const signature = await signer.signTransaction(quote.bytes);
      const response = await fetch('/api/checkout/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // The bytes that were simulated, unchanged.
        body: JSON.stringify({ bytes: quote.bytes, signature }),
      });
      const body = (await response.json()) as { digest?: string; error?: string };
      if (body.digest === undefined) setError(body.error ?? 'the payment was not accepted');
      else setDigest(body.digest);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  if (digest !== null) {
    return (
      <div className="note">
        <span className="lbl">Unlocked</span>
        <p>
          This post is yours permanently.{' '}
          <a href={`https://suiscan.xyz/mainnet/tx/${digest}`} target="_blank" rel="noreferrer">
            <span className="mono">{digest.slice(0, 14)}…</span>
          </a>{' '}
          Reload to read it — entitlement is decided on the server, from the objects you now own.
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
            Buying needs an account — free apart from gas. <a href="/join">Claim a handle</a>.
          </>
        ) : blocked.kind === 'self-payment' ? (
          'This is your own vault, so there is nothing to buy.'
        ) : blocked.kind === 'insufficient-balance' ? (
          `Not enough to cover ${priceLabel}.`
        ) : (
          'This post is not currently for sale.'
        )}
      </p>
    );
  }

  if (quote !== null) {
    return (
      <div className="note">
        <span className="lbl">Simulated — nothing signed yet</span>
        <p>
          {priceLabel} for this post, permanently. The creator receives{' '}
          <strong>{quote.creatorReceives}</strong> and the platform{' '}
          <strong>{quote.platformReceives}</strong>.
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-8)', marginTop: 'var(--space-12)' }}>
          <button className="btn" type="button" disabled={busy} onClick={() => void signAndSubmit()}>
            {busy ? 'Confirming…' : 'Confirm and pay'}
          </button>
          <button className="btn ghost" type="button" disabled={busy} onClick={() => setQuote(null)}>
            Cancel
          </button>
        </div>
        {error !== null && <p className="unmeasured">{error}</p>}
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
