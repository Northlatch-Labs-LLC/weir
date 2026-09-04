// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import type { Metadata } from 'next';
import { titleFor } from '@/lib/site-map';
import { AccountTabs } from '@/components/shell/AccountTabs';

/**
 * `/add-funds` — no card path exists here.
 *
 * The route stays reachable so an old link does not 404; the page it once served (a card-funded
 * on-ramp) is removed. Weir is crypto only: SUI and USDC settle from the visitor's own wallet, and
 * no provider has been accepted to sell either for a card or a bank transfer. See UPDATE.md.
 */
export const metadata: Metadata = { title: titleFor('/add-funds') };

export const dynamic = 'force-dynamic';

export default function AddFundsPage() {
  return (
    <>
      <AccountTabs />
      <div className="prose" style={{ marginBottom: 'var(--space-20)' }}>
        <h1>Add funds</h1>
        <p>
          Weir is paid in SUI and USDC from your own wallet. There is no card or bank purchase
          here. Move coins to your wallet from wherever you hold them, then come back to the
          creator&rsquo;s page.
        </p>
      </div>
    </>
  );
}
