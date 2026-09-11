// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import type { Metadata } from 'next';
import { Earnings } from '@/components/Earnings';
import { PageTabs } from '@/components/shell/PageTabs';
import { CREATOR, titleFor } from '@/lib/site-map';
import { PageHead } from '@/components/design/PageHead';

export const metadata: Metadata = { title: titleFor('/earnings') };

export const dynamic = 'force-dynamic';

export default function EarningsPage() {
  return (
    <>
      <PageHead
        kicker="Creator studio"
        title="Earnings"
        lede="What buyers paid, what the platform took, and what you can withdraw right now: three figures, read from your vault on chain."
      />
      <PageTabs label="Creator studio" items={CREATOR} />

      <Earnings />

      <div data-reveal className="note" style={{ marginTop: 'var(--space-28)' }}>
        <span className="lbl">Your fee rate</span>
        <p>
          The platform&rsquo;s fee was written into your vault the day it was created and is read
          from nowhere else afterwards. A fee <em>cut</em> reaches you only if you adopt it.
        </p>
      </div>
    </>
  );
}
