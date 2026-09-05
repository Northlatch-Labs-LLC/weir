// Built-by: @projectx.sui · Co-authored-by: Claude
import type { Metadata } from 'next';
import { PageTabs } from '@/components/shell/PageTabs';
import { CREATOR, titleFor } from '@/lib/site-map';
import { StudioComposer } from '@/components/StudioComposer';
import { PageHead } from '@/components/design/PageHead';

export const metadata: Metadata = { title: titleFor('/studio') };

export const dynamic = 'force-dynamic';

/**
 * Creator studio.
 *
 * # What this page said to a visitor without a wallet
 *
 * The whole page was a client component gated on a signer, so somebody arriving from a shared link
 * or a search result read a heading and a form they could not use, with nothing explaining what
 * publishing here means or why it is different from publishing anywhere else. The explanation is
 * now server-rendered for everyone and the composer is the only part that waits for a wallet — the
 * same split `/join` and `/creator` use.
 */
export default function Studio() {
  return (
    <>
      <PageHead
        kicker="Creator studio"
        title="Write a post, and choose who can"
        accent="read it."
        lede="Public posts are open to everyone. Subscriber posts open to anyone holding an unexpired subscription. Paid posts are priced on chain and bought once, permanently."
      />
      <PageTabs label="Creator studio" items={CREATOR} />

        <div data-reveal className="card">
          <h2 style={{ marginTop: 0 }}>Where a post lives</h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            The words are stored by this platform. Who may read them is not: that is a subscription
            or a purchase recorded against your vault on Sui. A reader who bought a post holds that
            access on chain and keeps it, whether or not they are still subscribed and whether or
            not you change your mind later.
          </p>
          <div style={{ display: 'grid', gap: 'var(--space-16)', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            <div className="stat">
              <span className="k">What is on chain</span>
              <span className="v" style={{ fontSize: 'var(--text-h4)' }}>The price</span>
            </div>
            <div className="stat">
              <span className="k">What is stored here</span>
              <span className="v" style={{ fontSize: 'var(--text-h4)' }}>The words</span>
            </div>
            <div className="stat">
              <span className="k">Who can publish as you</span>
              <span className="v" style={{ fontSize: 'var(--text-h4)' }}>Your wallet</span>
            </div>
          </div>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 0, marginTop: 'var(--space-16)' }}>
            Publishing needs a creator page to file the post under, which means a vault that has been
            opened and named. If you have not done that yet, <a href="/creator">start there</a>. It
            is three steps, and this page tells you which one is missing.
          </p>
        </div>

        <div style={{ marginTop: 'var(--space-24)' }}>
          <StudioComposer />
        </div>

        <footer>
          A paid post is priced by a transaction against your vault before it can be published. The
          contract reads that price when somebody unlocks it, so a post published without one would
          show a buy button that fails every time.
        </footer>
          </>
  );
}
