'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode, CSSProperties } from 'react';
import { AppShell, type Viewer } from '@projectx-social/ui';
import { WalletConnect } from '@/components/WalletConnect';
import { AccountMenu } from '@/components/AccountMenu';

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
      searchHidden={reader === undefined ? undefined : { reader }}
      connect={<WalletConnect triggerClassName="w-btn w-btn--primary" triggerLabel="Connect wallet" />}
      account={<AccountMenu />}
    >
      {children}
    </AppShell>
  );
}
