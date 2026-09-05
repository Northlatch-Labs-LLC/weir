// Built-by: @projectx.sui · Co-authored-by: Claude
import type { Metadata } from 'next';
import { CreatorSetup } from '@/components/CreatorSetup';
import { PerksEditor } from '@/components/PerksEditor';
import { readCreatorSetup } from '@/lib/creator-setup';
import { provenReader } from '@/lib/read-session';
import { PageTabs } from '@/components/shell/PageTabs';
import { CREATOR, titleFor } from '@/lib/site-map';
import { PageHead } from '@/components/design/PageHead';
import { readProtocol } from '@/lib/chain';
import { formatUnits } from '@/lib/units';
import { fold } from '@projectx-social/sdk';

export const metadata: Metadata = { title: titleFor('/creator') };

export const dynamic = 'force-dynamic';

/**
 * Basis points as a percentage, by integer arithmetic.
 *
 * `250n` reads as `2.5%`, `300n` as `3%`. Kept in integers for the same reason every other quantity
 * here is: a rate that renders as `2.4999999999999996%` is not wrong by enough to notice and not
 * right by enough to publish.
 */
function percent(bps: bigint): string {
  const whole = bps / 100n;
  const frac = (bps % 100n).toString().padStart(2, '0').replace(/0+$/, '');
  return `${whole}${frac === '' ? '' : `.${frac}`}%`;
}

export default async function CreatorPage() {
  /*
    The terms, read from the Platform object rather than written here.

    A signed-out visitor previously got one sentence and a wallet button: the page asked them to
    become a creator without telling them what a vault charges or who can change that later. Those
    are the two questions somebody actually has, and both have on-chain answers — so they are read
    and shown, and a failed read says so rather than falling back to a number that looks official.
  */
  const protocol = await readProtocol();

  /*
    Whose studio this is, and in what coin they settle.

    Perks are priced in the creator's own vault coin because tips are, so the editor needs the same
    scale the contract uses. Read here rather than in the editor: this page is already a server
    component, and a client that fetched its own decimals would be a second answer to a question
    with one authority.

    Every failure lands on `null`, and the section below renders nothing rather than an editor
    priced in a scale nobody confirmed.
  */
  const viewer = fold(
    await provenReader(),
    (value) => value,
    () => null,
  );
  const mine =
    viewer === null
      ? null
      : fold(
          await readCreatorSetup(viewer),
          (setup) =>
            setup.stage === 'ready'
              ? (setup.vaults.find((v) => v.handle !== null && v.decimals !== null) ?? null)
              : null,
          () => null,
        );

  return (
    <>
      <PageHead
        kicker="Creator studio"
        title="Open a vault, and set what a subscription"
        accent="costs."
        lede="Open your creator vault and set what a membership costs. Three steps, in the order the contract requires them."
      />
      <PageTabs label="Creator studio" items={CREATOR} />
      {mine !== null && mine.handle !== null && mine.decimals !== null && (
        <section data-reveal className="card" aria-labelledby="perks-title">
          <h2 id="perks-title" style={{ marginTop: 0 }}>What a tip also gets them</h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            A tip reaches you whether or not you offer anything for it. This is where you say what
            else it brings: a message you answer first, early access, a name in the credits.
            Thresholds are lifetime totals: what somebody has given you in all, not this month.
          </p>
          <PerksEditor handle={mine.handle} symbol={mine.symbol} decimals={mine.decimals} />
        </section>
      )}

        <div data-reveal className="card">
          <h2 style={{ marginTop: 0 }}>What a vault is, and what it charges</h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            A vault is a shared object on Sui that collects money on your behalf — subscriptions,
            tips and one-off unlocks all land in it. It pays out to whoever holds its capability,
            which is your wallet and nobody else&rsquo;s. This platform never takes custody of the
            balance; it takes its cut at the moment of payment, and the rest is already yours.
          </p>

          {fold(
            protocol,
            (snapshot) => (
              <div style={{ display: 'grid', gap: 'var(--space-16)', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                <div className="stat">
                  <span className="k">Platform fee on payments</span>
                  <span className="v" style={{ fontSize: 'var(--text-h4)' }}>
                    {percent(snapshot.platform.feeBps)}
                  </span>
                </div>
                <div className="stat">
                  <span className="k">Cost to open one</span>
                  <span className="v" style={{ fontSize: 'var(--text-h4)' }}>
                    {snapshot.platform.creationFeeMist === 0n
                      ? 'Gas only'
                      : `${formatUnits(snapshot.platform.creationFeeMist, 9)} SUI`}
                  </span>
                </div>
                <div className="stat">
                  <span className="k">Who can raise your rate later</span>
                  <span className="v" style={{ fontSize: 'var(--text-h4)' }}>Nobody</span>
                </div>
              </div>
            ),
            (failure) => (
              <div data-reveal className="note crit">
                <span className="lbl">Could not read this: {failure.kind}</span>
                <p>
                  The platform&rsquo;s live terms could not be read, so this page will not tell you
                  what a vault costs. {failure.detail} A fee quoted from a stale constant is how
                  somebody agrees to a rate that was never offered.
                </p>
              </div>
            ),
          )}

          <p style={{ color: 'var(--text-secondary)', marginBottom: 0, marginTop: 'var(--space-16)' }}>
            The rate above is what a vault opened <em>today</em> would carry. Your own vault keeps
            the rate it was opened with, permanently. That is the point of the snapshot explained
            below, and the reason opening early is worth something.
          </p>
        </div>

        <div style={{ marginTop: 'var(--space-24)' }}>
          <CreatorSetup />
        </div>

        <div data-reveal className="note" style={{ marginTop: 'var(--space-28)' }}>
          <span className="lbl">The fee is fixed into your vault, not looked up</span>
          <p>
            The fee rate is written into your vault the day it is created and never read from the
            platform again. Weir cannot raise the rate on a vault that already exists. A fee{' '}
            <em>cut</em> reaches you only if you choose to adopt it. That is the whole reason the
            number is copied rather than looked up.
          </p>
        </div>

        <footer>
          A vault is a shared object: anyone can pay into it, only the capability holder can take
          money out, and the capability is bound to that one vault.
        </footer>
          </>
  );
}
