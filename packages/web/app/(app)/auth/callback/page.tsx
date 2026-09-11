'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useEffect, useState } from 'react';
import { readIdTokenFromFragment, SESSION_STORAGE_KEY, type PendingSession } from '@/lib/zklogin';
import { completeGoogleSignIn } from '@/components/SignerProvider';

type State =
  | { phase: 'working'; detail: string }
  | { phase: 'failed'; detail: string }
  | { phase: 'done'; address: string };

let captured: string | null = null;

function takeFragmentOnce(): string {
  if (captured === null) {
    captured = window.location.hash;
    window.history.replaceState(null, '', window.location.pathname);
  }
  return captured;
}

let inFlight: Promise<{ address: string }> | null = null;

function completeOnce(idToken: string): Promise<{ address: string }> {
  inFlight ??= completeGoogleSignIn(idToken);
  return inFlight;
}

export default function AuthCallbackPage() {
  const [state, setState] = useState<State>({ phase: 'working', detail: 'Reading the sign-in…' });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const token = readIdTokenFromFragment(takeFragmentOnce());

      if (!token.ok) {
        if (!cancelled) setState({ phase: 'failed', detail: token.failure.detail });
        return;
      }

      if (!cancelled) {
        setState({ phase: 'working', detail: 'Proving it, without revealing it…' });
      }

      try {
        const session = await completeOnce(token.value);
        if (cancelled) return;
        setState({ phase: 'done', address: session.address });

        const stored = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
        const returnTo =
          stored === null ? '/' : ((JSON.parse(stored) as PendingSession).returnTo || '/');
        window.location.assign(returnTo);
      } catch (cause) {
        if (!cancelled) {
          setState({
            phase: 'failed',
            detail: cause instanceof Error ? cause.message : String(cause),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="container" style={{ maxWidth: 'var(--layout-measure)' }}>
      <div className="panel" style={{ marginTop: 'var(--space-56)' }}>
        {state.phase === 'working' && (
          <>
            <h1 style={{ fontSize: 'var(--text-h3)', marginTop: 0 }}>Signing you in</h1>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 0 }}>{state.detail}</p>
            <p className="locked-why">
              A zero-knowledge proof is being generated. It shows the network that you hold a valid
              Google sign-in for this account without putting anything about that account on chain.
              This takes a few seconds.
            </p>
          </>
        )}

        {state.phase === 'done' && (
          <>
            <h1 style={{ fontSize: 'var(--text-h3)', marginTop: 0 }}>Signed in</h1>
            <p className="mono" style={{ color: 'var(--text-prize)' }}>
              {state.address.slice(0, 10)}…{state.address.slice(-6)}
            </p>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 0 }}>Taking you back…</p>
          </>
        )}

        {state.phase === 'failed' && (
          <div className="note crit">
            <span className="lbl">Not signed in</span>
            <p>{state.detail}</p>
            <p style={{ marginBottom: 0 }}>
              Nothing was created and nothing was charged. <a href="/">Go back</a> and try again.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
