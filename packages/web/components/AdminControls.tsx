'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useState } from 'react';
import { useSigner } from '@/components/SignerProvider';
import { MultisigSubmit } from '@/components/MultisigSubmit';

type Action =
  | { kind: 'set-fees'; feeBps: string; referralShareBps: string; creationFeeMist: string }
  | { kind: 'set-creation-paused'; paused: boolean }
  | { kind: 'set-payments-paused'; paused: boolean }
  | { kind: 'sweep-treasury'; amountMist: string };

interface Quote {
  bytes: string;
  gasMist: string;
  summary: string;
}

export function AdminControls({
  address,
  feeBps,
  referralShareBps,
  creationFeeMist,
  creationPaused,
  paymentsPaused,
  treasuryMist,
}: {
  address: string;
  feeBps: string;
  referralShareBps: string;
  creationFeeMist: string;
  creationPaused: boolean;
  paymentsPaused: boolean;
  treasuryMist: string;
}) {
  const [fee, setFee] = useState(feeBps);
  const [share, setShare] = useState(referralShareBps);
  const [creation, setCreation] = useState(creationFeeMist);
  const [sweep, setSweep] = useState('');

  const [quote, setQuote] = useState<Quote | null>(null);
  const [digest, setDigest] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { signer } = useSigner();

  async function fetchJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
    let lastFailure = 'the server did not answer';
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetch(url, init);
        const text = await response.text();
        try {
          return JSON.parse(text) as Record<string, unknown>;
        } catch {
          lastFailure = `the network in front of the server hiccupped (status ${response.status})`;
        }
      } catch (cause) {
        lastFailure = cause instanceof Error ? cause.message : String(cause);
      }
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
    throw new Error(`${lastFailure} — tried three times; wait a moment and press once more`);
  }

  async function prepare(action: Action) {
    setBusy(true);
    setError(null);
    setQuote(null);
    setDigest(null);
    try {
      const body = (await fetchJson('/api/admin/prepare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sender: address, action }),
      })) as { quote?: Quote; error?: string };
      if (body.quote === undefined) setError(body.error ?? 'the transaction could not be prepared');
      else setQuote(body.quote);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function signHere() {
    if (quote === null || signer === null) return;
    setBusy(true);
    setError(null);
    try {
      const signature = await signer.signTransaction(quote.bytes);
      const body = (await fetchJson('/api/checkout/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bytes: quote.bytes, signature }),
      })) as { digest?: string; error?: string };
      if (body.digest === undefined) setError(body.error ?? 'the transaction was not accepted');
      else setDigest(body.digest);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="card" style={{ marginTop: 'var(--space-20)' }}>
        <span className="k">PAUSE SWITCHES</span>
        <p style={{ color: 'var(--text-secondary)' }}>
          The controls to reach for when something is wrong. Pausing creation stops new vaults;
          pausing payments stops every subscription, tip and unlock from settling. Neither touches
          money already held.
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-8)', flexWrap: 'wrap' }}>
          <button
            className="btn ghost"
            type="button"
            disabled={busy}
            onClick={() => void prepare({ kind: 'set-creation-paused', paused: !creationPaused })}
          >
            {creationPaused ? 'Allow vault creation' : 'Pause vault creation'}
          </button>
          <button
            className="btn ghost"
            type="button"
            disabled={busy}
            onClick={() => void prepare({ kind: 'set-payments-paused', paused: !paymentsPaused })}
          >
            {paymentsPaused ? 'Allow payments' : 'Pause payments'}
          </button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 'var(--space-20)' }}>
        <span className="k">FEES</span>
        <p style={{ color: 'var(--text-secondary)' }}>
          In basis points. The ceilings are enforced by the contract: 3000 for the platform fee,
          5000 for the referral share. Changing these affects vaults opened afterwards — every
          existing vault keeps the fee stamped into it at creation.
        </p>
        <label className="vr-field">
          <span className="k">Platform fee · bps</span>
          <input className="field mono" value={fee} inputMode="numeric" onChange={(e) => setFee(e.target.value)} />
        </label>
        <label className="vr-field">
          <span className="k">Referral share · bps of the fee</span>
          <input className="field mono" value={share} inputMode="numeric" onChange={(e) => setShare(e.target.value)} />
        </label>
        <label className="vr-field">
          <span className="k">Vault creation fee · mist</span>
          <input className="field mono" value={creation} inputMode="numeric" onChange={(e) => setCreation(e.target.value)} />
        </label>
        <button
          className="btn"
          type="button"
          disabled={busy}
          onClick={() =>
            void prepare({
              kind: 'set-fees',
              feeBps: fee.trim(),
              referralShareBps: share.trim(),
              creationFeeMist: creation.trim(),
            })
          }
        >
          Prepare fee change
        </button>
      </div>

      <div className="card" style={{ marginTop: 'var(--space-20)' }}>
        <span className="k">TREASURY</span>
        <p style={{ color: 'var(--text-secondary)' }}>
          Holds <span className="mono">{treasuryMist}</span> mist. A sweep sends the amount to the
          address that signs it — which is the capability holder, not whoever filled in this form.
        </p>
        <label className="vr-field">
          <span className="k">Amount · mist</span>
          <input className="field mono" value={sweep} inputMode="numeric" placeholder="0" onChange={(e) => setSweep(e.target.value)} />
        </label>
        <button
          className="btn ghost"
          type="button"
          disabled={busy || sweep.trim() === ''}
          onClick={() => void prepare({ kind: 'sweep-treasury', amountMist: sweep.trim() })}
        >
          Prepare sweep
        </button>
      </div>

      {quote !== null && (
        <div className="card" style={{ marginTop: 'var(--space-20)' }}>
          <span className="k">SIMULATED — NOTHING SIGNED YET</span>
          <p style={{ color: 'var(--text-primary)', marginTop: 'var(--space-12)' }}>{quote.summary}</p>
          <p className="section-note">Gas: {quote.gasMist} mist</p>

          <div style={{ display: 'flex', gap: 'var(--space-8)', flexWrap: 'wrap' }}>
            {/*
              Offered only when the connected wallet is the capability holder. For any other
              address this button would build a signature the chain refuses, so it is absent
              rather than present and failing.
            */}
            {signer !== null && signer.address.toLowerCase() === address.toLowerCase() && (
              <button className="btn" type="button" disabled={busy} onClick={() => void signHere()}>
                {busy ? 'Waiting for your wallet…' : 'Sign and submit'}
              </button>
            )}
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                void navigator.clipboard
                  .writeText(quote.bytes)
                  .then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  })
                  .catch(() => setCopied(false));
              }}
            >
              {copied ? 'Copied' : 'Copy bytes for multisig'}
            </button>
            <button className="btn ghost" type="button" onClick={() => setQuote(null)}>
              Discard
            </button>
          </div>

          <p className="locked-why" style={{ marginBottom: 0 }}>
            These bytes are what gets signed. Nothing is rebuilt between here and submission — a
            rebuilt transaction is a different transaction, and the signature would be over
            something nobody reviewed.
          </p>

          {/*
            The path for a capability nobody in this browser can hold.
          */}
          {(signer === null || signer.address.toLowerCase() !== address.toLowerCase()) && (
            <MultisigSubmit bytes={quote.bytes} summary={quote.summary} />
          )}
        </div>
      )}

      {digest !== null && (
        <div className="note" style={{ marginTop: 'var(--space-20)' }}>
          <span className="lbl">Landed</span>
          <p className="mono" style={{ overflowWrap: 'anywhere' }}>{digest}</p>
          <p>
            Reload to read the platform back. Verifying by reading rather than trusting the receipt
            is the point — a change that failed to apply looks identical to one that worked until
            somebody checks.
          </p>
        </div>
      )}

      {error !== null && (
        <div className="note crit" style={{ marginTop: 'var(--space-20)' }} role="alert">
          <span className="lbl">Not prepared</span>
          <p>{error}</p>
        </div>
      )}
    </>
  );
}
