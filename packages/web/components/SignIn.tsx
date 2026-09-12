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
  const { ready, signer, wallets, unusableWallets, session, accountChoice, walletAccounts, chooseAccount, cancelAccountChoice, reopenAccountChoice, reauthorizeWallet, signOut, error } = useSigner();

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

  /*
    One door. Every way in (Google through zkLogin, a Sui wallet) lives on /signin, and the reader
    comes back here afterwards. A second sign-in panel on this page was a second product. What
    stays is the honest note: nothing about Google until the server has said whether it is on
    offer, and where to get a wallet when this browser has none.
  */
  const next = `/signin?next=${encodeURIComponent(destination)}`;
  const onDoor = pathname === '/signin' || pathname === '/join';
  return (
    <div className={compact ? 'signin signin--compact' : 'signin'}>
      {ready && wallets.length === 0 && unusableWallets.length === 0 ? (
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
            <div className="w-actions w-actions--after">
              {pathname === '/signin' || pathname === '/join' ? null : (
                <a className="w-btn w-btn--primary w-btn--sm" href={next}>
                  Sign in
                </a>
              )}
              <a
                className={onDoor ? 'w-btn w-btn--primary w-btn--sm' : 'w-btn w-btn--quiet w-btn--sm'}
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
      ) : (
        <div className="signin-wallets">
          {onDoor ? null : (
            <a className="w-btn w-btn--primary w-btn--sm" href={next}>
              Sign in
            </a>
          )}
          {!compact && session?.available === true && (
            <p className="signin-note">
              Google, or a Sui wallet. Either way the address is <strong>yours</strong>, and the keys stay on your device.
            </p>
          )}
          {!compact && session?.available === false && <p className="signin-note">Sign in with your Sui wallet.</p>}
        </div>
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
