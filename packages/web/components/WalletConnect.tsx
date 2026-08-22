'use client';
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude

/**
 * # What was wrong with the row of buttons
 *
 * The header listed a button per installed wallet. `suins.protocolx.io`, `raffle.protocolx.io` and
 * `protocolx.io` all use dapp-kit's `<ConnectButton />`: a single control that opens a window
 * listing the wallets. Somebody moving between the properties met a different idea of connecting
 * on this one, which is the sort of difference that reads as this site being the broken one.
 *
 * # The bug the row of buttons was hiding
 *
 * `connectWallet` has two outcomes. A wallet authorising exactly one address binds it. A wallet
 * authorising several sets `accountChoice`, because picking on somebody's behalf is how an address
 * gets welded to a session nobody chose — and `SignIn` was the only component that rendered that
 * picker.
 *
 * So on the two routes carrying no sign-in panel anywhere on the page — the feed and `/explore` —
 * a wallet holding several addresses opened, was approved, and then nothing happened at all: the
 * picker had no host. A wallet holding one address bound immediately and looked fine. That is
 * exactly the reported shape — Slush failing where Phantom worked, on those two pages and nowhere
 * else.
 *
 * Putting the window in the header fixes that structurally rather than by adding a second copy of
 * the picker: the control that starts the flow now also finishes it, on every route.
 *
 * # Not dapp-kit itself
 *
 * The other properties get this window from `@mysten/dapp-kit`, whose `WalletProvider` owns the
 * connection. This application's `SignerProvider` also carries zkLogin sessions, the account choice
 * above and the signing seam, so adopting dapp-kit's provider would mean either two wallet stacks
 * in one application or rewriting the half that already works. The window is the part that was
 * wrong; it is small, and it is built here against the provider that exists.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSigner } from '@/components/SignerProvider';

export function WalletConnect() {
  const {
    wallets,
    unusableWallets,
    connectWallet,
    accountChoice,
    chooseAccount,
    cancelAccountChoice,
    signer,
    error,
  } = useSigner();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    cancelAccountChoice();
    triggerRef.current?.focus();
  }, [cancelAccountChoice]);

  /*
    Closes itself the moment there is a signer. The window's purpose is gone at that point, and one
    left open over a completed action is a second thing to dismiss for no reason.
  */
  useEffect(() => {
    /*
      …unless an address choice is pending. A connected reader asking to switch address is the one
      case where both are true at once, and closing on the signer alone slammed the picker shut the
      instant it opened — so switching address was impossible while signed in.
    */
    if (signer !== null && accountChoice === null) setOpen(false);
  }, [signer, accountChoice]);

  /*
    A wallet can hand back several addresses long after this window was dismissed — the reader
    approves inside the extension, which takes as long as it takes. Opening on `accountChoice`
    means the picker is never orphaned: it appears wherever the reader is, rather than being set on
    state that nothing on the page is rendering.
  */
  useEffect(() => {
    if (accountChoice !== null) setOpen(true);
  }, [accountChoice]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  // Focus moves into the window, or a keyboard reader is left standing on the page behind it.
  useEffect(() => {
    if (open) dialogRef.current?.querySelector('button')?.focus();
  }, [open, accountChoice]);

  return (
    <>
      {/*
        The trigger belongs to the signed-out state only. Mounted while connected as well, this
        component is the one place the address picker is implemented — the account menu renders it
        so that "use a different address" has something to open. A second "Connect wallet" button
        next to a connected address would be nonsense, so only the window comes along.
      */}
      {signer === null && (
        <button
          ref={triggerRef}
          type="button"
          className="btn account-connect"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <span className="account-signin__label">Connect&nbsp;</span>wallet
        </button>
      )}

      {/*
        The window is portalled to `document.body`, and that is load-bearing rather than tidiness.

        `.appbar` carries `backdrop-filter`, and a filtered ancestor becomes the containing block
        for `position: fixed` descendants — the same rule that applies to `transform` and `filter`.
        Rendered in place, this window's `inset: 0` therefore resolved against a 60px-tall header
        instead of the viewport: the modal opened inside the bar and was clipped out of sight. No
        z-index or inset value fixes that from within, because the geometry is already wrong by the
        time it is painted.

        Portalling escapes the header's containing block entirely, so the scrim covers the page it
        is actually modal over. React keeps the event and context tree intact through a portal, so
        `useSigner` and the Escape handler behave exactly as if it were still rendered here.
      */}
      {open && mounted && createPortal(
        <div className="wc-scrim" role="presentation" onClick={close}>
          {/*
            `stopPropagation` rather than a separate backdrop element: a click landing inside the
            window must not also count as a click outside it, and the two overlap.
          */}
          <div
            className="wc-panel"
            role="dialog"
            aria-modal="true"
            aria-label={accountChoice === null ? 'Connect a wallet' : 'Choose an address'}
            ref={dialogRef}
            onClick={(event) => event.stopPropagation()}
          >
            {accountChoice === null ? (
              <>
                <div className="wc-head">
                  <h2 className="wc-title">Connect a wallet</h2>
                  <button className="wc-close" type="button" aria-label="Close" onClick={close}>
                    ✕
                  </button>
                </div>

                {wallets.length === 0 ? (
                  <p className="wc-note">
                    No Sui wallet in this browser. On a phone, open weir.social inside your wallet app's own browser — Slush and Phantom both have one. On a computer, install one and reload.
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
                        {/*
                          The wallet's own icon, which it supplies as a data URI. A plain `img`
                          rather than `next/image`: the source is a string handed over by an
                          extension at runtime, not an asset in this build.
                        */}
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

                {/* Found and not offered, with the reason. Never silently dropped. */}
                {unusableWallets.map((wallet) => (
                  <p className="wc-note" key={wallet.name}>
                    {wallet.name} is out of date — it cannot {wallet.missing.join(' or ')}. Update
                    the extension and reload.
                  </p>
                ))}

                {/*
                  Verbatim, and never replaced with wording of our own. "User rejected the request"
                  is a different instruction to the reader than "connection failed", and only the
                  wallet knows which of the two happened. Until now this went nowhere on the two
                  routes with no sign-in panel.
                */}
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
              <>
                <div className="wc-head">
                  <h2 className="wc-title">
                    Which {accountChoice.wallet.name} address should this site use?
                  </h2>
                  <button className="wc-close" type="button" aria-label="Close" onClick={close}>
                    ✕
                  </button>
                </div>

                <div className="wc-list">
                  {accountChoice.accounts.map((account) => (
                    <button
                      key={account.address}
                      className="wc-account"
                      type="button"
                      onClick={() => chooseAccount(account)}
                    >
                      {/*
                        The wallet's own label when it gave one, and nothing when it did not. An
                        invented "Account 2" is a name nobody chose, sitting beside the one thing on
                        this screen that has to be checked character by character.
                      */}
                      {account.label !== undefined && (
                        <span className="wc-account__label">{account.label}</span>
                      )}
                      {/*
                        In full. Two addresses abbreviated to the same six characters are the same
                        button, and choosing between them is choosing blind.
                      */}
                      <span className="mono wc-account__addr">{account.address}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
