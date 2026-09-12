'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useCallback, useState } from 'react';
import { useSigner } from '@/components/SignerProvider';

export type Blocker =
  | { kind: 'no-account' }
  | { kind: 'self-payment' }
  | { kind: 'insufficient-balance'; have: string; need: string }
  | { kind: 'not-for-sale' }
  | { kind: 'price-moved'; listed: string; live: string }
  | { kind: 'tier-inactive' };

export type CheckoutStage =
  | 'idle'
  | 'signing-in'
  | 'simulating'
  | 'awaiting-signature'
  | 'submitting'
  | 'submitted'
  | 'refused'
  | 'failed';

/*
  Every decision that moves money runs the same way: simulate on the server for this sender,
  show what the chain said, sign exactly those bytes, submit them, and only then say it is done.
  The quote's shape differs per flow; the stages do not. `/api/checkout/submit` executes the
  transaction and answers with its digest once the chain has it, so `submitted` is the chain's word.
*/
export function useCheckout<Q extends { bytes: string }>() {
  const { signer } = useSigner();
  const [quote, setQuote] = useState<Q | null>(null);
  const [blocked, setBlocked] = useState<Blocker | null>(null);
  const [digest, setDigest] = useState<string | null>(null);
  /* True once the wallet has signed: after that a failure is "not accepted", never "nothing signed". */
  const [signed, setSigned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const simulate = useCallback(
    async (endpoint: string, payload: Record<string, unknown>) => {
      if (signer === null) return;
      setBusy(true);
      setError(null);
      setBlocked(null);
      setQuote(null);
      setDigest(null);
      setSigned(false);
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sender: signer.address, ...payload }),
        });
        const body = (await response.json()) as {
          quote?: Q;
          blocked?: Blocker;
          needsAccount?: boolean;
          error?: string;
        };
        if (body.blocked !== undefined) setBlocked(body.blocked);
        else if (body.needsAccount === true) setBlocked({ kind: 'no-account' });
        else if (body.quote === undefined) setError(body.error ?? 'this could not be simulated');
        else setQuote(body.quote);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [signer],
  );

  const signAndSubmit = useCallback(async (): Promise<string | null> => {
    if (signer === null || quote === null) return null;
    setBusy(true);
    setError(null);
    try {
      const signature = await signer.signTransaction(quote.bytes);
      setSigned(true);
      const response = await fetch('/api/checkout/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bytes: quote.bytes, signature }),
      });
      const body = (await response.json()) as { digest?: string; error?: string };
      if (body.digest === undefined) {
        setError(body.error ?? 'the transaction was not accepted');
        return null;
      }
      setDigest(body.digest);
      return body.digest;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    } finally {
      setBusy(false);
    }
  }, [signer, quote]);

  const reset = useCallback(() => {
    setQuote(null);
    setBlocked(null);
    setDigest(null);
    setSigned(false);
    setError(null);
  }, []);

  const stage: CheckoutStage =
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

  return { signer, stage, quote, blocked, digest, signed, busy, error, simulate, signAndSubmit, reset };
}
