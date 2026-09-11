'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useSigner } from '@/components/SignerProvider';
import { WalletConnect } from '@/components/WalletConnect';

const MINE = [
  { href: '/purchases', label: 'Purchases' },
  { href: '/names', label: 'Register your .sui name' },
  { href: '/referrals', label: 'Referrals' },
] as const;

const CREATOR_ITEMS = [
  { href: '/creator', label: 'Creator studio' },
  { href: '/earnings', label: 'Earnings' },
] as const;

export function AccountMenu() {
  const pathname = usePathname();
  const { signer, signOut, reopenAccountChoice, reauthorizeWallet, proof, proveSession } =
    useSigner();
  const [open, setOpen] = useState(false);
  const [handle, setHandle] = useState<string | null | undefined>(undefined);
  const [stage, setStage] = useState<'no-account' | 'no-vault' | 'ready' | undefined>(undefined);
  const [suiName, setSuiName] = useState<string | null | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemsRef = useRef<(HTMLAnchorElement | HTMLButtonElement | null)[]>([]);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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

  if (!mounted) return <div className="account-slot" aria-hidden />;

  if (signer === null) {
    return (
      <div className="account-slot account-signin__group">
        <WalletConnect />
      </div>
    );
  }

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
            {/*
              What this said before, and why it was wrong.

              It read "Signed in with Slush" the moment an extension shared an address, which is not
              what signing in is here — the server answers as nobody until a signature proves the
              address. So this menu could say "signed in" beside a page rendering the reader as a
              guest, on the same screen, and both were reporting honestly about different things.
              One of them had to stop guessing, and it is this one: the label now names the state
              the SERVER is in, because that is the one that decides what opens.
            */}
            <span className="k">
              {proof === 'proved'
                ? `Signed in with ${signer.label}`
                : proof === 'checking'
                  ? `Confirming your ${signer.label} account…`
                  : `${signer.label} connected — not confirmed`}
            </span>
            {typeof suiName === 'string' && (
              <span className="account-pop__name">{suiName}</span>
            )}
            {/*
              The address in full, always, even when a name is shown above it. The name is a label
              somebody chose; the address is the thing that holds the money and the only one that
              can be checked against an explorer.
            */}
            <span className="mono account-pop__addr">{signer.address}</span>
            {/*
              The way out of the state, in the place somebody looks when they think they are signed
              in and the site disagrees. Without this the only recovery was a page reload, which
              does not re-ask.
            */}
            {(proof === 'unproved' || proof === 'declined') && (
              <button
                type="button"
                className="account-pop__confirm"
                onClick={() => void proveSession()}
              >
                Confirm this account
              </button>
            )}
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
