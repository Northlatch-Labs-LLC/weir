'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

/**
 * Type 2 registration: buy the name, open the account, land on your own page.
 *
 * # What makes this different from `/join`
 *
 * `/join` claims a handle and costs only gas. This buys a `.sui` through our registrar, and the
 * purchase *is* the signup — the name and the account are created in one transaction, and the check
 * mark follows from holding a name bought here.
 *
 * So this screen carries an obligation `/join` does not: it is asking for real money, usually from
 * somebody spending it on this platform for the first time. Every figure shown is measured —
 * SuiNS's own price, our fee read live from the registrar, and gas from simulating the exact bytes
 * that will be signed. Nothing here is an estimate typed into the source.
 *
 * # Why the two prices are shown apart
 *
 * The name price goes to SuiNS and the service fee goes to us. A single total would be honest
 * arithmetic and dishonest presentation: somebody weighing this against buying direct from SuiNS
 * deserves to see exactly what the difference is, rather than discovering it later and concluding
 * it had been hidden.
 *
 * # Nothing is signed that was not simulated
 *
 * The bytes returned by the prepare route are the bytes signed and the bytes submitted, never
 * rebuilt in between. A rebuilt transaction is a different transaction, and the signature would be
 * over something the reader was never shown.
 */

import { useState } from 'react';
import { useSigner } from '@/components/SignerProvider';
import { SignIn } from '@/components/SignIn';
import { formatSui } from '@/lib/units';

/*
  The response shape, mirrored from `/api/names/purchase/prepare`.

  It carried a `handle` while this flow also opened an account. Nothing failed when the route
  stopped sending it — this interface is the component's own claim about the response, and `tsc`
  checks against the claim rather than the route. The field was silently `undefined` and would have
  produced a link to `/c/undefined`.
*/
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

/** Mist to SUI. String arithmetic — `Number` loses precision above 2^53, and this is money. */
const sui = formatSui;

/*
  No `referrer`, and no router.

  Both existed because this used to open an account: `account::open` records a referrer, and a new
  account was sent to its own page. Buying a name does neither. Keeping the prop would advertise an
  attribution that nothing records — which is worse than not offering it, because somebody would
  build a referral link on top of it and be paid nothing.
*/
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
        // The route's message names the actual cause — a taken handle, a hyphen, a paused
        // registrar, too little SUI. Passing it through beats replacing it with a generic line.
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
        // The bytes that were simulated, unchanged. Nothing is rebuilt here.
        body: JSON.stringify({ bytes: quote.bytes, signature }),
      });
      const body = (await response.json()) as { digest?: string; error?: string };
      if (body.digest === undefined) {
        setError(body.error ?? 'the purchase was not accepted');
      } else {
        /*
          No profile write here any more.

          This transaction buys a name and nothing else. It creates no account, so there is no page
          to bring into existence — `/join` does that, and it does it for the account it opened.
        */
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

  /*
    Done. Deliberately not an automatic redirect: this transaction spent real money, and whisking
    somebody off the one screen showing their digest means the receipt is gone before they have read
    it. They go when they choose to.
  */
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
              // The quote belongs to the old name. Left on screen it would price something else.
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
