import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Shell from '@/components/layout/Shell';
import { useWallet } from '@/lib/wallet';
import Icon from '@/components/base/Icon';

/**
 * The two ways in, and there are only two.
 *
 * # There is no password here, and there is no form
 *
 * This page asked for a handle and signed the visitor in on the strength of having typed one. It
 * checked nothing. An account on this platform is a keypair, so proving you hold it is the only
 * sign-in there can be, and it happens one of two ways:
 *
 *   a wallet in the browser signs a challenge, or
 *   Google issues a token that zkLogin turns into a Sui address.
 *
 * # Why the second one is asked for rather than assumed
 *
 * zkLogin needs a client id and a prover this deployment may not have. `/api/zklogin/session` is
 * the back end saying whether it does. Rendering a Google button on a deployment without it would
 * be a door painted on a wall — so the button appears only when the answer is yes, and when the
 * answer is no the page says so in the deployment's own words.
 */

const ECOSYSTEM_URL = 'https://sui.io/ecosystem';

interface ZkState {
  available: boolean;
  reason?: string;
}

export default function SignIn() {
  const { wallets, connected, address, connect, busy, error } = useWallet();

  const [zk, setZk] = useState<ZkState | null>(null);
  const [zkFailed, setZkFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/zklogin/session');
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as Record<string, unknown>;
        if (cancelled) return;
        setZk({
          available: body.available === true,
          ...(typeof body.reason === 'string' ? { reason: body.reason } : {}),
        });
      } catch {
        // Asked, and could not reach an answer. Different from "not offered", and shown as such.
        if (!cancelled) setZkFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Shell>
      <div className="mx-auto max-w-md px-4 pt-16 md:px-6">
        <h1 className="font-serif text-h2 font-medium text-ink-10">Get back in.</h1>
        <p className="mt-2 max-w-[52ch] text-body-sm text-ink-8">
          Your account is a key, not an email address. There is no password to remember and none for
          us to lose.
        </p>

        {connected && address !== null ? (
          <div className="mt-8 rounded-lg border border-mint/50 bg-mint/10 p-5">
            <p className="text-body-sm font-semibold text-mint">You are signed in.</p>
            <p className="mt-1 font-mono text-caption text-ink-9">{address}</p>
            <Link
              to="/vault"
              className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-md border border-ink-5 bg-ink-2 px-4 text-body-sm text-ink-9 hover:text-ink-10"
            >
              Go to your vault
            </Link>
          </div>
        ) : (
          <div className="mt-8 flex flex-col gap-3">
            {/* 1 — a wallet already in this browser. */}
            {wallets.length > 0 ? (
              wallets.map((w) => (
                <button
                  key={w.name}
                  type="button"
                  disabled={busy}
                  onClick={() => void connect(w.name)}
                  className="rank-primary inline-flex min-h-[52px] cursor-pointer items-center justify-center gap-2 rounded-md px-5 text-body-sm text-ink-0 hover:bg-mint-dim disabled:opacity-50"
                >
                  <Icon name="wallet" size={16} />
                  {busy ? 'Waiting for your wallet…' : `Continue with ${w.name}`}
                </button>
              ))
            ) : (
              <div className="rounded-lg border border-ink-4 bg-ink-1 p-5">
                <p className="text-body-sm text-ink-9">No wallet found in this browser.</p>
                <p className="mt-2 text-body-sm text-ink-8">
                  A Sui wallet is a browser extension that holds your key. Install one, then come
                  back to this page.
                </p>
                <a
                  href={ECOSYSTEM_URL}
                  rel="noreferrer nofollow"
                  target="_blank"
                  className="mt-3 inline-flex min-h-[44px] items-center text-body-sm text-ink-10 underline decoration-ink-6 underline-offset-4 hover:text-mint"
                >
                  See Sui wallets
                </a>
              </div>
            )}

            {/* 2 — Google, when this deployment can actually do it. */}
            {zk !== null && zk.available && (
              <a
                href="/api/zklogin/start"
                className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-md border border-ink-5 bg-ink-2 px-5 text-body-sm font-medium text-ink-9 hover:text-ink-10"
              >
                Continue with Google
              </a>
            )}

            {zk !== null && !zk.available && (
              <p className="text-body-sm text-ink-7">
                {zk.reason ?? 'Signing in with Google is not enabled on this deployment.'}
              </p>
            )}

            {zkFailed && (
              <p className="text-body-sm text-ink-7">
                We could not check whether signing in with Google is available here. Your wallet
                still works.
              </p>
            )}

            {error !== null && (
              <p role="alert" className="text-body-sm text-rose">
                {error}
              </p>
            )}
          </div>
        )}

        <p className="mt-8 text-body-sm text-ink-8">
          No account?{' '}
          <Link
            to="/join"
            className="text-ink-10 underline decoration-ink-6 underline-offset-4 hover:text-mint"
          >
            Create one
          </Link>{' '}
          &mdash; it is free apart from the gas the chain charges.
        </p>
      </div>
    </Shell>
  );
}
