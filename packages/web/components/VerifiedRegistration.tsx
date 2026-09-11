'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useState } from 'react';
import { useSigner } from '@/components/SignerProvider';
import { SignIn } from '@/components/SignIn';
import { formatSui } from '@/lib/units';

interface Quote {
  bytes: string;
  gasMist: string;
  quote: {
    label: string;
    domain: string;
    years: number;
    baseUsd: number;
    baseMist: string;
    feeUsd: number;
    feeMist: string;
    totalMist: string;
    suiUsd: number;
  };
}

const sui = formatSui;

export function VerifiedRegistration() {
  const { signer } = useSigner();
  const [label, setLabel] = useState('');
  const [years, setYears] = useState(1);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [digest, setDigest] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function simulate() {
    if (signer === null) return;
    setBusy(true);
    setError(null);
    setQuote(null);
    try {
      const response = await fetch('/api/names/purchase/prepare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sender: signer.address,
          label: label.trim().toLowerCase(),
          years,
        }),
      });
      const body = (await response.json()) as { quote?: Quote; error?: string };
      if (body.quote === undefined) {
        setError(body.error ?? 'the registration could not be simulated');
      } else {
        setQuote(body.quote);
      }
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
      if (body.digest === undefined) {
        setError(body.error ?? 'the purchase was not accepted');
      } else {
        setDigest(body.digest);
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
        <p style={{ marginTop: 0 }}>
          A name is registered to an address, so sign in first and we will know which one to
          register it to.
        </p>
        <SignIn />
      </div>
    );
  }

  if (digest !== null && quote !== null) {
    return (
      <div className="card">
        <span className="k">REGISTERED</span>
        <h2 style={{ marginTop: 'var(--space-12)' }}>
          {quote.quote.domain} is yours
        </h2>
        <p style={{ color: 'var(--text-secondary)' }}>
          The name is registered to your address for {quote.quote.years} year
          {quote.quote.years === 1 ? '' : 's'}. It is an object you hold, so it is yours to point,
          transfer or sell. This platform has no say over it.
        </p>
        <p className="mono" style={{ fontSize: 'var(--text-micro)', overflowWrap: 'anywhere' }}>
          {digest}
        </p>

        <div style={{ display: 'flex', gap: 'var(--space-8)', flexWrap: 'wrap' }}>
          <a
            className="btn ghost"
            href={`https://suiscan.xyz/mainnet/tx/${digest}`}
            target="_blank"
            rel="noreferrer"
          >
            View on explorer
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <span className="k">.SUI NAME</span>
      <h2 style={{ marginTop: 'var(--space-12)' }}>Register a .sui name</h2>
      <p style={{ color: 'var(--text-secondary)' }}>
        A name is an object your address holds: yours to point, transfer or sell. This platform
        has no say over it. Buying it here costs SuiNS&rsquo;s own price plus our service fee, and it
        is a purchase rather than a sign-up: your account is separate and already exists.
      </p>

      <label className="vr-field" htmlFor="vr-label">
        <span className="k">Name</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-8)' }}>
          <input
            id="vr-label"
            className="comment-input mono"
            value={label}
            placeholder="yourname"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => {
              setLabel(event.target.value);
              setQuote(null);
              setError(null);
            }}
          />
          <span className="mono" style={{ color: 'var(--text-tertiary)' }}>
            .sui
          </span>
        </div>
        <p className="section-note">
          Letters, numbers and underscores. A name with a hyphen can be bought from SuiNS but cannot
          also be a handle here, so it is refused before you pay anything.
        </p>
      </label>

      <label className="vr-field" htmlFor="vr-years">
        <span className="k">Years</span>
        <select
          id="vr-years"
          className="comment-input"
          value={years}
          onChange={(event) => {
            setYears(Number(event.target.value));
            setQuote(null);
          }}
        >
          {[1, 2, 3, 4, 5].map((option) => (
            <option key={option} value={option}>
              {option} year{option === 1 ? '' : 's'}
            </option>
          ))}
        </select>
      </label>

      {quote === null ? (
        <button
          className="btn"
          type="button"
          disabled={busy || label.trim().length === 0}
          onClick={() => void simulate()}
        >
          {busy ? 'Checking the price…' : 'Check price'}
        </button>
      ) : (
        <>
          {/*
            Every line is measured: SuiNS's price, our fee read from the registrar, and gas from
            simulating the exact bytes about to be signed.
          */}
          <div className="panel" style={{ marginTop: 'var(--space-16)' }}>
            <span className="k">CHECKED AGAINST THE CHAIN. NOTHING SIGNED YET</span>
            <dl className="quote-lines">
              <div>
                <dt>
                  {quote.quote.domain}, {quote.quote.years} year
                  {quote.quote.years === 1 ? '' : 's'}
                </dt>
                <dd className="mono">{sui(quote.quote.baseMist)} SUI</dd>
              </div>
              <div>
                <dt>Weir service fee</dt>
                <dd className="mono">{sui(quote.quote.feeMist)} SUI</dd>
              </div>
              <div>
                <dt>Gas</dt>
                <dd className="mono">{sui(quote.gasMist)} SUI</dd>
              </div>
              <div className="quote-total">
                <dt>Total</dt>
                <dd className="mono">
                  {sui(BigInt(quote.quote.totalMist) + BigInt(quote.gasMist))} SUI
                </dd>
              </div>
            </dl>
            <p className="locked-why" style={{ marginBottom: 0 }}>
              Priced at ${quote.quote.suiUsd.toFixed(4)} per SUI, live from Pyth, the same feed
              SuiNS charges against. The name is ${quote.quote.baseUsd} and our fee is $
              {quote.quote.feeUsd}. The rate moves, so the amount taken is settled on chain, capped
              at this quote rather than followed blindly.
            </p>
          </div>

          <p style={{ color: 'var(--text-secondary)' }}>
            This registers <span className="mono">{quote.quote.domain}</span> to your address. If any
            part of it fails, none of it happens and you are charged nothing.
          </p>

          <div style={{ display: 'flex', gap: 'var(--space-8)', flexWrap: 'wrap' }}>
            <button
              className="btn"
              type="button"
              disabled={busy}
              onClick={() => void signAndSubmit()}
            >
              {busy ? 'Waiting for your wallet…' : 'Sign and register'}
            </button>
            <button
              className="btn ghost"
              type="button"
              disabled={busy}
              onClick={() => setQuote(null)}
            >
              Back
            </button>
          </div>
        </>
      )}

      {error !== null && (
        <div className="note crit" style={{ marginTop: 'var(--space-16)' }}>
          <span className="lbl">Not registered</span>
          <p>{error}</p>
        </div>
      )}
    </div>
  );
}
