'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { Icon } from '@/components/app/icons';
import { useSigner } from '@/components/SignerProvider';

/*
  The two ways in, side by side: Google through zkLogin, or a Sui wallet over the Wallet Standard.
  The sign-in page and the first step of creating an account show exactly this; there is one set
  of doors on the site.
*/
export function SignInDoors({ returnTo }: { returnTo: string }) {
  const { ready, wallets: usable, unusableWallets, signInWithGoogle, connectWallet } = useSigner();

  const wallets = [
    ...usable.map((w) => ({ name: w.name, state: 'detected', onClick: () => void connectWallet(w) })),
    ...unusableWallets.map((w) => ({
      name: w.name,
      state: w.missing.length === 0 ? 'unusable' : `missing ${w.missing.join(', ')}`,
      onClick: () => {},
    })),
  ];

  return (
    <div className="w-doors">
      <section className="w-card">
        <h3>Sign in with Google</h3>
        <p>
          Sign in the way you would anywhere else and you get a Sui address of your own. No seed
          phrase to write down, nothing to install. Google never learns the address, and the chain
          never learns the Google account. The technique is called zkLogin: a salt held on our
          server, a proof made by a prover, both named in the docs.
        </p>
        <button
          type="button"
          className="w-btn w-btn--primary"
          disabled={!ready}
          onClick={() => void signInWithGoogle(returnTo)}
        >
          Continue with Google
        </button>
      </section>

      <section className="w-card">
        <h3>Connect a Sui wallet</h3>
        <p>Already keep your own keys? Connect directly over the Wallet Standard.</p>
        {!ready ? (
          <p className="w-card__note">Looking for wallets in this browser…</p>
        ) : wallets.length === 0 ? (
          <p className="w-card__note">
            No Sui wallet in this browser. On a phone, open weir.social inside your wallet
            app&rsquo;s own browser — Slush and Phantom both have one. On a computer, install one
            and reload.
          </p>
        ) : (
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
        )}
      </section>
    </div>
  );
}
