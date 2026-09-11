'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useState } from 'react';

export interface SiteModeView {
  waitlistMode: boolean;
  updatedBy: string | null;
  updatedAtIso: string | null;
}

function provenance(mode: SiteModeView): string {
  if (mode.updatedAtIso === null) {
    return 'Never changed — this deployment has always been open.';
  }
  const when = new Date(mode.updatedAtIso);
  const stamp = Number.isNaN(when.getTime())
    ? mode.updatedAtIso
    : `${when.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  const who =
    mode.updatedBy === null ? 'an address that was not recorded' : `${mode.updatedBy.slice(0, 10)}…`;
  return `Last changed ${stamp} by ${who}`;
}

export function SiteModeSwitch({ initial }: { initial: SiteModeView }) {
  const [mode, setMode] = useState<SiteModeView>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const closed = mode.waitlistMode;

  async function flip(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/site-mode', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ waitlistMode: next }),
      });
      const body = (await response.json()) as Partial<SiteModeView> & { error?: string };

      if (!response.ok || typeof body.waitlistMode !== 'boolean') {
        setError(body.error ?? `the switch was refused (${response.status})`);
        return;
      }

      setMode({
        waitlistMode: body.waitlistMode,
        updatedBy: body.updatedBy ?? null,
        updatedAtIso: body.updatedAtIso ?? null,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" data-reveal>
      <h2 style={{ marginTop: 0 }}>The front door</h2>

      <p style={{ color: 'var(--text-secondary)' }}>
        In waiting-list mode every page redirects to <span className="mono">/waitlist</span>, and the
        header shows the design&rsquo;s &ldquo;closed beta&rdquo; badge in place of the ordinary
        destinations. Signing in, the waiting list itself and the API stay reachable — and so do you,
        so closing the site can never lock you out of reopening it.
      </p>

      <div
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-16)', flexWrap: 'wrap' }}
      >
        <span className={closed ? 'pill' : 'pill subs'}>
          {closed ? 'Closed — waiting list only' : 'Open — the site is live'}
        </span>

        <button
          className={closed ? 'btn' : 'btn ghost'}
          type="button"
          disabled={busy}
          onClick={() => void flip(!closed)}
        >
          {busy ? 'Saving…' : closed ? 'Reopen the site' : 'Put the site behind the waiting list'}
        </button>
      </div>

      <p className="k" style={{ marginTop: 'var(--space-16)' }}>
        {provenance(mode)}
      </p>

      {error !== null && (
        <p className="unmeasured" style={{ marginBottom: 0 }}>
          {error}
        </p>
      )}

      <div className="note" style={{ marginTop: 'var(--space-20)' }}>
        <span className="lbl">This is a front door, not a lock</span>
        <p>
          It decides what this website serves. It is not an authorisation boundary and nothing behind
          it is secret — every page still resolves entitlement from the objects an address owns on
          chain, so a paid body is no more readable with the site open than closed. Authority to flip
          it is ownership of this package&rsquo;s <span className="mono">Publisher</span>, read from
          chain on every write, and it is deliberately <em>not</em> the{' '}
          <span className="mono">PlatformCap</span> that governs fees and the treasury.
        </p>
      </div>
    </div>
  );
}
