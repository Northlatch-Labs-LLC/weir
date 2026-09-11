'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

/**
 * # What was wrong with the row of buttons
 *
 * The header listed a button per installed wallet. `protocolx.io` uses one control that opens a
 * window listing the wallets — as did `suins.protocolx.io` before it was retired. Somebody moving
 * between the properties met a different idea of connecting on this one, which is the sort of
 * difference that reads as this site being the broken one.
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
 * # Connecting is not signing in, and this window now says so
 *
 * A wallet sharing an address grants nothing. What grants anything is a signature over the
 * read-content statement, which mints a session the server can answer as. That signature was asked
 * for once, silently, from an effect that ended in `catch {}` — so a reader who declined it, or
 * whose wallet errored, was left connected and unproved with no control anywhere that would ask
 * again. Their own paid posts rendered locked and the only recovery was to guess that reloading
 * might help.
 *
 * So the window has three states rather than two: choose a wallet, choose an address, and confirm
 * the account. The third is reached whenever a reader is connected without a session, and the
 * trigger stays on screen saying `Confirm account` rather than disappearing the moment an address
 * arrives.
 *
 * # Why the window is still ours
 *
 * The connection itself is `@mysten/dapp-kit-core`'s — `SignerProvider` holds its kit. What is not
 * the kit's is the account choice above and zkLogin sitting beside a wallet as an equal way to sign,
 * and both of those appear in this window. The kit ships its own connect modal; taking it would mean
 * either two windows that disagree about what "signed in" means, or losing the half that is this
 * product's.
 */

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Dialog } from '@projectx-social/ui';
import { useSigner } from '@/components/SignerProvider';

export function WalletConnect({
  triggerClassName = 'btn account-connect',
  triggerLabel,
}: {
  /**
   * The trigger's classes. The application frame wants the design's own button; the legacy header
   * wants the one it already had. Only the trigger differs — the window, the wallet list and the
   * address picker are the same code either way, which is the point of taking a class name rather
   * than growing a second copy of this component.
   */
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

  /** Connected, and the server does not have this address. The state that used to be invisible. */
  const unconfirmed = signer !== null && (proof === 'unproved' || proof === 'declined');
  const confirming = proof === 'checking';

  const close = () => {
    if (confirming) return;
    setOpen(false);
    cancelAccountChoice();
  };

  /*
    Closes itself once there is a signer the server has accepted.

    It used to close on `signer` alone, which is what made the missing confirmation invisible: the
    window vanished at the moment the address arrived, and the fact that no session had been proved
    had nowhere left to appear. Two exceptions, and both are states the reader is mid-way through:
    an address choice pending, and an account not yet confirmed.
  */
  useEffect(() => {
    if (signer !== null && accountChoice === null && proof === 'proved') setOpen(false);
  }, [signer, accountChoice, proof]);

  /*
    A wallet can hand back several addresses long after this window was dismissed — the reader
    approves inside the extension, which takes as long as it takes. Opening on `accountChoice`
    means the picker is never orphaned: it appears wherever the reader is, rather than being set on
    state that nothing on the page is rendering.
  */
  useEffect(() => {
    if (accountChoice !== null) setOpen(true);
  }, [accountChoice]);

  return (
    <>
      {/*
        The trigger, and the state it used to hide.

        This rendered only while `signer === null`, so the instant a wallet shared an address the
        control disappeared — including when the signature that actually signs you in had been
        declined. There was then nothing on any screen to press. A connected-but-unconfirmed reader
        now keeps a control, and it says what is left to do.
      */}
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

      {/*
        One window, on the shared `Dialog`.

        This used to be a hand-drawn portal: its own scrim, its own Escape listener, its own focus
        call, and `aria-modal="true"` declared over a page that `Tab` walked straight out of — a
        screen reader told the rest of the page was inert while it was fully reachable, which is
        worse than claiming nothing. The portal itself was load-bearing and still is: `.appbar`
        carries `backdrop-filter`, and a filtered ancestor becomes the containing block for
        `position: fixed`, so rendered in place this window's `inset: 0` resolved against a 60px
        header and opened inside the bar. `Dialog` portals to the body, traps focus, locks the
        background scroll and gives focus back — none of which this file has to remember any more.
      */}
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
            /*
              The state that had no screen.

              Connecting shares an address; it does not sign you in. The server decides what opens,
              and it will not answer as somebody who has not signed for it — so a reader stuck here
              saw their own paid posts locked with nothing to press. This is the thing to press.
            */
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
                wallet knows which of the two happened.
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
          )}
        </Dialog>
      )}
    </>
  );
}