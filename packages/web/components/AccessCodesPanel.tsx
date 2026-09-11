'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

/**
 * Access codes, on the admin page.
 *
 * Sits next to `SiteModeSwitch` and is gated the same way — the server renders it only for the
 * holder of this package's `Publisher`, and every write below is refused by the API for anybody
 * else. Like the switch, it shows what the server last said and never what was clicked: a code
 * appears in the list only when the response carrying it comes back.
 */

import { useState } from 'react';
import type { AccessCode } from '@/lib/access-codes';

type Status = 'live' | 'exhausted' | 'expired' | 'revoked';

function statusOf(c: AccessCode, now: number): Status {
  if (c.revokedAtMs !== null) return 'revoked';
  if (c.expiresAtMs !== null && c.expiresAtMs <= now) return 'expired';
  if (c.uses >= c.maxUses) return 'exhausted';
  return 'live';
}

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRY: ReadonlyArray<{ label: string; days: number | null }> = [
  { label: 'Never expires', days: null },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
];

function stamp(ms: number | null): string {
  return ms === null ? '—' : `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function AccessCodesPanel({ initial }: { initial: AccessCode[] | null }) {
  const [codes, setCodes] = useState<AccessCode[]>(initial ?? []);
  const unread = initial === null;
  const [label, setLabel] = useState('');
  const [maxUses, setMaxUses] = useState('1');
  const [expiryDays, setExpiryDays] = useState<number | null>(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const now = Date.now();

  async function mint() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/access-codes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          label,
          maxUses: Number(maxUses),
          expiresAtMs: expiryDays === null ? null : Date.now() + expiryDays * DAY_MS,
        }),
      });
      const body = (await response.json()) as { code?: AccessCode; error?: string };
      if (!response.ok || body.code === undefined) {
        setError(body.error ?? `the request was refused (${response.status})`);
        return;
      }
      setCodes((held) => [body.code!, ...held]);
      setLabel('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(code: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/access-codes', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const body = (await response.json()) as { code?: AccessCode; error?: string };
      if (!response.ok || body.code === undefined) {
        setError(body.error ?? `the request was refused (${response.status})`);
        return;
      }
      setCodes((held) => held.map((c) => (c.code === code ? body.code! : c)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      window.setTimeout(() => setCopied((c) => (c === code ? null : c)), 1500);
    } catch {
      setError('the clipboard refused — select the code and copy it by hand');
    }
  }

  return (
    <div className="card" data-reveal>
      <h2 style={{ marginTop: 0 }}>Access codes</h2>
      <p style={{ color: 'var(--text-secondary)' }}>
        A way through the front door while it is closed. Hand a code to a person; they enter it
        under &ldquo;I have a code&rdquo; on the waiting list and their browser holds a pass for up
        to thirty days. Revoking a code ends every pass it issued within a few seconds.
      </p>

      <div style={{ display: 'grid', gap: 'var(--space-12)', gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))', alignItems: 'end' }}>
        <label className="vr-field">
          <span>Label (who it is for)</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder="e.g. Ada, press" disabled={busy} />
        </label>
        <label className="vr-field">
          <span>Uses</span>
          <input value={maxUses} onChange={(e) => setMaxUses(e.target.value)} inputMode="numeric" pattern="[0-9]*" disabled={busy} />
        </label>
        <label className="vr-field">
          <span>Expires</span>
          <select value={expiryDays === null ? 'never' : String(expiryDays)} onChange={(e) => setExpiryDays(e.target.value === 'never' ? null : Number(e.target.value))} disabled={busy}>
            {EXPIRY.map((o) => (
              <option key={o.label} value={o.days === null ? 'never' : String(o.days)}>{o.label}</option>
            ))}
          </select>
        </label>
        <button className="btn" type="button" disabled={busy} onClick={() => void mint()}>
          {busy ? 'Working…' : 'Mint a code'}
        </button>
      </div>

      {error !== null && (
        <p className="unmeasured" style={{ marginBottom: 0 }}>{error}</p>
      )}

      {unread && codes.length === 0 ? (
        <p className="unmeasured" style={{ marginTop: 'var(--space-16)' }}>
          Not measured — the code list could not be read, so nothing below is known. Codes already
          issued still work; minting one now will say whether the database is back.
        </p>
      ) : codes.length === 0 ? (
        <p className="k" style={{ marginTop: 'var(--space-16)' }}>No codes yet. The list was read and holds none.</p>
      ) : (
        <div style={{ overflowX: 'auto', marginTop: 'var(--space-16)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr>
                {['code', 'label', 'uses', 'expires', 'status', ''].map((h, i) => (
                  <th key={i} scope="col" className="k" style={{ textAlign: 'left', padding: '0 0.75rem 0.5rem 0', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => {
                const status = statusOf(c, now);
                return (
                  <tr key={c.code}>
                    <td className="mono" style={{ padding: '0.5rem 0.75rem 0.5rem 0', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' }}>
                      {c.code}{' '}
                      <button className="btn ghost" type="button" style={{ padding: '0.15rem 0.5rem', fontSize: '0.75rem' }} onClick={() => void copy(c.code)}>
                        {copied === c.code ? 'Copied' : 'Copy'}
                      </button>
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem 0.5rem 0', borderBottom: '1px solid var(--line)' }}>{c.label === '' ? '—' : c.label}</td>
                    <td className="mono" style={{ padding: '0.5rem 0.75rem 0.5rem 0', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' }}>{c.uses} / {c.maxUses}</td>
                    <td className="mono" style={{ padding: '0.5rem 0.75rem 0.5rem 0', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' }}>{stamp(c.expiresAtMs)}</td>
                    <td style={{ padding: '0.5rem 0.75rem 0.5rem 0', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' }}>
                      <span className={status === 'live' ? 'pill subs' : 'pill'}>{status}</span>
                    </td>
                    <td style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' }}>
                      {status !== 'revoked' && (
                        <button className="btn ghost" type="button" disabled={busy} onClick={() => void revoke(c.code)}>Revoke</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="note" style={{ marginTop: 'var(--space-20)' }}>
        <span className="lbl">A pass is not a permission</span>
        <p>
          It decides whether this website serves the product or the waiting list, nothing more.
          What a visitor may read is still decided by the objects their address holds on chain.
        </p>
      </div>
    </div>
  );
}
