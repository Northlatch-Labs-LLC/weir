'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useSigner } from '@/components/SignerProvider';

export function SignIn({
  compact = false,
  returnTo,
}: { compact?: boolean; returnTo?: string } = {}) {
  const pathname = usePathname();
  const destination = returnTo ?? pathname;
  const { signer, wallets, unusableWallets, session, accountChoice, walletAccounts, chooseAccount, cancelAccountChoice, reopenAccountChoice, signInWithGoogle, reauthorizeWallet, connectWallet, signOut, error } = useSigner();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className={compact ? 'signin signin--compact' : 'signin'} />;

  if (accountChoice !== null) {
    return (
      <div className={compact ? 'signin signin--compact' : 'signin'}>
        <span className="signin-or">
          Which {accountChoice.wallet.name} address should this site use?
        </span>
        <div className="signin-accounts">
          {accountChoice.accounts.map((account) => (
            <button
              key={account.address}
              className="btn ghost signin-account"
              type="button"
              onClick={() => chooseAccount(account)}
            >
              {account.label !== undefined && (
                <span className="signin-account__label">{account.label}</span>
              )}
              <span className="mono signin-account__addr">{account.address}</span>
            </button>
          ))}
        </div>
        <button className="btn ghost" type="button" onClick={cancelAccountChoice}>
          Cancel
        </button>
        {error !== null && <p className="unmeasured">{error}</p>}
      </div>
    );
  }

  if (signer !== null) {
    return (
      <div className={compact ? 'signin signin--compact' : 'signin'}>
        <div className="wallet-list">
          <span className="pill-kind">{signer.label}</span>
          <span className="mono" style={{ color: 'var(--text-tertiary)' }}>
            {signer.address.slice(0, 6)}…{signer.address.slice(-4)}
          </span>
          <button className="btn ghost" type="button" onClick={signOut}>
            Sign out
          </button>
        </div>
        {walletAccounts !== null && (
          <WalletAccountReport
            wallet={signer.label}
            accounts={walletAccounts}
            bound={signer.address}
            onReopen={reopenAccountChoice}
            onReauthorize={() => void reauthorizeWallet()}
          />
        )}
        {error !== null && <p className="unmeasured">{error}</p>}
      </div>
    );
  }

  return (
    <div className={compact ? 'signin signin--compact' : 'signin'}>

      {(session?.available === true || wallets.length > 0) && (
        <div className="signin-wallets">
          {!compact && <span className="signin-or">choose how you sign in</span>}

          {session?.available === true && (
            <button
              className="btn btn-google"
              type="button"
              onClick={() => void signInWithGoogle(destination)}
            >
              <GoogleMark />
              {compact ? 'Google' : 'Continue with Google'}
            </button>
          )}

          {wallets.map((wallet) => (
            <button
              key={wallet.name}
              className="btn"
              type="button"
              disabled={session === null}
              onClick={() => void connectWallet(wallet)}
            >
              {wallet.name}
            </button>
          ))}
        </div>
      )}

      {!compact && session?.available === true && (
        <p className="signin-note">
          Either way the address is <strong>yours</strong>, and the keys stay on your device.
        </p>
      )}

      {!compact &&
        unusableWallets.map((wallet) => (
          <p className="unmeasured" key={wallet.name}>
            {wallet.name} is out of date — it cannot {wallet.missing.join(' or ')}. Update the
            extension and reload.
          </p>
        ))}

      {wallets.length === 0 && unusableWallets.length === 0 && (
        compact ? (
          <p className="signin-note" style={{ margin: 0 }}>
            A Sui wallet is needed to sign in — Slush or Phantom.
          </p>
        ) : (
          <div className="signin-wallets">
            <span className="signin-or">
              {session?.available === true ? 'or use a wallet' : 'use a wallet'}
            </span>
            <p className="signin-note" style={{ margin: 0 }}>
              No Sui wallet in this browser. On a phone, open weir.social inside your wallet app&rsquo;s
              own browser — Slush and Phantom both have one. On a computer, install one and reload.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
              {pathname === '/signin' || pathname === '/join' ? null : (
                <a className="w-btn w-btn--primary w-btn--sm" href="/signin">
                  Sign in
                </a>
              )}
              <a
                className={pathname === '/signin' || pathname === '/join' ? 'w-btn w-btn--primary w-btn--sm' : 'w-btn w-btn--quiet w-btn--sm'}
                href="https://slush.app"
                target="_blank"
                rel="noreferrer noopener"
              >
                Get Slush
              </a>
              <a className="w-btn w-btn--quiet w-btn--sm" href="https://phantom.app/download" target="_blank" rel="noreferrer noopener">
                Get Phantom
              </a>
            </div>
          </div>
        )
      )}

      {error !== null && <p className="unmeasured">{error}</p>}
    </div>
  );
}

function WalletAccountReport({
  wallet,
  accounts,
  bound,
  onReopen,
  onReauthorize,
}: {
  wallet: string;
  accounts: readonly { address: string; label?: string }[];
  bound: string;
  onReopen: () => void;
  onReauthorize: () => void;
}) {
  return (
    <div className="signin-report">
      <span className="k">
        {wallet} reports {accounts.length} {accounts.length === 1 ? 'address' : 'addresses'} to this
        site
      </span>
      <ul className="signin-report__list">
        {accounts.map((account) => (
          <li key={account.address} className="signin-report__row">
            <span className="mono signin-report__addr">{account.address}</span>
            {account.label !== undefined && (
              <span className="signin-report__label">{account.label}</span>
            )}
            {account.address === bound && <span className="enc-tag">signing with this one</span>}
          </li>
        ))}
      </ul>
      <p className="signin-note" style={{ margin: 0 }}>
        This is everything {wallet} shares with this site. An address you expected but cannot see
        here was never shared — {wallet} decides that, and this page cannot.
      </p>
      <div className="signin-wallets">
        {accounts.length > 1 && (
          <button className="btn ghost" type="button" onClick={onReopen}>
            Use a different address
          </button>
        )}
        <button className="btn ghost" type="button" onClick={onReauthorize}>
          Ask {wallet} to share another address
        </button>
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" width="15" height="15" aria-hidden focusable="false">
      <path fill="#4285F4" d="M17.6 9.2c0-.6-.1-1.3-.2-1.9H9v3.5h4.8a4.1 4.1 0 0 1-1.8 2.7v2.2h2.9c1.7-1.6 2.7-3.9 2.7-6.5Z" />
      <path fill="#34A853" d="M9 18c2.4 0 4.5-.8 6-2.2l-2.9-2.2c-.8.5-1.8.9-3.1.9-2.4 0-4.4-1.6-5.1-3.8H.9v2.3A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.9 10.7a5.4 5.4 0 0 1 0-3.4V5H.9a9 9 0 0 0 0 8l3-2.3Z" />
      <path fill="#EA4335" d="M9 3.6c1.3 0 2.5.5 3.4 1.3l2.6-2.6A9 9 0 0 0 .9 5l3 2.3C4.6 5.2 6.6 3.6 9 3.6Z" />
    </svg>
  );
}
