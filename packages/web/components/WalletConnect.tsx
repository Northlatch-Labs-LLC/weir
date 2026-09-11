'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Dialog } from '@projectx-social/ui';
import { useSigner } from '@/components/SignerProvider';

export function WalletConnect({
  triggerClassName = 'btn account-connect',
  triggerLabel,
}: {
  triggerClassName?: string | undefined;
  triggerLabel?: ReactNode;
} = {}) {
  const {
    wallets,
    unusableWallets,
    connectWallet,
    accountChoice,
    chooseAccount,
    cancelAccountChoice,
    signer,
    proof,
    proveSession,
    error,
  } = useSigner();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const unconfirmed = signer !== null && (proof === 'unproved' || proof === 'declined');
  const confirming = proof === 'checking';

  const close = () => {
    if (confirming) return;
    setOpen(false);
    cancelAccountChoice();
  };

  useEffect(() => {
    if (signer !== null && accountChoice === null && proof === 'proved') setOpen(false);
  }, [signer, accountChoice, proof]);

  useEffect(() => {
    if (accountChoice !== null) setOpen(true);
  }, [accountChoice]);

  return (
    <>
      {(signer === null || unconfirmed) && (
        <button
          type="button"
          className={triggerClassName}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          {signer !== null ? (
            'Confirm account'
          ) : (
            triggerLabel ?? (
              <>
                <span className="account-signin__label">Connect&nbsp;</span>wallet
              </>
            )
          )}
        </button>
      )}

      {open && mounted && (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next) close();
          }}
          title={
            unconfirmed || confirming
              ? 'Confirm this account'
              : accountChoice === null
                ? 'Connect a wallet'
                : `Which ${accountChoice.wallet.name} address should this site use?`
          }
          busy={confirming}
          width={440}
        >
          {unconfirmed || confirming ? (
            <>
              <p className="wc-note">
                Your wallet is connected. One signature confirms the account is yours — it costs
                nothing and sends no transaction. Until then, anything you have already paid for
                stays locked.
              </p>
              {proof === 'declined' && (
                <p className="wc-error">
                  That signature was not completed. Nothing was sent and nothing was spent.
                </p>
              )}
              {error !== null && <p className="wc-error">{error}</p>}
              <div className="wc-actions">
                <button
                  type="button"
                  className="w-btn w-btn--primary wc-actions__wide"
                  disabled={confirming}
                  onClick={() => void proveSession()}
                >
                  {confirming ? 'Waiting for your wallet…' : 'Sign to confirm'}
                </button>
              </div>
            </>
          ) : accountChoice === null ? (
            <>
              {wallets.length === 0 ? (
                <p className="wc-note">
                  No Sui wallet in this browser. On a phone, open weir.social inside your wallet
                  app&rsquo;s own browser — Slush and Phantom both have one. On a computer, install
                  one and reload.
                </p>
              ) : (
                <div className="wc-list">
                  {wallets.map((wallet) => (
                    <button
                      key={wallet.name}
                      className="wc-wallet"
                      type="button"
                      onClick={() => void connectWallet(wallet)}
                    >
                      {wallet.icon !== undefined && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          className="wc-wallet__icon"
                          src={wallet.icon}
                          alt=""
                          width={28}
                          height={28}
                        />
                      )}
                      <span className="wc-wallet__name">{wallet.name}</span>
                    </button>
                  ))}
                </div>
              )}

              {unusableWallets.map((wallet) => (
                <p className="wc-note" key={wallet.name}>
                  {wallet.name} is out of date — it cannot {wallet.missing.join(' or ')}. Update
                  the extension and reload.
                </p>
              ))}

              {error !== null && <p className="wc-error">{error}</p>}

              <p className="wc-foot">
                No wallet?{' '}
                <Link
                  href={
                    pathname === '/signin'
                      ? '/signin'
                      : `/signin?next=${encodeURIComponent(pathname)}`
                  }
                  onClick={() => setOpen(false)}
                >
                  Continue with Google
                </Link>
              </p>
            </>
          ) : (
            <div className="wc-list">
              {accountChoice.accounts.map((account) => (
                <button
                  key={account.address}
                  className="wc-account"
                  type="button"
                  onClick={() => chooseAccount(account)}
                >
                  {account.label !== undefined && (
                    <span className="wc-account__label">{account.label}</span>
                  )}
                  <span className="mono wc-account__addr">{account.address}</span>
                </button>
              ))}
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}