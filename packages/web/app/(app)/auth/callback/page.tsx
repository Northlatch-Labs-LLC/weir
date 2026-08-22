'use client';
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude

/**
 * Where Google sends the user back.
 *
 * # Why this page is entirely client-side
 *
 * The identity token arrives in the URL *fragment*, and browsers do not send fragments to servers.
 * That is not an inconvenience to work around — it is the security property of the implicit flow.
 * The token reaches this deployment only because this page chooses to POST it, over TLS, to one
 * endpoint. No web server log, no proxy, no CDN and no analytics tag ever sees it in transit.
 *
 * Reading `window.location.hash` on the server is impossible, so there is no version of this page
 * that could accidentally become a server component and start leaking the token into request logs.
 *
 * # The page does nothing else
 *
 * It completes the session and leaves. Whatever the user was doing before signing in is where they
 * go back to — a sign-in that dumps somebody on a home page has lost them the thing they came to do.
 */

import { useEffect, useState } from 'react';
import { readIdTokenFromFragment, SESSION_STORAGE_KEY, type PendingSession } from '@/lib/zklogin';
import { completeGoogleSignIn } from '@/components/SignerProvider';

type State =
  | { phase: 'working'; detail: string }
  | { phase: 'failed'; detail: string }
  | { phase: 'done'; address: string };

/**
 * The fragment, taken exactly once per page load.
 *
 * Module scope rather than a ref, and this is load-bearing. Reading the token and clearing the
 * fragment is a *destructive* read: the credential is deliberately wiped from the address bar so it
 * cannot reach browser history or a screenshot. React StrictMode mounts every effect twice in
 * development, so the second pass found an already-cleared fragment and reported "no identity token
 * came back" over a sign-in that had in fact just succeeded — proof generated, route returned 200,
 * session stored, and the screen said it had failed.
 *
 * A ref would not fix it: StrictMode remounts the component, so refs are re-initialised too. This
 * has to outlive the component, and it does, while still being scoped to one page load.
 */
let captured: string | null = null;

function takeFragmentOnce(): string {
  if (captured === null) {
    captured = window.location.hash;
    // Cleared here, in the same breath as the read, so there is no window in which the token is
    // both consumed and still sitting in the URL.
    window.history.replaceState(null, '', window.location.pathname);
  }
  return captured;
}

/**
 * The sign-in itself, also once.
 *
 * Same reason, different cost. Generating a proof takes about seven seconds of real computation on
 * the proving service, so a second mount firing a second identical request wastes that work, races
 * with the first to write the session, and doubles the load a deployment sees for every user who
 * signs in. Holding the promise means a repeat mount awaits the original rather than starting again.
 */
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
      // Reads the fragment on the first pass and returns the same value on any later one, so a
      // second mount cannot mistake a consumed token for a missing one.
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

        // A full navigation rather than a router push: the provider reads the completed session
        // from storage when it mounts, so the new signer is picked up by the destination page
        // without any cross-component state to keep in sync.
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
