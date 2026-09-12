// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import type { Metadata } from 'next';
import { titleFor } from '@/lib/site-map';
import { JoinFlow } from '@/components/JoinFlow';
import { PageHead } from '@/components/app/PageHead';
import { readProtocol } from '@/lib/chain';
import { fold } from '@projectx-social/sdk';

export const metadata: Metadata = {
  title: titleFor('/join'),
  description:
    'Pick a handle and claim it on chain. No password, no email, and it is free.',
};

export const dynamic = 'force-dynamic';

const SUI_ADDRESS = /^0x[0-9a-fA-F]{1,64}$/;

export default async function Join({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;

  const referrer = ref !== undefined && SUI_ADDRESS.test(ref) ? ref : null;

  const protocol = await readProtocol();

  return (
    <div className="w-join">
      <div className="w-join__main">
        <PageHead title="Pick your name" lede="A handle nobody can take off you, claimed on chain." />

        <JoinFlow referrer={referrer} />

        {fold(
          protocol,
          (snapshot) =>
            snapshot.platform.creationPaused ? (
              <div className="note crit" style={{ marginTop: 18 }}>
                <span className="lbl">Registration is paused on chain</span>
                <p>New handles are paused right now. It lifts when the platform reopens.</p>
              </div>
            ) : null,
          (failure) => (
            <p
              style={{
                marginTop: 18,
                fontFamily: 'var(--w-sans)',
                fontSize: 13,
                lineHeight: 1.6,
                color: 'var(--w-ink-7)',
              }}
            >
              The platform&rsquo;s terms are being read from the chain, so this page cannot yet say whether
              registration is open. {failure.detail}
            </p>
          ),
        )}
      </div>

      <aside className="w-join__side">
        <section className="w-card">
          <h3>What it costs</h3>
          <dl className="w-facts">
            <div>
              <dt>Price</dt>
              <dd>Free</dd>
            </div>
            <div>
              <dt>Yours to keep</dt>
              <dd>Always</dd>
            </div>
            <div>
              <dt>You need</dt>
              <dd>Google or a wallet</dd>
            </div>
          </dl>
          <p className="w-card__note" style={{ marginTop: 12 }}>
            Sui charges a fraction of a cent in gas to write your account to the chain. Your wallet
            shows the amount before you approve it.
          </p>
        </section>

        <section className="w-card">
          <h3>What an account gets you</h3>
          <p className="w-card__note">
            Follow, comment, subscribe, and keep SUI in a creator&rsquo;s vault. Publishing and
            taking payment is a separate step, later.
          </p>
        </section>
      </aside>
    </div>
  );
}
