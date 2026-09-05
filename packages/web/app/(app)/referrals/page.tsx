// Built-by: @projectx.sui · Co-authored-by: Claude
import type { Metadata } from 'next';
import { titleFor } from '@/lib/site-map';
import { Referrals } from '@/components/Referrals';
import { PageHead } from '@/components/design/PageHead';
import { AccountTabs } from '@/components/shell/AccountTabs';

export const metadata: Metadata = { title: titleFor('/referrals') };

export const dynamic = 'force-dynamic';

export default function ReferralsPage() {
  return (
    <>
      {/*
        No `.wrap`: that clamps to 780px, which is right for a column of prose under a full-width
        header and wrong inside the dashboard's own measure. Each block below carries its own.
      */}
      <PageHead
        kicker="Your account"
        title="Bring someone, and take a share of"
        accent="our cut."
        lede="Never out of the creator's. The share is a percentage of the platform fee, so a creator receives exactly what they would have received anyway."
      />
      <AccountTabs />
      <Referrals />
      <div data-reveal className="note" style={{ marginTop: 'var(--space-28)' }}>
        <span className="lbl">Where the money comes from</span>
        <p>
          The referral share is a percentage <strong>of the platform fee</strong>, not of the
          payment. On a 10 USDC subscription at a 2.9% fee, Weir takes 0.29. At a 5% share it
          would pass 0.0145 of that on, and the creator receives exactly what they would have
          received anyway. A referral scheme funded out of a creator&rsquo;s earnings would be a
          pay cut with a friendlier name.
        </p>
      </div>
    </>
  );
}
