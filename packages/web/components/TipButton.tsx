'use client';
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude

/**
 * Send a creator a one-off amount.
 *
 * # The route existed and nothing called it
 *
 * `prepareTip` and `/api/checkout/tip` were written, tested and complete, and no control anywhere
 * sent one — while the creator setup told creators "tips and one-off unlocks already work". The
 * reachability test named this route and `checkout/unlock` on the day it was written.
 *
 * # Why a tip is not a tiny subscription
 *
 * It buys nothing and confers nothing. There is no entitlement, no object to keep, no expiry —
 * which is exactly why it can be offered to a creator with no tiers at all, and why it renders
 * whether or not this creator sells anything.
 *
 * # The amount is the reader's, the scale is the coin's
 *
 * Parsed by string surgery against the coin's own decimals, never `parseFloat`. A tip typed as
 * `1.5` against a six-decimal coin is 1,500,000 units; the same string read as a float and
 * multiplied is off by one unit often enough to matter, and it is somebody's money.
 */

import { useState } from 'react';
import { useSigner } from '@/components/SignerProvider';
import { SignIn } from '@/components/SignIn';

type Blocker =
  | { kind: 'no-account' }
  | { kind: 'self-payment' }
  | { kind: 'insufficient-balance'; have: string; need: string }
  | { kind: 'tier-inactive' };

interface Quote {
  bytes: string;
  gasMist: string;
  creatorReceives: string;
  platformReceives: string;
}

/**
 * A typed decimal to smallest units. `null` for anything that is not a clean amount.
 *
 * Rejects rather than rounds. Accepting more decimal places than the coin has would silently
 * truncate somebody's intent, and the difference belongs to them.
 */
function toMinor(input: string, decimals: number): bigint | null {
  const trimmed = input.trim();
  if (!new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`).test(trimmed)) return null;
  const [whole = '0', frac = ''] = trimmed.split('.');
  const value = BigInt(whole + frac.padEnd(decimals, '0'));
  return value > 0n ? value : null;
}

export function TipButton({
  vaultId,
  decimals,
  symbol,
}: {
  vaultId: string;
  /** From the coin's own metadata. Never assumed — a wrong scale misprices by orders of magnitude. */
  decimals: number;
  symbol: string;
}) {
  const { signer } = useSigner();
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [blocked, setBlocked] = useState<Blocker | null>(null);
  const [digest, setDigest] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const minor = toMinor(amount, decimals);

  async function simulate() {
    if (signer === null || minor === null) return;
    setBusy(true);
    setError(null);
    setBlocked(null);
    setQuote(null);
    try {
      const response = await fetch('/api/checkout/tip', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // No coin type — the route reads the vault's own denomination.
        body: JSON.stringify({ sender: signer.address, vaultId, amount: minor.toString() }),
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
      else {
        setDigest(body.digest);
        setAmount('');
        setQuote(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  if (signer === null) {
    return (
      <div className="panel">
        <p className="locked-why" style={{ marginTop: 0 }}>
          Send this creator any amount, once. It buys nothing and it is simply theirs.
        </p>
        <SignIn compact />
      </div>
    );
  }

  return (
    <div className="panel">
      {/*
        Label above, field below, both at the panel's left edge.

        `.comment-input` is `flex: 1; min-width: 0` — it is written for a flex row, which is how
        `Comments` and `DepositCheckout` both mount it. Here it had no flex parent and the label was
        an inline element, so the two laid out side by side on one line: the field collapsed to its
        intrinsic width and slid over the end of its own label, which read as a box overlapping the
        words "· USDC".

        Invisible until the control was on a page somebody looked at, which it had not been — the
        tip route existed and nothing rendered it.
      */}
      <label className="k" htmlFor="tip" style={{ display: 'block', marginBottom: 6 }}>
        SEND A TIP · {symbol}
      </label>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <input
          id="tip"
          className="comment-input"
          inputMode="decimal"
          placeholder={`0.00 ${symbol}`}
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
            // A quote belongs to the amount it was made for.
            setQuote(null);
            setBlocked(null);
          }}
        />
      </div>

      {digest !== null && (
        <div className="note" style={{ marginTop: 'var(--space-12)' }}>
          <span className="lbl">Sent</span>
          <p>
            <a href={`https://suiscan.xyz/mainnet/tx/${digest}`} target="_blank" rel="noreferrer">
              <span className="mono">{digest.slice(0, 14)}…</span>
            </a>
          </p>
        </div>
      )}

      {blocked !== null && (
        <p className="unmeasured" style={{ marginBottom: 0 }}>
          {blocked.kind === 'no-account' ? (
            <>
              Tipping needs an account. It is free apart from gas. <a href="/join">Claim a handle</a>.
            </>
          ) : blocked.kind === 'self-payment' ? (
            'This is your own vault.'
          ) : blocked.kind === 'insufficient-balance' ? (
            `Not enough ${symbol} for that.`
          ) : (
            'This vault is not accepting payments.'
          )}
        </p>
      )}

      {quote !== null ? (
        <div className="note" style={{ marginTop: 'var(--space-12)' }}>
          <span className="lbl">Checked against the chain. Nothing signed yet</span>
          <p>
            The creator receives <strong>{quote.creatorReceives}</strong> and the platform{' '}
            <strong>{quote.platformReceives}</strong>.
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-8)', marginTop: 'var(--space-12)' }}>
            <button className="btn" type="button" disabled={busy} onClick={() => void signAndSubmit()}>
              {busy ? 'Sending…' : 'Confirm and send'}
            </button>
            <button className="btn ghost" type="button" disabled={busy} onClick={() => setQuote(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 'var(--space-12)' }}>
          <button
            className="btn"
            type="button"
            // Withheld rather than allowed-and-refused: an amount the coin cannot express is not a
            // payment worth simulating.
            disabled={busy || minor === null}
            onClick={() => void simulate()}
          >
            {busy ? 'Checking…' : 'Send a tip'}
          </button>
          {amount.trim() !== '' && minor === null && (
            <p className="unmeasured" style={{ marginBottom: 0 }}>
              Enter an amount above zero with at most {decimals} decimal places.
            </p>
          )}
        </div>
      )}

      {error !== null && <p className="unmeasured">{error}</p>}
    </div>
  );
}
