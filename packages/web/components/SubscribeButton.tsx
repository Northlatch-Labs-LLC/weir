'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

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
  tierName: string;
  pricePerPeriod: string;
  periodDays: number;
  creatorReceives: string;
  platformReceives: string;
}

function amount(raw: string, decimals: number): string {
  const value = BigInt(raw);
  const scale = 10n ** BigInt(decimals);
  const frac = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return frac === '' ? `${value / scale}` : `${value / scale}.${frac}`;
}

export function SubscribeButton({
  vaultId,
  coinType,
  tierIndex,
  decimals,
  symbol,
}: {
  vaultId: string;
  coinType: string;
  tierIndex: number;
  decimals: number;
  symbol: string;
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
      const response = await fetch('/api/checkout/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sender: signer.address, vaultId, coinType, tierIndex }),
      });
      const body = (await response.json()) as {
        quote?: Quote;
        blocked?: Blocker;
        error?: string;
      };
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

  if (digest !== null) {
    return (
      <div className="note" style={{ marginTop: 'var(--space-12)' }}>
        <span className="lbl">You are a member</span>
        <p>
          The <span className="mono">Subscription</span> object is in your wallet. It is what
          opens subscriber posts. This site checks it on every read; nothing here can revoke
          your access.
        </p>
        <p className="mono" style={{ fontSize: 'var(--text-micro)', overflowWrap: 'anywhere' }}>
          {digest}
        </p>
      </div>
    );
  }

  if (signer === null) {
    return (
      <div style={{ marginTop: 'var(--space-12)' }}>
        <SignIn compact />
      </div>
    );
  }

  if (blocked !== null) {
    return (
      <div className="note warn" style={{ marginTop: 'var(--space-12)' }}>
        <span className="lbl">Not subscribed</span>
        {blocked.kind === 'no-account' && (
          <p>
            Paying needs an account here; the contract has no anonymous path.{' '}
            <a href="/join">Claim a handle</a>. It is free apart from gas.
          </p>
        )}
        {blocked.kind === 'self-payment' && (
          <p>This is your own vault. The contract refuses a creator paying themselves.</p>
        )}
        {blocked.kind === 'insufficient-balance' && (
          <p>
            This costs {amount(blocked.need, decimals)} {symbol} and you hold{' '}
            {amount(blocked.have, decimals)}.
          </p>
        )}
        {blocked.kind === 'tier-inactive' && (
          <p>The creator has turned this tier off, so it cannot be bought.</p>
        )}
        <button className="btn ghost" type="button" onClick={() => setBlocked(null)}>
          Back
        </button>
      </div>
    );
  }

  if (quote === null) {
    return (
      <button
        className="btn"
        type="button"
        disabled={busy}
        style={{ marginTop: 'var(--space-12)', width: '100%', justifyContent: 'center' }}
        onClick={() => void simulate()}
      >
        {busy ? 'Checking…' : 'Join'}
      </button>
    );
  }

  return (
    <div className="note" style={{ marginTop: 'var(--space-12)' }}>
      <span className="lbl">Checked against the chain. Nothing signed yet</span>
      <p>
        {quote.tierName} · {amount(quote.pricePerPeriod, decimals)} {symbol} every{' '}
        {quote.periodDays} days. The creator receives{' '}
        {amount(quote.creatorReceives, decimals)} and the platform{' '}
        {amount(quote.platformReceives, decimals)}. Gas is about{' '}
        {amount(quote.gasMist, 9)} SUI.
      </p>
      {/*
        Said plainly before signing rather than after. A subscription is a purchase, not a deposit —
        the money does not come back, and the entity markers on this page draw exactly that
        distinction.
      */}
      <p className="locked-why">
        This is a payment. It is final and does not renew. The subscription ends when its
        period ends.
      </p>
      <div style={{ display: 'flex', gap: 'var(--space-8)', flexWrap: 'wrap' }}>
        <button className="btn" type="button" disabled={busy} onClick={() => void signAndSubmit()}>
          {busy ? 'Waiting for your wallet…' : 'Pay and join'}
        </button>
        <button className="btn ghost" type="button" disabled={busy} onClick={() => setQuote(null)}>
          Back
        </button>
      </div>
      {error !== null && <p className="unmeasured">{error}</p>}
    </div>
  );
}
