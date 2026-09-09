'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * Buying one paid post, as a state machine with no interface attached.
 *
 * # Why this was extracted rather than rewritten
 *
 * The sequence below — simulate against the vault's own price, quote what each party receives, sign
 * exactly the bytes that were simulated, submit, hold the digest — was already written, tested and
 * carrying real money in `UnlockButton`. The new design needs the same sequence inside a dialog
 * instead of inline on a card. Copying it would have produced two implementations of a payment,
 * which is how one of them quietly stops matching the other. So the logic moved here and both
 * surfaces call it: one path, two presentations.
 *
 * # The two guarantees this preserves exactly
 *
 * Nothing is signed that was not first simulated: `signAndSubmit` refuses without a quote, and the
 * bytes it signs are the bytes the quote returned, unchanged.
 *
 * The price is the vault's, not the caller's. `expectedPrice` is a guard that lets the contract
 * refuse a purchase at a price that moved between this page rendering and the button being
 * pressed — it is never what gets charged.
 */

import { useState } from 'react';
import { useSigner } from '@/components/SignerProvider';

/** Refusals a read can name, so none of them needs a transaction to discover. */
export type Blocker =
  | { kind: 'no-account' }
  | { kind: 'self-payment' }
  | { kind: 'insufficient-balance'; have: string; need: string }
  | { kind: 'not-for-sale' }
  | { kind: 'price-moved'; listed: string; live: string }
  | { kind: 'tier-inactive' };

export interface Quote {
  bytes: string;
  gasMist: string;
  contentKey: string;
  creatorReceives: string;
  platformReceives: string;
}

/**
 * Where the purchase is, in the reader's terms.
 *
 * `submitted` is deliberately not called "settled": the digest exists and the node accepted the
 * transaction, and the entitlement is read from the chain on the next load. Claiming settlement
 * from a 200 would be claiming to know something this client has not read.
 */
export type UnlockStage =
  | 'idle'
  | 'signing-in'
  | 'simulating'
  | 'awaiting-signature'
  | 'submitting'
  | 'submitted'
  | 'refused'
  | 'failed';

export function useUnlock({
  vaultId,
  contentKey,
  expectedPrice,
}: {
  vaultId: string;
  contentKey: string;
  expectedPrice: string;
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

  const stage: UnlockStage =
    digest !== null
      ? 'submitted'
      : error !== null
        ? 'failed'
        : blocked !== null
          ? 'refused'
          : signer === null
            ? 'signing-in'
            : busy && quote === null
              ? 'simulating'
              : busy
                ? 'submitting'
                : quote !== null
                  ? 'awaiting-signature'
                  : 'idle';

  return {
    signer,
    stage,
    quote,
    blocked,
    digest,
    busy,
    error,
    simulate,
    signAndSubmit,
    cancel: () => {
      setQuote(null);
      setError(null);
    },
  };
}
