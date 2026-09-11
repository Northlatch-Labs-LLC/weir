'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useState } from 'react';
import NextLink from 'next/link';
import { SOCIAL } from '@/lib/social-links';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Icon, WeirMark } from '@projectx-social/ui';

const PUBLIC_NAV: readonly { href: string; label: string }[] = [
  { href: '/explore', label: 'Creators' },
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
          {/* Neither button offers the page you are already on. On a phone the header is two
              buttons wide, and "Create account" sitting above the create-account form is one of
              them spent on a round trip to itself. */}
          <span style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            {pathname === '/signin' ? null : (
              <NextLink href="/signin" className="w-btn w-btn--quiet">
                Sign in
              </NextLink>
            )}
            {pathname === '/join' ? null : (
              <NextLink href="/join" className="w-btn w-btn--primary">
                Create account
              </NextLink>
            )}
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
        {pathname === '/signin' ? null : (
          <NextLink href="/signin" className="w-btn w-btn--quiet" onClick={() => setOpen(false)}>
            Sign in
          </NextLink>
        )}
      </nav>
    </>
  );
}

export function PublicFooter() {
  return (
    <footer className="w-land__foot">
      <nav>
        <NextLink href="/explore">Explore</NextLink>
        {/* Named for what it is. "Creators" beside "Explore" read as a second directory; it is the
            setup for opening one's own page. */}
        <NextLink href="/creators">Open a page</NextLink>
        <NextLink href="/agents">Agents</NextLink>
        <NextLink href="/security">Security</NextLink>
        <NextLink href="/legal/terms">Terms</NextLink>
        <NextLink href="/legal/privacy">Privacy</NextLink>
        <NextLink href="/legal/creator-terms">Creator terms</NextLink>
        <NextLink href="/disclosure">Disclosure</NextLink>
      </nav>
      {/*
        Where to follow the work.

        These three accounts were in `lib/social-links.ts` with exactly one consumer:
        `lib/structured-data.ts`, which publishes them as the organisation's JSON-LD `sameAs`. So
        the only thing on this site saying where to find us was metadata addressed to crawlers —
        a person reading the page had no way to reach any of them. The footer that used to carry
        them belonged to the site shell the application replaced.

        Read from the same list the metadata reads, never retyped here: a footer and a `sameAs`
        naming different accounts is a claim about identity disagreeing with itself, and the one
        the reader cannot see is the one that would stay wrong.
      */}
      <nav aria-label="Follow" className="w-land__follow">
        {SOCIAL.map((account) => (
          <NextLink
            key={account.href}
            href={account.href}
            target="_blank"
            rel="noreferrer"
            title={`${account.name} · ${account.handle}`}
          >
            {account.name}
          </NextLink>
        ))}
      </nav>
      <span className="w-land__mark">
        <WeirMark size={17} />
        Weir · on Sui · Your favorite notification
      </span>
    </footer>
  );
}

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
