'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useState } from 'react';
import { useSigner } from '@/components/SignerProvider';

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
