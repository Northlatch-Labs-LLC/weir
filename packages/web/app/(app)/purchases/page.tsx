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
        title="Everything you hold, read from the"
        accent="objects themselves."
        lede="Every subscription and unlocked post. Expired subscriptions stay on the list. A receipt for something that has lapsed is still a receipt."
      />
      <AccountTabs />
      <Purchases />
      <div data-reveal className="note" style={{ marginTop: 'var(--space-28)' }}>
          <span className="lbl">There is no orders table behind this</span>
          <p>
            A <span className="mono">Subscription</span> and an <span className="mono">Unlock</span>{' '}
            are objects you own on Sui. This platform cannot revoke one, edit one, or take it away by
            shutting down, so each line links to the object rather than asking you to take our word.
          </p>
      </div>
    </>
  );
}
