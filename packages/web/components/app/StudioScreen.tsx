'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * The studio, in the application frame.
 *
 * # What is not touched
 *
 * `StudioComposer` is nine hundred lines that price a post on chain, seal a body, upload media and
 * report which of those steps failed. It publishes real work for real money. It is MOUNTED here,
 * not rewritten and not re-typed: this screen supplies the frame and the explanation around it and
 * nothing else. The composer's own four-state price read — not asked, checking, measured, could
 * not reach the chain — is exactly the kind of distinction a rewrite loses.
 *
 * # Why the explanation is here rather than in a hero
 *
 * Somebody arriving from a shared link needs to know what publishing here means before they can
 * decide whether to. The old page said it in a page-wide hero, which is a landing-page device on a
 * screen a creator opens every week. It sits in the rail now: present, permanent, and not in the
 * way of the writing.
 */

import NextLink from 'next/link';
import { ColumnHeader } from '@projectx-social/ui';
import { AppFrame } from '@/components/app/AppFrame';
import { StudioComposer } from '@/components/StudioComposer';

export function StudioScreen({
  viewerAddress,
  viewerHandle,
  reader,
}: {
  viewerAddress: string | null;
  viewerHandle: string | null;
  reader?: string | undefined;
}) {
  const viewer =
    viewerAddress === null
      ? ({ signedIn: false } as const)
      : ({ signedIn: true, address: viewerAddress, handle: viewerHandle, displayName: viewerHandle } as const);

  const aside = (
    <>
      <section className="w-card">
        <h3>Where a post lives</h3>
        <p>
          The words are stored here. Who may read them is not: that is a subscription or a purchase
          recorded against your vault on Sui. A reader who bought a post holds that access on chain
          and keeps it, whether or not they are still subscribed and whether or not you change your
          mind later.
        </p>
        <div className="w-card__row" style={{ justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'var(--w-sans)', fontSize: 13, color: 'var(--w-ink-7)' }}>On chain</span>
          <span style={{ fontFamily: 'var(--w-sans)', fontSize: 13, fontWeight: 600, color: 'var(--w-ink-10)' }}>
            The price
          </span>
        </div>
        <div className="w-card__row" style={{ justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'var(--w-sans)', fontSize: 13, color: 'var(--w-ink-7)' }}>Stored here</span>
          <span style={{ fontFamily: 'var(--w-sans)', fontSize: 13, fontWeight: 600, color: 'var(--w-ink-10)' }}>
            The words
          </span>
        </div>
        <div className="w-card__row" style={{ justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'var(--w-sans)', fontSize: 13, color: 'var(--w-ink-7)' }}>
            Who can publish as you
          </span>
          <span style={{ fontFamily: 'var(--w-sans)', fontSize: 13, fontWeight: 600, color: 'var(--w-ink-10)' }}>
            Your wallet
          </span>
        </div>
      </section>

      <section className="w-card">
        <h3>Before you can publish</h3>
        <p>
          A post is filed under a creator page, which needs a vault that has been opened and named.
          The composer tells you which of those is missing.
        </p>
        <NextLink href="/creator" className="w-btn w-btn--quiet" style={{ width: '100%' }}>
          Open a vault
        </NextLink>
      </section>

      <p style={{ margin: '4px 2px 0', fontFamily: 'var(--w-sans)', fontSize: 12, lineHeight: 1.7, color: 'var(--w-ink-6)' }}>
        <NextLink href="/earnings">Earnings</NextLink> · <NextLink href="/vault">Vault</NextLink> ·{' '}
        <NextLink href="/security">Security</NextLink> · 2.9% at settlement
      </p>
    </>
  );

  return (
    <AppFrame viewer={viewer} reader={reader} aside={aside}>
      <ColumnHeader title="Studio" sub={viewerHandle === null ? undefined : `publishing as @${viewerHandle}`} />

      <p
        style={{
          margin: 0,
          padding: '16px 22px',
          borderBottom: '1px solid var(--w-line)',
          fontFamily: 'var(--w-serif)',
          fontSize: 17,
          lineHeight: 1.6,
          color: 'var(--w-ink-9)',
          maxWidth: '62ch',
        }}
      >
        Free posts are open to everyone. Subscriber posts open to anyone holding an unexpired
        subscription. A paid post is priced on chain and bought once, permanently.
      </p>

      <div style={{ padding: '18px 22px 40px' }}>
        <StudioComposer />
      </div>
    </AppFrame>
  );
}
