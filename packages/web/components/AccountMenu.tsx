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
        <span className="avatar avatar--sm" aria-hidden>
          {signer.address.slice(2, 4)}
        </span>
        <span className="account-trigger__id">
          <span className="account-trigger__kind">{signer.label}</span>
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
            <span className="mono account-pop__addr">{signer.address}</span>
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

      <WalletConnect />
    </div>
  );
}
