// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import type { Metadata } from 'next';
import { titleFor } from '@/lib/site-map';
import { Purchases } from '@/components/Purchases';
import { PageHead } from '@/components/app/PageHead';
import { AccountTabs } from '@/components/shell/AccountTabs';

export const metadata: Metadata = { title: titleFor('/purchases') };

export const dynamic = 'force-dynamic';

export default function PurchasesPage() {
  return (
    <>
      <PageHead
        kicker="Your account"
        title="Purchases"
        lede="Every subscription and unlocked post. Expired subscriptions stay on the list. A receipt for something that has lapsed is still a receipt."
      />
      <AccountTabs />
      <Purchases />
      <div data-reveal className="note" style={{ marginTop: 'var(--space-28)' }}>
          <span className="lbl">Everything here is yours</span>
          <p>
            Each of these is an object in your own wallet on Sui, and it stays there. Follow any line
            to see it on chain.
          </p>
      </div>
    </>
  );
}
