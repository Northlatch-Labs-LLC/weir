// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import type { Metadata } from 'next';
import { titleFor } from '@/lib/site-map';
import NextLink from 'next/link';
import { ColumnHeader } from '@projectx-social/ui';
import { AccountTabs } from '@/components/shell/AccountTabs';

export const metadata: Metadata = { title: titleFor('/add-funds') };

export const dynamic = 'force-dynamic';

export default function AddFundsPage() {
  return (
    <>
      {/*
        The application's column header, like every other page. This drew a bare `<h1>` inside a
        prose block, so the one route in the product with no sticky title bar was this one.
      */}
      <ColumnHeader title="Add funds" sub="SUI and USDC, from your own wallet" />
      <AccountTabs />
      <div className="prose" style={{ marginBottom: 'var(--space-20)' }}>
        <p>
          Weir is paid in SUI and USDC from your own wallet. Move coins to your wallet from wherever
          you hold them; a creator&rsquo;s page will then let you subscribe, unlock a post, or keep
          SUI in their vault.
        </p>
        {/*
          A way out. This page said "come back to the creator's page" and linked to nothing, so
          somebody who arrived here with an empty wallet had to find their own way back.
        */}
        <p style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
          <NextLink href="/creators" className="w-btn w-btn--primary">
            Find a creator
          </NextLink>
          <NextLink href="/explore" className="w-btn w-btn--quiet">
            See what is being read
          </NextLink>
        </p>
      </div>
    </>
  );
}
