'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useState } from 'react';
import { useSigner, type RecoveryDetails } from '@/components/SignerProvider';

type State =
  | { phase: 'hidden' }
  | { phase: 'loading' }
  | { phase: 'shown'; details: RecoveryDetails }
  | { phase: 'failed'; detail: string };

export function AccountRecovery() {
  const { signer, exportRecovery } = useSigner();
  const [state, setState] = useState<State>({ phase: 'hidden' });
  const [copied, setCopied] = useState(false);

  if (signer === null || signer.kind !== 'zklogin') return null;

  async function reveal() {
    setState({ phase: 'loading' });
    try {
      const details = await exportRecovery();
      if (details === null) {
        setState({ phase: 'failed', detail: 'this session has no salt to export' });
        return;
      }
      setState({ phase: 'shown', details });
    } catch (cause) {
      setState({ phase: 'failed', detail: cause instanceof Error ? cause.message : String(cause) });
    }
  }

  function recoveryText(details: RecoveryDetails): string {
    return [
      'Weir · zkLogin recovery details',
      `address        ${signer?.address ?? ''}`,
      `salt           ${details.salt}`,
      `iss            ${details.iss}`,
      `aud            ${details.aud}`,
      `sub            ${details.sub}`,
      `keyClaimName   ${details.keyClaimName}`,
      `legacyAddress  ${String(details.legacyAddress)}`,
      '',
      details.note,
    ].join('\n');
  }

  return (
    <div className="card">
      <span className="k">RECOVERY · READ THIS ONCE</span>

      <p style={{ color: 'var(--text-secondary)', margin: 'var(--space-12) 0 var(--space-16)' }}>
        You signed in with Google, so your address is derived from a secret Weir holds. Take the
        five values below and{' '}
        <strong style={{ color: 'var(--text-primary)' }}>your account is yours independently of
        us</strong> — a Google sign-in and any zkLogin proving service in the world rebuild this
        exact address and sign from it.
      </p>

      <p className="locked-why">
        Every signature needs a live Google sign-in <em>and</em> a key on your device. You hold both.
      </p>

      <p style={{ color: 'var(--text-secondary)', margin: 'var(--space-16) 0' }}>
        Below are the five values that end that dependency. With them, a Google sign-in and any
        zkLogin proving service reconstruct this exact address and sign from it, with nothing from
        us. Keep them somewhere you keep important things.
      </p>

      {state.phase === 'hidden' && (
        <button className="btn" type="button" onClick={() => void reveal()}>
          Show my recovery details
        </button>
      )}

      {state.phase === 'loading' && (
        <button className="btn" type="button" disabled>
          Proving it&rsquo;s you…
        </button>
      )}

      {state.phase === 'failed' && (
        <div className="note warn">
          <span className="lbl">Not shown</span>
          <p>{state.detail}</p>
          <button
            className="btn ghost"
            type="button"
            style={{ marginTop: 'var(--space-12)' }}
            onClick={() => setState({ phase: 'hidden' })}
          >
            Try again
          </button>
        </div>
      )}

      {state.phase === 'shown' && (
        <>
          <pre className="recovery-block">{recoveryText(state.details)}</pre>
          <div style={{ display: 'flex', gap: 'var(--space-8)', flexWrap: 'wrap' }}>
            <button
              className="btn"
              type="button"
              onClick={() => {
                void navigator.clipboard
                  .writeText(recoveryText(state.details as RecoveryDetails))
                  .then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  })
                  // A refused clipboard permission is not a failure to report loudly — the text is
                  // on screen and selectable, which is the fallback.
                  .catch(() => setCopied(false));
              }}
            >
              {copied ? 'Copied' : 'Copy all five'}
            </button>
            <button className="btn ghost" type="button" onClick={() => setState({ phase: 'hidden' })}>
              Hide
            </button>
          </div>
          <p className="locked-why" style={{ marginBottom: 0 }}>
            These five link your Google account to this Sui address. Keep them private, the way you
            keep a recovery phrase private.
          </p>
        </>
      )}
    </div>
  );
}
