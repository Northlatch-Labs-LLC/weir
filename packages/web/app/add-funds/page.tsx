// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import type { Metadata } from 'next';
import { titleFor } from '@/lib/site-map';
import { AccountTabs } from '@/components/shell/AccountTabs';
import { AddFundsPanel } from '@/components/AddFundsPanel';
import { onrampConfigured } from '@/lib/onramp';

/**
 * `/add-funds` — buying the coins, explained before it is offered.
 *
 * The card button inside the deposit panel catches somebody at the moment they run out. This page
 * is the other half: where a person goes having decided to support someone and holding no crypto
 * at all. A payment step that appears only as the answer to a failure teaches nobody what is about
 * to happen to their money, and this is a page about somebody's money.
 */
export const metadata: Metadata = { title: titleFor('/add-funds') };

export const dynamic = 'force-dynamic';

export default function AddFundsPage() {
  const configured = onrampConfigured();

  return (
    <>
      <AccountTabs />
      <div className="prose" style={{ marginBottom: 'var(--space-20)' }}>
        <h1>Add funds</h1>
        <p>
          Buy SUI or USDC with a debit or credit card and have it delivered straight to your own
          wallet on Sui. You do not need an exchange account, and nothing here touches the money you
          have already pooled behind a creator.
        </p>
      </div>

      {configured ? (
        <AddFundsPanel />
      ) : (
        <div className="note">
          <span className="lbl">Not available here</span>
          <p>
            Card purchases are not configured on this deployment. That is a deliberate, permanent
            answer rather than a failure — nothing is being retried behind this message.
          </p>
        </div>
      )}

      <div className="card" style={{ marginTop: 'var(--space-20)' }}>
        <span className="k">WHAT HAPPENS, IN ORDER</span>
        <ol className="prose" style={{ paddingLeft: '1.1rem', lineHeight: 1.7 }}>
          <li>You choose the coin and the amount here.</li>
          <li>
            The purchase opens on the provider&rsquo;s own page. Your card details go to them, never
            to us — this site never sees a card number and never holds your money.
          </li>
          <li>
            They deliver the coins to your wallet address. It is filled in from the wallet you have
            connected and cannot be edited, because a mistyped address is a permanent loss with
            nobody to appeal to.
          </li>
          <li>
            The coins arrive in your own wallet. Only you can spend them — pooling behind a creator
            is a separate step you take afterwards, and one you can undo at any time.
          </li>
        </ol>
      </div>
    </>
  );
}
