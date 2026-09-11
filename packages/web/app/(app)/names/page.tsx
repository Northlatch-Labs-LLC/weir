// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import Link from 'next/link';
import { fold } from '@projectx-social/sdk';
import { NameManager } from '@/components/NameManager';
import { provenReader } from '@/lib/read-session';
import { reverseName } from '@/lib/names';
import { VerifiedRegistration } from '@/components/VerifiedRegistration';
import { PageHead } from '@/components/design/PageHead';

export const metadata = {
  title: 'Your .sui name',
};

export const dynamic = 'force-dynamic';

export default async function NamesPage() {
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
      <PageHead
        kicker="Names"
        title="Names"
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
