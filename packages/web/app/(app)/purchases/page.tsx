// Built-by: @projectx.sui · Co-authored-by: Claude
import type { Metadata } from 'next';
import { titleFor } from '@/lib/site-map';
import { Purchases } from '@/components/Purchases';
import { PageHead } from '@/components/design/PageHead';
import { AccountTabs } from '@/components/shell/AccountTabs';

export const metadata: Metadata = { title: titleFor('/purchases') };

export const dynamic = 'force-dynamic';

export default function PurchasesPage() {
  return (
    <>
      {/* Chrome from `AppFrame`; `PageHead` restores the `h1` the retired title bar used to supply. */}
      <PageHead
        kicker="Your account"
        title="Purchases"
        lede="Every subscription and unlocked post. Expired subscriptions stay on the list. A receipt for something that has lapsed is still a receipt."
      />
      <AccountTabs />
      <Purchases />
      <div data-reveal className="note" style={{ marginTop: 'var(--space-28)' }}>
          {/*
            This was headed "There is no orders table behind this" and ended "rather than asking you
            to take our word" — our database design, and a disclaimer, on the page where somebody
            looks at what they bought. What they want is that the thing they paid for is theirs and
            that they can point at it.
          */}
          <span className="lbl">Everything here is yours</span>
          <p>
            Each of these is an object in your own wallet on Sui, and it stays there. Follow any line
            to see it on chain.
          </p>
      </div>
    </>
  );
}
