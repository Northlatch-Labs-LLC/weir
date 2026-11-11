// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import type { Metadata } from 'next';
import { titleFor } from '@/lib/site-map';
import NextLink from 'next/link';
import { ColumnHeader } from '@projectx-social/ui';

export const metadata: Metadata = {
  title: titleFor('/add-funds'),
  description: 'Where to buy SUI and how to move it into your own wallet, in six steps.',
};

export const dynamic = 'force-dynamic';

/*
  This page is where every "not enough balance" refusal sends the reader, so it is the single most
  expensive paragraph in the product. It used to say "move coins from wherever you hold them", which
  is true and useless at the moment someone has just been told they cannot pay. Weir does not sell
  coins and takes no commission on buying them, so the honest role of this page is to teach the
  five-minute task: buy somewhere, withdraw on the Sui network, verify.
*/
export default function AddFundsPage() {
  return (
    <>
      <ColumnHeader title="Add funds" sub="SUI and USDC, bought wherever you like, held in your own wallet" />

      <div className="prose" style={{ marginBottom: 'var(--space-20)' }}>
        <p>
          Weir does not sell coins and takes nothing from the purchase. You buy SUI or USDC from a
          service that exchanges your currency for them, then move them to the wallet you sign with
          here. Two facts decide whether that goes smoothly: the service must let you <strong>withdraw
          on the Sui network</strong>, and you must copy your address correctly.
        </p>

        <h2>What to check before you deposit anywhere</h2>
        <ul>
          <li><strong>It accepts deposits in your currency.</strong> Many accept only euros or dollars, and the conversion costs more than the fee they advertise.</li>
          <li><strong>It lets you withdraw SUI to the Sui network</strong>, not only buy it. Buying without withdrawing leaves the coins with them.</li>
          <li><strong>The fees, read before you send:</strong> deposit, trade, withdrawal. Small percentages add up on small amounts.</li>
          <li><strong>The minimum withdrawal.</strong> Some require far more than a single membership is worth.</li>
          <li><strong>It serves your country.</strong> Check at sign-up rather than assuming.</li>
        </ul>
        <p>
          Large international exchanges and several European platforms have listed SUI. We name none
          of them: availability, local currency pairs and Sui support change often, and a list on this
          page would be wrong within months. Check in your own account, before you deposit.
        </p>

        <h2>Six steps</h2>
        <ol>
          <li><strong>Open the account</strong> at the service you chose and complete identity verification. It takes minutes to a day, and it is their legal requirement, not ours.</li>
          <li><strong>Copy your Sui address</strong> from your wallet. It starts with <code>0x</code>. Compare the first and last four characters — a wrong address has no undo.</li>
          <li><strong>Buy a small amount.</strong> Start with ten or twenty, and move that through the whole chain before sending anything that matters.</li>
          <li><strong>Withdraw on the Sui network</strong> to the address you copied. Choose Sui explicitly; other networks will lose the coins.</li>
          <li><strong>Check the balance here.</strong> It appears in seconds to a minute. If it does not, the withdrawal is still in flight at their end.</li>
          <li><strong>Then pay.</strong> Unlock a post, join a membership, or put SUI behind a creator and take the principal back whenever you want.</li>
        </ol>

        <h2>Mistakes that cost money</h2>
        <ul>
          <li><strong>The wrong network.</strong> SUI sent over a different network is gone. Read the network name twice.</li>
          <li><strong>The wrong address.</strong> There is no cancellation and no support line that can reverse it.</li>
          <li><strong>A large first transfer.</strong> A ten-unit test feels like a waste of time. It is not.</li>
          <li><strong>A wallet you do not control.</strong> If the service holds the coins for you, they cannot be used here.</li>
        </ul>

        <h2>One thing we will never ask for</h2>
        <p>
          Nobody at Weir will ask for your recovery phrase or your private key, not in a message, not
          by email, not in a support call. We do not need it and cannot use it. If someone claiming to
          be from Weir asks, they are not.
        </p>

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
