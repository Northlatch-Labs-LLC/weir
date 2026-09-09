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
  children,
}: {
  viewer: Viewer;
  reader?: string | undefined;
  aside?: ReactNode;
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
      /*
        The wallet control lives in the frame, so it is on every route rather than only on the
        pages that happened to carry a sign-in panel. It also carries the address picker, which is
        why it is mounted while connected too — see `WalletConnect`.
      */
      connect={<WalletConnect triggerClassName="w-btn w-btn--primary" triggerLabel="Connect wallet" />}
    >
      {children}
    </AppShell>
  );
}
