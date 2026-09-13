'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode, CSSProperties } from 'react';
import { AppShell, type Viewer } from '@projectx-social/ui';
import { WalletConnect } from '@/components/WalletConnect';
import { AccountMenu } from '@/components/AccountMenu';
import { FOOTER } from '@/lib/site-map';

export function AppFrame({
  viewer,
  aside,
  searchQuery,
  children,
}: {
  viewer: Viewer;
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
      <NextLink href={href} {...rest}>
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
      connect={<WalletConnect triggerClassName="w-btn w-btn--primary" triggerLabel="Connect wallet" />}
      account={<AccountMenu />}
      footer={FOOTER.column}
    >
      {children}
    </AppShell>
  );
}
