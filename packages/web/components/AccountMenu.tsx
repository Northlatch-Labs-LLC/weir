'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude

/**
 * The account menu.
 *
 * # Why a menu and not a button
 *
 * The header previously carried the whole `SignIn` panel — a heading, two ways in, and a paragraph
 * explaining what a Google sign-in does to your custody. That is the right content for a page and
 * the wrong content for a header bar, and dropping it into one is what made the control look
 * stranded rather than placed.
 *
 * So the header gets a control and the explanation gets a page (`/signin`). Signed in, this becomes
 * the menu every account-bearing surface hangs off — the thing the application did not have. Ten
 * routes existed in the rail with no way to tell, from the top of the screen, whose they were.
 *
 * # This is also how recovery became reachable
 *
 * `AccountRecovery` existed for weeks and was rendered by nothing but its own test. The component
 * argues in its own header that an escape hatch nobody can reach is not an escape hatch; it was
 * right, and it was describing itself. A signed-in menu is the first surface where it belongs.
 *
 * # Built by hand rather than from a library
 *
 * A menu button is four behaviours — Escape closes, pointer-outside closes, focus returns to the
 * trigger, arrows move between items — and each is a few lines here. Taking a dependency for that
 * adds a bundle and a version to track in exchange for code that fits on one screen.
 *
 * The rules come from the ARIA authoring practices, and they are not decoration: a dropdown that
 * leaves focus on a hidden element after closing is unusable by keyboard, and invisible as a bug to
 * everyone who does not navigate that way.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useSigner } from '@/components/SignerProvider';
import { WalletConnect } from '@/components/WalletConnect';

/**
 * What belongs to *you*, as opposed to where you can go.
 *
 * These overlap the rail deliberately. The rail is navigation; this is possession, and somebody
 * looking for their own earnings looks under their own name before they scan a list of ten links.
 */
const MINE = [
  { href: '/purchases', label: 'Purchases' },
  /*
    Names live here rather than in the header, because a .sui name is a thing this address owns —
    the same category as what it has bought and who it referred. It replaced the standalone
    registrar at `suins.protocolx.io`, now retired, which nobody would find from a profile.
  */
  { href: '/names', label: 'Register your .sui name' },
  { href: '/referrals', label: 'Referrals' },
] as const;

/**
 * Offered only to somebody who owns a vault.
 *
 * These were listed for everybody, so a reader with no vault was invited into a studio that can
 * only tell them to open one, and an earnings page with nothing to report. A menu entry is a
 * promise that there is something at the other end of it.
 *
 * Derived from the chain rather than stored, exactly as the rail is. There is no creator role
 * anywhere, and adding one here would be a second answer to a question the chain already settles.
 */
const CREATOR_ITEMS = [
  { href: '/creator', label: 'Creator studio' },
  { href: '/earnings', label: 'Earnings' },
] as const;

