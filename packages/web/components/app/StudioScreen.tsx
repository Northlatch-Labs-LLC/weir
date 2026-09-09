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

import type { ReactNode } from 'react';
import NextLink from 'next/link';
import { ColumnHeader } from '@projectx-social/ui';
import { AppFrame } from '@/components/app/AppFrame';
import { StudioComposer } from '@/components/StudioComposer';

export function StudioScreen({
  viewerAddress,
  viewerHandle,
  reader,
  discovery,
}: {
  viewerAddress: string | null;
  viewerHandle: string | null;
  reader?: string | undefined;
  /**
   * The discovery column, read on the server and handed down.
   *
   * A server component passed as a prop into a client one: this screen cannot read the store
   * itself, and the rail is the same rail every other wrapped route gets. Optional, so a test or a
   * caller without it renders the page's own cards and nothing else.
   */
  discovery?: ReactNode;
}) {
  const viewer =
    viewerAddress === null
      ? ({ signedIn: false } as const)
      : ({ signedIn: true, address: viewerAddress, handle: viewerHandle, displayName: viewerHandle } as const);


  /*
    The page's own cards, and then the people.

    These four screens pass an `aside`, and an `aside` REPLACES the discovery column rather than
    joining it — so `/vault`, `/studio`, `/alerts` and `/messages` were the only wrapped routes with
    no faces on them at all, and 337 to 715 pixels of empty ground under one explanatory card. The
    discovery rail is read on the server and handed down as `discovery`, so it renders beneath the
    page's own cards instead of replacing them.
  */
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

    </>
  );

  return (
    <AppFrame
      viewer={viewer}
      reader={reader}
      aside={
        <>
          {aside}
          {discovery}
        </>
      }
    >
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

      {/* `w-fill` so the composer takes the room between the header and the footer rather than
          leaving a 992px void under it when the aside is taller than this column. */}
      <div className="w-fill" style={{ padding: '18px 22px 40px' }}>
        <StudioComposer />
      </div>
    </AppFrame>
  );
}
