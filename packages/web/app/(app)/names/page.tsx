// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * The `.sui` name shop.
 *
 * # What this stopped being
 *
 * This route was a second way to register: buying a name opened a platform account in the same
 * transaction, and the page was written as a signup. That coupled a product to identity and made
 * both harder to explain — somebody can already have an account, and somebody can own a name bought
 * straight from SuiNS, which is a perfectly real name that says nothing about this platform.
 *
 * Signing up is a wallet or a Google account and it lives in `/join`. This route sells a name and
 * nothing else. Keeping the two apart is what makes either of them describable in a sentence.
 *
 * # No `?ref=` here
 *
 * Referral attribution is a parameter of `account::open`, which this transaction no longer calls.
 * Reading a referrer and doing nothing with it would let somebody build a referral link that pays
 * out nothing, which is worse than not offering one.
 */

import Link from 'next/link';
import { fold } from '@projectx-social/sdk';
import { NameManager } from '@/components/NameManager';
import { provenReader } from '@/lib/read-session';
import { reverseName } from '@/lib/names';
import { VerifiedRegistration } from '@/components/VerifiedRegistration';
import { PageHead } from '@/components/design/PageHead';

export const metadata = {
  // The root layout's template appends "· Weir"; carrying it here too produced "· Weir · Weir".
  title: 'Your .sui name',
};

export const dynamic = 'force-dynamic';

export default async function NamesPage() {
  /*
    What this address is currently shown as, read once on the server.

    The manager keeps its own copy after a change lands, so the page does not have to re-read the
    chain to reflect something the reader just did. A failed read is `null` — "no name shown" and
    "we could not tell" render the same here, which is acceptable because the manager offers to set
    one either way.
  */
  const viewer = fold(
    await provenReader(),
    (value) => value,
    () => null,
  );
  const displayed =
    viewer === null
      ? null
      : fold(
          await reverseName(viewer),
          (value) => value,
          () => null,
        );

  return (
    <>
      {/* Chrome from `AppFrame`; `PageHead` restores the `h1` the retired title bar used to supply. */}
      <PageHead
        kicker="Names"
        title="A name of your own, bought once and"
        accent="owned outright."
        lede="A .sui name is an object in your wallet, not a row in this platform's database. It is separate from an account: you can hold either without the other."
      />

      <VerifiedRegistration />

      <section className="weir-section" aria-labelledby="manage-title">
        <div className="weir-section__head">
          <div>
            <h2 className="weir-section__title">
              <span className="weir-grad">Your names</span>
            </h2>
            <p className="weir-section__hint">
              Point a name at an address, and choose which one you are shown as. Two different
              settings: where a name sends people, and what your address is called.
            </p>
          </div>
        </div>
        <NameManager reverseName={displayed} />
      </section>

      <p className="section-note" style={{ marginTop: 'var(--space-24)' }}>
        Don&rsquo;t have an account yet? <Link href="/join">Claiming a handle</Link> is free apart
        from gas, and it does not need a name. A name is a separate thing you can buy whenever you
        want one.
      </p>
    </>
  );
}
