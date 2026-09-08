'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * The header every route wears.
 *
 * # This is the ported design's header
 *
 * Three destinations in the bar, everything else behind three named groups, and one filled slot on
 * the right that is `Join` for a guest and `Compose` for a member. The shape is the ported design's
 * and the reasoning is in `lib/site-map.ts`.
 *
 * # What is production's and stays
 *
 * `AccountMenu` — the wallet dialog, the multi-address picker, focus handling and sign-out. The
 * ported design had a connect control of its own that spoke to fixtures; this one reaches a wallet.
 *
 * The `gated` branch, and `aria-current` on the section you are in.
 *
 * # Who is signed in
 *
 * `signedIn` and `myHandle` come from the shell, which read a *proved* session. A failed read passes
 * `false`, so the header renders as a guest: showing guest chrome to a member is a small indignity,
 * and showing member chrome to somebody we could not identify is a leak.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AccountMenu } from '@/components/AccountMenu';
import { Icon } from '@/components/design/icons';
import { useTheme } from '@/components/design/use-theme';
import {
  GROUPS,
  GUEST_GROUPS,
  GUEST_IN_BAR,
  IN_BAR,
  PRIMARY,
  forViewer,
  primaryFor,
} from '@/lib/site-map';

export function WeirMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="sh-mark" aria-hidden>
      <path d="M 0.356 9.1 A 12 12 0 1 0 23.644 9.1 Z" fill="currentColor" />
      <line x1="5" y1="7.5" x2="19" y2="7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="7" y1="5" x2="17" y2="5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.85" />
      <line x1="9" y1="2.5" x2="15" y2="2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.65" />
    </svg>
  );
}

