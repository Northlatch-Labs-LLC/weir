'use client';
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude

/**
 * The escape hatch, made reachable.
 *
 * # Why this screen has to exist
 *
 * This platform's claim is that identity and payments are on-chain objects, not database rows. A
 * Google sign-in quietly puts an asterisk on that: the salt behind the address is derived from a
 * seed this deployment holds, so an account created that way is reachable only for as long as this
 * deployment keeps that seed. If it disappeared, so would every zkLogin address it issued.
 *
 * That dependency cannot be argued away, only *ended*. Salt plus a Google sign-in plus any zkLogin
 * proving service reconstructs the address and signs from it with nothing from us. A route that
 * does this existed before this component did — and an escape hatch nobody can reach is not an
 * escape hatch, it is a paragraph in a source file.
 *
 * # Nothing is revealed until it is asked for
 *
 * The salt is not fetched on mount and not shown beside the address. Reading it spends a fresh,
 * nonce-bound, Google-signed token, and the act of asking should be as deliberate as the value
 * deserves. A page that displayed it automatically would put it in every screenshot and every
 * screen-share of somebody showing a colleague their profile.
 *
 * # Wallet users see none of this, and that is correct
 *
 * A wallet session has no salt and never depended on us for anything. Showing an empty recovery
 * panel to those users would imply a risk they do not carry.
 */

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

  // Nothing to recover, and nothing that ever depended on this platform.
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

  /**
   * All five values as one block.
   *
   * Deliberately not five separate copy buttons: a salt on its own recovers nothing, and somebody
   * who copied only the interesting-looking number would discover that with no working deployment
   * left to ask. One button, one artefact, everything needed.
   */
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
        You signed in with Google, so your address is derived from a secret this site holds. That
        means <strong style={{ color: 'var(--text-primary)' }}>if this site disappeared, you could
        not reach your funds</strong>, not because anyone took them, but because nobody would be
        able to work out which address was yours.
      </p>

      <p className="locked-why">
        This site cannot spend from your address. Moving money needs a live Google sign-in
        <em> and</em> a key held on your device, and the secret behind your address produces
        neither. The risk here is losing access, not theft.
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
            Anyone holding these can work out which Sui address belongs to your Google account. They
            still cannot spend from it. Treat them as private, not as a password.
          </p>
        </>
      )}
    </div>
  );
}