export function AccountMenu() {
  const pathname = usePathname();
  const { signer, signOut, reopenAccountChoice, reauthorizeWallet } = useSigner();
  const [open, setOpen] = useState(false);
  /**
   * The handle this address holds on chain.
   *
   * Three states, and the third is the point: `undefined` means not looked up yet, `null` means the
   * chain was read and this address holds no account. Collapsing them would tell a registered
   * creator they have no account for as long as the request takes — on the one control that is
   * supposed to know who they are.
   *
   * The lookup is not new. `/join` has called it since it was written and used the answer to say
   * "there is nothing to do here" — knowing the handle and offering no way to reach it. This is the
   * same call, put where somebody would actually look for their own page.
   */
  const [handle, setHandle] = useState<string | null | undefined>(undefined);
  /** Whether this address owns a vault. `undefined` until the chain answers, and on a failure. */
  const [stage, setStage] = useState<'no-account' | 'no-vault' | 'ready' | undefined>(undefined);
  /**
   * The `.sui` name this address answers to, if it has set one.
   *
   * `null` means asked and there is none — most addresses — and renders as the plain address.
   * `undefined` means not asked yet or the lookup failed, which renders the same way but leaves
   * the possibility open on the next read. Neither is an error worth showing somebody.
   */
  const [suiName, setSuiName] = useState<string | null | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemsRef = useRef<(HTMLAnchorElement | HTMLButtonElement | null)[]>([]);

  /**
   * Nothing until mounted.
   *
   * `signer` is rebuilt in the browser from storage and from `/api/zklogin/session`, so the server
   * always renders the signed-out branch. Without this gate the first paint tells a signed-in
   * person to sign in, and React then swaps it — which reads as the session dropping and returning
   * on every single navigation.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  /*
    Keyed on the address, not the signer object. Switching account in the wallet changes who this
    is, and the previous address's handle is not an answer about this one — it would leave somebody
    looking at a menu offering a page that belongs to a different account of theirs.
  */
  useEffect(() => {
    const address = signer?.address;
    if (address === undefined) {
      setHandle(undefined);
      setStage(undefined);
      setSuiName(undefined);
      return;
    }
    let cancelled = false;
    setHandle(undefined);
    setStage(undefined);
    setSuiName(undefined);

    /*
      One request for both facts.

      `/api/creator` answers with the handle *and* how far along this address is, so calling
      `/api/account` as well would be a second round trip for something already in the reply — and
      two sources for one answer eventually disagree.
    */
    /*
      The name every other Sui application shows. Asked separately from the creator stage: it is a
      different question of a different registry, and a failure in one must not blank the other.
    */
    void fetch(`/api/names/reverse?address=${encodeURIComponent(address)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { name?: string | null } | null) => {
        if (cancelled || body === null || body.name === undefined) return;
        setSuiName(body.name);
      })
      .catch(() => undefined);

    void fetch(`/api/creator?owner=${encodeURIComponent(address)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { stage?: 'no-account' | 'no-vault' | 'ready'; handle?: string } | null) => {
        if (cancelled || body?.stage === undefined) return;
        setStage(body.stage);
        // `no-account` carries no handle, and that is a measured "none" rather than a failed look.
        setHandle(body.stage === 'no-account' ? null : (body.handle ?? null));
      })
      // A failed read leaves both `undefined`. "We could not look" is not "you have nothing", and
      // only one of those should hide somebody's own page from them.
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [signer?.address]);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    // Focus has to go somewhere deliberate. Left on a node that is about to unmount, the browser
    // drops it to `body`, and the reader's next Tab restarts from the top of the document.
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') close(true);
      // Tab moves focus on regardless — this is a menu button, not a modal, so nothing should trap
      // it. Left unhandled the popup stayed open and visible while focus walked past it onto the
      // rest of the page, which is its own confusion for a sighted keyboard user and a stale
      // `aria-expanded="true"` for anyone on a screen reader. `close(false)`, not `close(true)`:
      // focus is already headed somewhere on purpose and must not be dragged back to the trigger.
      else if (event.key === 'Tab') close(false);
    }
    // `pointerdown`, not `click`: closing on click can beat a link's own navigation to the event
    // loop, so the menu closes and the reader stays exactly where they were.
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    }

    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, close]);

  // Opening moves focus to the first item. Without this the menu is openable by keyboard and then
  // unreachable, which is worse than not having it.
  useEffect(() => {
    if (open) itemsRef.current[0]?.focus();
  }, [open]);

  function onMenuKeyDown(event: React.KeyboardEvent) {
    const items = itemsRef.current.filter(
      (node): node is HTMLAnchorElement | HTMLButtonElement => node !== null,
    );
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLAnchorElement | HTMLButtonElement);

    const go = (index: number) => {
      event.preventDefault();
      items[index]?.focus();
    };
    if (event.key === 'ArrowDown') go((at + 1) % items.length);
    else if (event.key === 'ArrowUp') go((at - 1 + items.length) % items.length);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(items.length - 1);
  }

  // A same-sized placeholder, so the header does not jump when the real control arrives.
  if (!mounted) return <div className="account-slot" aria-hidden />;

  if (signer === null) {
    /*
      Signing in, from the header itself.

      This was a link to `/signin`, so the most common action on the site cost a page load before
      anything happened. Google is offered directly here because it is the path somebody without a
      wallet takes, and it needs no extension, no prompt to install anything and no second screen.

      The link stays beside it, quieter, for the wallet paths and the explanation. Those genuinely
      need a page: the trade-offs of a Google-derived address are a paragraph, and a paragraph does
      not belong in a header.

      `next` is carried so signing in returns the reader to what they were looking at, guarded
      against pointing at itself — which would survive the round trip and land somebody back on the
      sign-in page having just signed in.
    */
    /*
      The wallet path, from the header.

      One wallet installed is the common case, and it connects here directly — the extension is the
      only thing that needs to open, and sending somebody to a page first to press the same button
      is a page load for nothing.

      Several wallets is a choice, and a header is the wrong place to make it: the names are what
      distinguish them and they need room. That goes to `/signin`, where they are listed with the
      Google alternative and the trade-offs written out.

      None installed also goes there, because the useful thing to say — which wallets work, and
      that Google needs no extension at all — is a paragraph.
    */
    /*
      Every installed wallet gets a button that connects it.

      This was one button that connected when exactly one wallet was installed and became a *link*
      to `/signin` otherwise — so somebody with both Slush and Phantom pressed it and was navigated
      rather than connected. It read as broken because, for that person, it was: the control did
      nothing a connect button is for.

      Listing them is the honest shape. A site cannot choose between somebody's wallets, and the
      names are short enough to sit in a header when there are two or three of them.
    */
    return (
      <div className="account-slot account-signin__group">
        <WalletConnect />
      </div>
    );
  }

  // Index the refs by hand: the recovery entry is conditional, so a fixed offset for "sign out"
  // would leave a null hole in the middle of the list for wallet users and break arrow movement.
  let cursor = 0;
  const nextIndex = () => cursor++;

  return (
    <div className="account-slot account-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="account-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        {/* Derived from the address, so it is stable per account with no image to store or lose. */}
        <span className="avatar avatar--sm" aria-hidden>
          {signer.address.slice(2, 4)}
        </span>
        <span className="account-trigger__id">
          <span className="account-trigger__kind">{signer.label}</span>
          {/*
            The name, when there is one. A `.sui` name is how somebody recognises their own address
            at a glance; a truncated hex string is how they fail to, and it is what every other Sui
            application replaces here.
          */}
          <span className="mono account-trigger__addr">
            {typeof suiName === 'string'
              ? suiName
              : `${signer.address.slice(0, 6)}…${signer.address.slice(-4)}`}
          </span>
        </span>
        <svg className="account-chevron" viewBox="0 0 24 24" aria-hidden>
          <path
            d="m6 9 6 6 6-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div
          className="account-pop"
          role="menu"
          aria-label="Account menu"
          onKeyDown={onMenuKeyDown}
        >
          <div className="account-pop__head">
            <span className="k">Signed in with {signer.label}</span>
            {typeof suiName === 'string' && (
              <span className="account-pop__name">{suiName}</span>
            )}
            {/*
              The address in full, always, even when a name is shown above it. The name is a label
              somebody chose; the address is the thing that holds the money and the only one that
              can be checked against an explorer.
            */}
            <span className="mono account-pop__addr">{signer.address}</span>
          </div>

          {/*
            Your own page, first.

            Rendered only once the chain has answered with a handle. While the lookup is in flight,
            or when this address genuinely holds no account, there is nothing here rather than a
            link to `/c/undefined` — which is what a naive version produces and what somebody would
            reasonably report as the site losing their profile.
          */}
          {typeof handle === 'string' &&
            (() => {
              const index = nextIndex();
              return (
                <Link
                  role="menuitem"
                  href={`/c/${handle}?reader=${signer.address}`}
                  className="account-pop__item"
                  ref={(node) => {
                    itemsRef.current[index] = node;
                  }}
                  onClick={() => close(false)}
                >
                  My page — @{handle}
                </Link>
              );
            })()}

          {/*
            Yours first, then the creator tools if this address owns a vault. The order matters: the
            entries everybody has stay in the same place whether or not somebody is a creator, so
            opening a first vault adds to the menu rather than rearranging it.
          */}
          {[...MINE, ...(stage === 'ready' ? CREATOR_ITEMS : [])].map((item) => {
            const index = nextIndex();
            return (
              <Link
                key={item.href}
                role="menuitem"
                href={item.href}
                className="account-pop__item"
                aria-current={pathname === item.href ? 'page' : undefined}
                ref={(node) => {
                  itemsRef.current[index] = node;
                }}
                onClick={() => close(false)}
              >
                {item.label}
              </Link>
            );
          })}

          {/*
            Recovery is set apart because it is the only entry that reveals a secret. Sitting in the
            same group as "Purchases" it gets opened by somebody merely scanning the list, and the
            salt ends up on screen during a screen-share for no reason anybody chose.

            Wallet users never see it: they have no salt and never depended on this deployment, so
            offering them recovery would imply a risk they do not carry.
          */}
          {signer.kind === 'zklogin' &&
            (() => {
              const index = nextIndex();
              return (
                <Link
                  role="menuitem"
                  href="/account/recovery"
                  className="account-pop__item account-pop__item--warn"
                  ref={(node) => {
                    itemsRef.current[index] = node;
                  }}
                  onClick={() => close(false)}
                >
                  Recovery details
                </Link>
              );
            })()}

          {/*
            Switching address, which had no entry anywhere once connected.

            `WalletConnect` owns the picker and was mounted only in the signed-out branch below, so
            a connected reader had nothing that could render a choice — the button that used to do
            this on the join page disappeared when connecting stopped rendering `SignIn`. Both ways
            out are offered because they answer different questions: reopening lists the addresses
            the wallet already authorised, while reauthorising is the only route out of "my other
            address is not in that list", since only the extension can authorise one.
          */}
          {(() => {
            const index = nextIndex();
            return (
              <button
                type="button"
                role="menuitem"
                className="account-pop__item"
                ref={(node) => {
                  itemsRef.current[index] = node;
                }}
                onClick={() => {
                  reopenAccountChoice();
                  close(true);
                }}
              >
                Use a different address
              </button>
            );
          })()}

          {(() => {
            const index = nextIndex();
            return (
              <button
                type="button"
                role="menuitem"
                className="account-pop__item"
                ref={(node) => {
                  itemsRef.current[index] = node;
                }}
                onClick={() => {
                  void reauthorizeWallet();
                  close(true);
                }}
              >
                Reconnect wallet
              </button>
            );
          })()}

          {(() => {
            const index = nextIndex();
            return (
              <button
                type="button"
                role="menuitem"
                className="account-pop__item account-pop__item--danger"
                ref={(node) => {
                  itemsRef.current[index] = node;
                }}
                onClick={() => {
                  signOut();
                  close(true);
                }}
              >
                Sign out
              </button>
            );
          })()}
        </div>
      )}

      {/*
        Mounted while connected, and it renders nothing here until there is a choice to make: its
        trigger button belongs to the signed-out state and the window is portalled to the body.
        Without this the two items above set a pending choice that nothing on the page could draw,
        which is precisely the state that made switching address impossible.
      */}
      <WalletConnect />
    </div>
  );
}

