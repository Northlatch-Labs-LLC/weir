// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
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
      {/*
        `PageTabs` sits under the head. The creator tools are
        three routes doing one job, and a sub-nav floating above an untitled page said neither which
        job nor where in it you were.
      */}
      <PageHead
        kicker="Creator studio"
        title="What you were paid, and what you can"
        accent="take out."
        lede="What buyers paid, what the platform took, and what you can withdraw right now: three figures, read from your vault on chain."
      />
      <PageTabs label="Creator studio" items={CREATOR} />

      <Earnings />

      <div data-reveal className="note" style={{ marginTop: 'var(--space-28)' }}>
        <span className="lbl">Nothing here can hold your money</span>
        <p>
          Withdrawing checks no pause switch on chain. There is
          no approval queue, no processing period and no minimum payout. Those are all names for a
          float, and this contract has none. The platform&rsquo;s fee was fixed into your
          vault the day it was created and cannot be raised on it afterwards.
        </p>
      </div>
    </>
  );
}
