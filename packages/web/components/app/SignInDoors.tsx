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
  const { ready, wallets: usable, unusableWallets, signInWithGoogle, connectWallet, error, connecting } = useSigner();

  // A usable wallet carries no status word: the button is the wallet, and pressing it connects.
  // Saying "detected" told the reader nothing they could act on, and put the word inside the
  // button's own text, so the control announced itself as "Slushdetected" to a screen reader and
  // to anything reading the page as text.
  const wallets = [
    ...usable.map((w) => ({ name: w.name, why: null, onClick: () => void connectWallet(w) })),
    ...unusableWallets.map((w) => ({
      name: w.name,
      why:
        w.missing.length === 0
          ? 'Not a Sui wallet'
          : `Cannot sign on Sui — no ${w.missing.join(', no ')}`,
      onClick: () => {},
    })),
  ];

  return (
    <div className="w-doors">
      <section className="w-card">
        <h3>Sign in with Google</h3>
        <p>Sign in the way you would anywhere else, and you get a Sui address of your own.</p>
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
          <div className="w-card__note">
            <p className="w-wallet-none__lead">No Sui wallet in this browser.</p>
            <p className="w-wallet-none__how">
              On a phone, open weir.social inside your wallet app&rsquo;s own browser. On a
              computer, install one and reload this page.
            </p>
            <p className="w-wallet-none__how">
              <a href="https://slush.app" target="_blank" rel="noreferrer noopener">Slush</a>
              {' · '}
              <a href="https://phantom.app/download" target="_blank" rel="noreferrer noopener">Phantom</a>
            </p>
          </div>
        ) : (
          <div className="w-wallets">
            {wallets.map((w, i) => (
              <button
                key={`${w.name}-${i}`}
                type="button"
                className="w-wallet"
                onClick={w.onClick}
                disabled={w.why !== null || connecting !== null}
              >
                <span className="w-wallet__mark" aria-hidden="true">
                  <Icon name="wallet" size={16} />
                </span>
                <span className="w-wallet__name">{w.name}</span>
                {w.why !== null ? <span className="w-wallet__state">{w.why}</span> : null}
                {connecting === w.name ? (
                  <span className="w-wallet__state">Check your wallet…</span>
                ) : null}
              </button>
            ))}
          </div>
        )}
        {error !== null ? (
          <p className="w-wallet-error" role="alert" data-wallet-error="true">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}
