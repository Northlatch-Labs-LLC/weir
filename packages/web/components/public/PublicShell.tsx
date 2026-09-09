'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * The chrome for pages you read before you have an account.
 *
 * # Two shells, and why
 *
 * Every route wore the application frame. That is right for the product — the feed, a creator's
 * page, the vault, the studio — and wrong for everything somebody reads while deciding whether to
 * be here at all. `/security`, the agent pages, the legal pages, sign in and join were rendered
 * inside a navigation rail listing Vault, Studio, Messages and Alerts: eight rooms a visitor cannot
 * enter, answering "where am I" before anything has said what this place is.
 *
 * Worse, it was a dead end. The rail's mark links to `/feed`, so a visitor who clicked "How the
 * money works" on the front page had no route back to the front page, and the header they arrived
 * through — Creators, AI Agent Citizens, Sign in, Create account — was gone.
 *
 * So these pages wear the front door's header and footer instead. The mark goes home, the nav is
 * the nav they arrived through, and the way in is on screen the whole time.
 *
 * # The menu
 *
 * Under 834px the plain links are replaced by a button that opens them. Hiding them and leaving
 * two buttons is what the landing page did, and it left a phone visitor with no route to anything
 * the site says about itself.
 */

import { useState } from 'react';
import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Icon, WeirMark } from '@projectx-social/ui';

/*
  The public destinations.

  "How the money works" was in here and is not any more. No consumer platform puts a link about
  security, custody or transparency in its primary navigation — Patreon, Buy Me a Coffee, X and
  TikTok all put trust material in the footer, if anywhere — because a nav item answering "can I
  trust you with money" asks the visitor a question they had not asked yet. `/security` is in the
  footer, which is where somebody who wants it goes looking.

  What is left is what a visitor came for: the people, the agents, and a way to make an account.
*/
const PUBLIC_NAV: readonly { href: string; label: string }[] = [
  { href: '/creators', label: 'Creators' },
  { href: '/explore/agents', label: 'Agents' },
  { href: '/agents/build', label: 'Run an agent' },
];

export function PublicHeader() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <>
      <header className="w-land__bar">
        <NextLink href="/" className="w-land__brand" aria-label="Weir, home">
          <WeirMark />
          <span className="w-land__wordmark">weir</span>
        </NextLink>

        <div className="w-land__nav">
          {PUBLIC_NAV.map((item) => (
            <NextLink key={item.href} href={item.href} aria-current={pathname === item.href ? 'page' : undefined}>
              {item.label}
            </NextLink>
          ))}
          <span style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <NextLink href="/signin" className="w-btn w-btn--quiet">
              Sign in
            </NextLink>
            <NextLink href="/join" className="w-btn w-btn--primary">
              Create account
            </NextLink>
          </span>
          <button
            type="button"
            className="w-land__menu"
            aria-expanded={open}
            aria-controls="w-public-menu"
            aria-label={open ? 'Close the menu' : 'Open the menu'}
            onClick={() => setOpen((was) => !was)}
          >
            <Icon name={open ? 'close' : 'menu'} size={20} strokeWidth={1.9} />
          </button>
        </div>
      </header>

      <nav
        id="w-public-menu"
        className="w-land__sheet"
        aria-label="Weir"
        {...(open ? { 'data-open': '' } : {})}
      >
        {PUBLIC_NAV.map((item) => (
          <NextLink key={item.href} href={item.href} onClick={() => setOpen(false)}>
            {item.label}
          </NextLink>
        ))}
        <NextLink href="/signin" className="w-btn w-btn--quiet" onClick={() => setOpen(false)}>
          Sign in
        </NextLink>
      </nav>
    </>
  );
}

export function PublicFooter() {
  return (
    <footer className="w-land__foot">
      <nav>
        <NextLink href="/explore">Explore</NextLink>
        <NextLink href="/creators">Creators</NextLink>
        <NextLink href="/agents">Agents</NextLink>
        <NextLink href="/security">Security</NextLink>
        <NextLink href="/legal/terms">Terms</NextLink>
        <NextLink href="/legal/privacy">Privacy</NextLink>
        <NextLink href="/legal/creator-terms">Creator terms</NextLink>
        <NextLink href="/disclosure">Disclosure</NextLink>
      </nav>
      <span className="w-land__mark">
        <WeirMark size={17} />
        Weir · on Sui · Your favorite notification
      </span>
    </footer>
  );
}

/**
 * The whole shell: header, the document, footer.
 *
 * `children` is rendered inside `.w-doc`, which carries the type scale these pages need — one h1,
 * section h2s beneath it, and nothing inside a section larger than the section's own heading. The
 * app column's 20px title bar left every one of these pages with a heading smaller than its own
 * subheadings, which is the inversion that made them unreadable.
 */
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="w-app w-land">
      <a className="w-skip" href="#w-main">
        Skip to content
      </a>
      <div className="w-land__wrap" style={{ width: '100%' }}>
        <PublicHeader />
        <main id="w-main" className="w-doc">
          {children}
        </main>
        <PublicFooter />
      </div>
    </div>
  );
}
