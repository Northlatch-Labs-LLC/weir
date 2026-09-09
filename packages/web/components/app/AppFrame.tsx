'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * The application frame, bound to this host.
 *
 * `@projectx-social/ui` knows nothing about Next — it takes a `Link`, an `Image` and the current
 * path as arguments. This is the one file that supplies them, so the shell renders identically
 * here and anywhere else it is mounted, and there is one implementation of the design rather than
 * two that drift.
 */

import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode, CSSProperties } from 'react';
import { AppShell, type Viewer } from '@projectx-social/ui';
import { WalletConnect } from '@/components/WalletConnect';
import { AccountMenu } from '@/components/AccountMenu';

/**
 * The reader's address travels in the query string on every link, because it is what the frame
 * uses to decide whose account the next page is for. It is not authentication and grants nothing:
 * entitlement is decided by objects an address owns, and naming an address proves nothing about
 * holding it.
 */
function withReader(href: string, reader: string | undefined): string {
  if (reader === undefined || href.startsWith('http')) return href;
  const [path, existing] = href.split('?');
  const params = new URLSearchParams(existing ?? '');
  params.set('reader', reader);
  return `${path}?${params.toString()}`;
}

export function AppFrame({
  viewer,
  reader,
  aside,
  searchQuery,
  children,
}: {
  viewer: Viewer;
  reader?: string | undefined;
  aside?: ReactNode;
  /** What this page was searched for, so the frame's field still holds it. Only `/explore` sets it. */
  searchQuery?: string | undefined;
  children: ReactNode;
}) {
  const pathname = usePathname();

  function Link({
    href,
    children: kids,
    ...rest
  }: {
    href: string;
    className?: string | undefined;
    style?: CSSProperties | undefined;
    children: ReactNode;
    'aria-current'?: 'page' | undefined;
    'aria-label'?: string | undefined;
  }) {
    return (
      <NextLink href={withReader(href, reader)} {...rest}>
        {kids}
      </NextLink>
    );
  }

  return (
    <AppShell
      pathname={pathname}
      Link={Link}
      viewer={viewer}
      aside={aside}
      searchQuery={searchQuery}
      /*
        The reader travels with the search, because it travels with every other link out of the
        frame. A bare `GET` form posts only its own fields, so without this the one control that
        leaves the frame without going through `withReader` would drop the address being read as.
      */
      searchHidden={reader === undefined ? undefined : { reader }}
      /*
        The wallet control lives in the frame, so it is on every route rather than only on the
        pages that happened to carry a sign-in panel. It also carries the address picker, which is
        why it is mounted while connected too — see `WalletConnect`.
      */
      connect={<WalletConnect triggerClassName="w-btn w-btn--primary" triggerLabel="Connect wallet" />}
      /*
        The account menu, mounted at last.

        It was written, styled and covered by twenty tests, and the only thing that ever rendered it
        was `SiteHeader` — a component of the retired site shell that no page imports. So on every
        route of the live application there was no way to read which address you were signed in as,
        no way to switch to another address the wallet holds, and no way to sign out. The wallet was
        picked up and could not be put down.

        Nothing about how a session is proved changes here. `SessionBridge` still asks for the
        signature, `provenReader` still decides who the server answers as, and this menu still only
        shows and ends what that already established.
      */
      account={<AccountMenu />}
    >
      {children}
    </AppShell>
  );
}
