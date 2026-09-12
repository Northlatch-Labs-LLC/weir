'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/app/icons';
import { useSigner } from '@/components/SignerProvider';

/*
  Returns the reader to where they were going once a signer exists. It waits for the signer rather
  than firing on the connect, because `connectWallet` resolves when the extension answers and the
  signer arrives on the next render; and it waits for `accountChoice` to clear, because a wallet
  holding several addresses asks which one, and navigating out from under that question picks for
  them. `replace`, not `push`: a sign-in page is not a place in the reader's history.
*/
export function SigninPanel({ nextPath = '/' }: { nextPath?: string }) {
  const {
    wallets: usable,
    unusableWallets,
    signInWithGoogle,
    connectWallet,
    signer,
    accountChoice,
  } = useSigner();
  const router = useRouter();

  useEffect(() => {
    if (signer === null || accountChoice !== null) return;
    router.replace(nextPath);
  }, [signer, accountChoice, nextPath, router]);

  const wallets = [
    ...usable.map((w) => ({ name: w.name, state: 'detected', onClick: () => void connectWallet(w) })),
    ...unusableWallets.map((w) => ({
      name: w.name,
      state: w.missing.length === 0 ? 'unusable' : `missing ${w.missing.join(', ')}`,
      onClick: () => {},
    })),
  ];

  return (
    <div className="w-body">
      <div className="w-doors">
        <section className="w-card">
          <h3>Sign in with Google</h3>
          <p>
            Sign in the way you would anywhere else and you get a Sui address of your own. No seed
            phrase to write down, nothing to install. Google never learns the address, and the chain
            never learns the Google account. The technique is called zkLogin: a salt held on our
            server, a proof made by a prover, both named in the docs.
          </p>
          <button type="button" className="w-btn w-btn--primary" onClick={() => void signInWithGoogle(nextPath)}>
            Continue with Google
          </button>
        </section>

        <section className="w-card">
          <h3>Connect a Sui wallet</h3>
          <p>Already keep your own keys? Connect directly over the Wallet Standard.</p>
          <div className="w-wallets">
            {wallets.map((w, i) => (
              <button key={`${w.name}-${i}`} type="button" className="w-wallet" onClick={w.onClick}>
                <span className="w-wallet__mark" aria-hidden="true">
                  <Icon name="wallet" size={16} />
                </span>
                <span>{w.name}</span>
                <span className="w-wallet__state">{w.state}</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      <p className="w-card__note">
        After signing in you return to{' '}
        {nextPath === '/' ? 'the home page' : <span className="w-mono">{nextPath}</span>}.
      </p>
      <p className="w-card__note">
        Running an agent? It does not sign in here; it declares itself with two signatures.{' '}
        <a href="/agents">How to declare it →</a>
      </p>
    </div>
  );
}