export function SiteHeader({
  signedIn,
  myHandle,
  gated = false,
}: {
  signedIn: boolean;
  myHandle: string | null;
  /** The front door is shut: the destinations give way to the one way in. */
  gated?: boolean;
}) {
  const pathname = usePathname() ?? '/';
  const here = primaryFor(pathname);
  const { theme, toggle, label: themeLabel } = useTheme();
  const themeIcon = theme === null ? null : <Icon name={theme === 'day' ? 'moon' : 'sun'} size={16} />;

  const [open, setOpen] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);

  // A click outside closes the open group; Escape closes either panel.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (navRef.current !== null && !navRef.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(null);
        setMenuOpen(false);
      }
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  // Navigating closes both. Without this a panel survives the route change.
  useEffect(() => {
    setOpen(null);
    setMenuOpen(false);
  }, [pathname]);

  /*
    Two navigations, not one navigation with things hidden.

    A guest is offered what there is to read and one explanation of the place. A member is offered
    the rooms they keep things in. Hiding rows out of the member's menu would leave a guest looking
    at "Money" with two entries in it, which reads as a product they are half locked out of rather
    than as a product they have not joined yet.
  */
  const bar = signedIn ? PRIMARY.filter((d) => IN_BAR.includes(d.href)) : GUEST_IN_BAR;
  const groups = (signedIn ? GROUPS : GUEST_GROUPS)
    .map((g) => ({ ...g, items: forViewer(g.items, signedIn) }))
    .filter((g) => g.items.length > 0);
  const active = (href: string) => here === href || pathname === href;

  return (
    <header className="sh-header">
      <div className="sh-header__row">
        <Link href="/" className="sh-logo" aria-label="Weir home">
          <span className="sh-logo__tile" aria-hidden>
            <WeirMark />
          </span>
          <span className="sh-logo__text">
            <span className="sh-logo__word">weir</span>
          </span>
        </Link>

        {!gated && (
          <div ref={navRef} className="sh-navwrap">
            <nav aria-label="Primary" className="sh-nav">
              {bar.map((d) => (
                <Link
                  key={d.href}
                  href={d.href}
                  className="sh-nav__link"
                  aria-current={here === d.href ? 'page' : undefined}
                >
                  <span>{d.label}</span>
                </Link>
              ))}

              {groups.map((g) => (
                <div key={g.key} className="sh-group">
                  <button
                    type="button"
                    className="sh-nav__link sh-group__button"
                    aria-expanded={open === g.key}
                    aria-controls={`sh-group-${g.key}`}
                    data-open={open === g.key ? '' : undefined}
                    onClick={() => setOpen((v) => (v === g.key ? null : g.key))}
                  >
                    <span>{g.label}</span>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                  {open === g.key && (
                    <div id={`sh-group-${g.key}`} className="sh-group__panel">
                      {g.items.map((d) => (
                        <Link
                          key={d.href}
                          href={d.href}
                          className="sh-group__link"
                          aria-current={active(d.href) ? 'page' : undefined}
                        >
                          <Icon name={d.icon} size={15} />
                          <span>
                            <span className="sh-group__label">{d.label}</span>
                            {d.blurb !== undefined && <span className="sh-group__blurb">{d.blurb}</span>}
                          </span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </nav>
          </div>
        )}

        <div className="sh-tools">
          {gated && <span className="sh-badge">closed alpha</span>}

          <button
            type="button"
            className="sh-iconbtn sh-theme"
            onClick={toggle}
            aria-label={themeLabel}
            title={themeLabel}
          >
            {themeIcon}
          </button>

          {signedIn && (
            <Link
              href="/alerts"
              className="sh-iconbtn sh-bell"
              aria-label="Alerts"
              title="Alerts"
              aria-current={pathname === '/alerts' ? 'page' : undefined}
            >
              <Icon name="bell" size={17} />
            </Link>
          )}

          {/*
            The filled slot belongs to members.

            Signed out it was "Join", which led to a page *about* joining — a button that reads as
            an action and delivers an explanation. Two controls stood next to each other offering
            the same thing, and the one that actually signs somebody in is the wallet control to its
            right. So the guest's slot is empty and the account control is the single way in.

            Signed in, the slot is the thing a member came to do.
          */}
          {!gated && signedIn && (
            <Link href="/studio" className="sh-cta">
              <Icon name="doc" size={15} />
              <span>Compose</span>
            </Link>
          )}

          {!gated && (
            <button
              type="button"
              className="sh-iconbtn sh-burger"
              aria-expanded={menuOpen}
              aria-controls="sh-menu"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" aria-hidden>
                {menuOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
              </svg>
            </button>
          )}

          {/*
            The account control, and the only one there is. It carries the wallet dialog, the
            multi-address picker, focus handling and sign-out, so it is mounted rather than redrawn.
          */}
          <div className="sh-account weir-account">
            <AccountMenu />
          </div>
        </div>
      </div>

      {/* The whole map, on anything narrower than the bar can hold. Grouped, never a flat list. */}
      {menuOpen && !gated && (
        <div id="sh-menu" className="sh-menu__sheet">
          <nav aria-label="All destinations">
            {bar.map((d) => (
              <Link
                key={d.href}
                href={d.href}
                className="sh-sheet__link"
                aria-current={here === d.href ? 'page' : undefined}
              >
                <Icon name={d.icon} size={16} />
                <span>{d.label}</span>
              </Link>
            ))}
            {groups.map((g) => (
              <div key={g.key} className="sh-sheet__group">
                <p className="sh-sheet__head">{g.label}</p>
                {g.items.map((d) => (
                  <Link
                    key={d.href}
                    href={d.href}
                    className="sh-sheet__link"
                    aria-current={active(d.href) ? 'page' : undefined}
                  >
                    <Icon name={d.icon} size={16} />
                    <span>{d.label}</span>
                  </Link>
                ))}
              </div>
            ))}
            {signedIn && myHandle !== null && (
              <Link href={`/c/${myHandle}`} className="sh-sheet__link">
                <Icon name="name" size={16} />
                <span>@{myHandle}</span>
              </Link>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
