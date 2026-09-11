'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

/**
 * The way in.
 *
 * # Google is not here, and that is deliberate
 *
 * `Continue with Google` lives in the header, on every screen. It was in both places at once, which
 * put the same button twice on the sign-in page — and a choice offered twice reads as two different
 * choices. This component is the wallet half: the paths that need an extension, and the trade-offs
 * worth stating in prose.
 *
 * # What the user is told before they choose
 *
 * That a Google sign-in creates a real Sui address, that this deployment can work out which address
 * belongs to which Google account, and that it cannot spend from it. Those are the true trade-offs
 * and they belong in the interface rather than in a document nobody opens — a person handing over
 * money is owed the actual shape of what they are agreeing to.
 */

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useSigner } from '@/components/SignerProvider';

/**
 * `compact` is for inline prompts — a comment row, a follow button — where the full panel would
 * dominate the thing it sits next to. It drops the explanation, never the choice: both ways in are
 * still offered, because a compact control that silently supported only one of them would decide
 * for the user based on where they happened to be standing.
 */
export function SignIn({
  compact = false,
  returnTo,
}: { compact?: boolean; returnTo?: string } = {}) {
  const pathname = usePathname();
  /*
    Where Google sends the reader back to. Defaults to where they are standing, which is right for
    the inline prompts; `/signin` passes the `next` it was given, so signing in successfully does
    not return somebody to the sign-in page.
  */
  const destination = returnTo ?? pathname;
  const { signer, wallets, unusableWallets, session, accountChoice, walletAccounts, chooseAccount, cancelAccountChoice, reopenAccountChoice, signInWithGoogle, reauthorizeWallet, connectWallet, signOut, error } = useSigner();

  /**
   * Everything this renders depends on things that exist only in a browser: installed wallets, and
   * an answer from `/api/zklogin/session`. On the server both are empty, so the markup React
   * produced during SSR ("no way to sign in here") never matched what the client produced a moment
   * later, and React discarded and re-rendered the whole subtree on every page load.
   *
   * Rendering nothing until mounted makes the two passes agree by construction. The alternative —
   * guessing on the server what the browser will have — is guaranteed wrong for anyone whose wallet
   * set differs from the guess, which is everyone.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className={compact ? 'signin signin--compact' : 'signin'} />;

  /*
    A wallet holding several addresses, asking which one this session is for.

    It replaces the panel rather than sitting under it. The reader has already answered "which
    wallet"; leaving that list on screen invites re-answering it and makes the open question the
    second thing on the page instead of the only thing.

    The choice is offered in the compact variant too. `compact` drops the explanation, never the
    choice — and a compact control that picked an address on the reader's behalf, because they
    happened to be standing next to a comment box, is precisely the defect this replaces.
  */
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
              {/*
                The wallet's own name for the address when it gave one, and nothing at all when it
                did not. An invented "Account 2" is a label nobody chose, sitting next to the one
                thing on this screen that has to be checked character by character.
              */}
              {account.label !== undefined && (
                <span className="signin-account__label">{account.label}</span>
              )}
              {/*
                In full. A picker is the one place truncation cannot be tolerated: two addresses
                abbreviated to the same six characters are the same button, and choosing between
                them is choosing blind.
              */}
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

      {/*
        A deployment that does not offer Google says nothing about Google.
      */}

      {/*
        The wallet paths. Google is in the header and not repeated here — the same button in two
        places on one screen reads as two different offers.
      */}
      {(session?.available === true || wallets.length > 0) && (
        <div className="signin-wallets">
          {!compact && <span className="signin-or">choose how you sign in</span>}

          {/*
            Google first. Somebody who has never held a private key should reach what they came for
            without learning what one is — that ordering is the product decision this whole feature
            exists to make, and it is why this button is the prominent one here.

            The header offers the wallet path instead, so the two are never the same button twice on
            one screen.
          */}
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

          {/*
            Disabled until the session has answered, and that is a correctness gate rather than a
            nicety. `bindAccount` THROWS "still reading this deployment's network" when `session`
            is null, because the chain to bind to comes from the server's configuration and there
            is nothing safe to guess. So between first paint and that answer this button was live
            and every click on it failed — the wallet connected, the binding did not happen, and
            the reader was left signed out with an error naming an internal state.

            The Google button above has always been gated this way (`session?.available === true`).
            This one was not, and the asymmetry is the whole bug.

            Found as an "intermittent" test: wallet-accounts.test.tsx failed once in CI and passed
            on a re-run of the identical tree. It is not intermittent. Delaying the session fetch
            by 25ms in that suite fails 14 of its cases every time — CI was simply slow enough,
            once, to land inside a window that is always there.
          */}
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

      {/*
        One line, below the choice rather than attached to either option.

        This was a four-sentence explanation of zkLogin custody. It was accurate and nobody
        deciding whether to join reads it — the mechanism belongs on a page somebody opens on
        purpose. What survives is the only part that changes their decision: we cannot spend your
        money. The rest is at /join.
      */}
      {!compact && session?.available === true && (
        <p className="signin-note">
          Either way, the address is <strong>yours</strong> — the keys are held by you, not here.
        </p>
      )}

      {/*
        A wallet we found and cannot offer.

        Previously these were filtered out and forgotten, so somebody with Phantom or Slush already
        installed saw an empty space and reasonably concluded we had not implemented their wallet.
        Naming it, and naming what it is missing, is the difference between a dead end and a fact
        they can act on — usually by updating the extension.
      */}
      {!compact &&
        unusableWallets.map((wallet) => (
          <p className="unmeasured" key={wallet.name}>
            {wallet.name} is out of date — it cannot {wallet.missing.join(' or ')}. Update the
            extension and reload.
          </p>
        ))}

      {/*
        No wallet found, and none rejected either.
      */}
      {/*
        The compact form has to answer this too, and used to get its answer from the "nothing at
        all is available" line that sat below. That line named Google and has gone, so without a
        branch here a compact prompt with no wallet and no Google renders an empty box — the exact
        silent nothing this component was fixed once before for producing.
      */}
      {wallets.length === 0 && unusableWallets.length === 0 && (
        compact ? (
          <p className="signin-note" style={{ margin: 0 }}>
            A Sui wallet is needed to sign in — Slush or Phantom.
          </p>
        ) : (
          <div className="signin-wallets">
            {/*
              "or" only when there is something to be an alternative to. With Google off a wallet is
              not one of two ways in, it is the way in, and a heading implying a missing sibling
              sends people looking for it.
            */}
            <span className="signin-or">
              {session?.available === true ? 'or use a wallet' : 'use a wallet'}
            </span>
            <p className="signin-note" style={{ margin: 0 }}>
              No Sui wallet in this browser. On a phone, open weir.social inside your wallet app&rsquo;s
              own browser — Slush and Phantom both have one. On a computer, install one and reload.
            </p>
            {/*
              Controls, because a sentence is not one — but the right controls in the right order.

              With Google unavailable and no wallet extension present this rendered a paragraph and
              nothing else, so `/join` had no button and no field anywhere on it. The first fix put
              "Get Slush" and "Get Phantom" here, and that was wrong in its own way: this component
              is mounted on eight signed-out pages, so every one of them suddenly led with "install
              a browser extension" as its primary action.

              Signing in comes first, because `/signin` offers whatever this deployment has — it is
              the page that knows — and installing an extension is what somebody does only when
              there is no other way. The installs stay, quiet, beneath it.

              Not shown on `/signin` itself, where it would be a link to the page you are reading.
            */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
              {/*
                The design system's buttons, not the legacy ones. `.btn ghost` renders mint-dim text
                over `.btn`'s own mint background — 1.2:1, measured — because `ghost` never resets
                the fill in this cascade. `.w-btn` is the current system and is checked at both
                widths.
              */}
              {/*
                Not on the two pages whose own chrome already offers it.

                `/signin` is this page, and on `/join` the public header carries a "Sign in" button
                sixteen pixels from the top — so the panel rendered a second one, same words, same
                destination, four hundred pixels below the first. On every other page there is no
                other way in from here, and it leads.
              */}
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

/**
 * What the wallet told us, stated on the page and kept there.
 *
 * # Why this is permanent and not debugging scaffolding
 *
 * Both Slush and Phantom bound one fixed address per wallet regardless of which account was selected
 * inside the extension. From the page there was no way to tell whether the wallet had shared only
 * that address or whether this application had received several and dropped the rest. Those are
 * opposite faults with opposite fixes, and the only place the answer exists is in what the wallet
 * returned — so the page says what the wallet returned.
 *
 * Anybody who cannot find their expected address here now knows which half to go and fix: an address
 * absent from this list was never shared, and the extension is where that is changed. That is a
 * standing need, not a need that ended when one bug was closed.
 *
 * # Two ways forward, because there are two different problems
 *
 * An address that is listed but not bound is ours to switch to. An address that is not listed at all
 * cannot be reached from this page at any price — only the wallet can widen what it shares.
 */
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
        {/* The count first, because it is the fact that settles which half is at fault. */}
        {wallet} reports {accounts.length} {accounts.length === 1 ? 'address' : 'addresses'} to this
        site
      </span>
      <ul className="signin-report__list">
        {accounts.map((account) => (
          <li key={account.address} className="signin-report__row">
            {/* In full. A truncated address cannot be compared against the one the extension is
                showing, and that comparison is the only reason this list exists. */}
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

/** Google's mark, inline. An external request here would be a third-party beacon on every page. */
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
