'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useState } from 'react';

export function MultisigSubmit({ bytes, summary }: { bytes: string; summary: string }) {
  const [signature, setSignature] = useState('');
  const [busy, setBusy] = useState(false);
  const [digest, setDigest] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/checkout/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bytes, signature: signature.trim() }),
      });
      const body = (await response.json()) as { digest?: string; error?: string };
      if (body.digest === undefined) setError(body.error ?? 'the transaction was not accepted');
      else setDigest(body.digest);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="note" style={{ marginTop: 'var(--space-20)' }}>
      <span className="lbl">Sign as the multisig</span>
      <p>
        The capability is held by a 2-of-3 multisig, so this cannot be signed in a browser. Take the
        bytes below to where the keys are, collect two signatures, combine them, and paste the
        result back.
      </p>

      <p className="section-note" style={{ margin: '0 0 var(--space-8)' }}>{summary}</p>

      <div style={{ display: 'flex', gap: 'var(--space-8)', marginBottom: 'var(--space-12)' }}>
        <textarea
          className="field mono"
          readOnly
          rows={3}
          value={bytes}
          aria-label="Transaction bytes to sign"
          style={{ flex: 1, fontSize: 'var(--text-body-sm)' }}
        />
        <button
          className="btn ghost"
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(bytes).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <pre
        className="mono"
        style={{
          fontSize: 'var(--text-body-sm)', overflowX: 'auto', margin: '0 0 var(--space-12)',
          padding: 'var(--space-12)', background: 'var(--bg-surface-sunken)',
          border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
          color: 'var(--text-secondary)',
        }}
      >{`# on the machine holding each key, twice — any two of the three members
sui keytool sign --address <member-address> --data <bytes above>

# then combine the two partial signatures into one multisig signature
sui keytool multi-sig-combine-partial-sig \\
  --pks <pk0> <pk1> <pk2> --weights 1 1 1 --threshold 2 \\
  --sigs <signature-a> <signature-b>`}</pre>

      <textarea
        className="field mono"
        rows={3}
        value={signature}
        onChange={(event) => setSignature(event.target.value)}
        placeholder="Paste the combined multisig signature"
        aria-label="Combined multisig signature"
        style={{ width: '100%', fontSize: 'var(--text-body-sm)', marginBottom: 'var(--space-12)' }}
      />

      <button
        className="btn"
        type="button"
        disabled={busy || signature.trim() === ''}
        onClick={() => void submit()}
      >
        {busy ? 'Submitting…' : 'Submit signed transaction'}
      </button>

      {digest !== null && (
        <p style={{ marginTop: 'var(--space-12)', marginBottom: 0 }}>
          Executed. <span className="mono">{digest}</span>
        </p>
      )}
      {error !== null && <p className="unmeasured" style={{ marginBottom: 0 }}>{error}</p>}
    </div>
  );
}
