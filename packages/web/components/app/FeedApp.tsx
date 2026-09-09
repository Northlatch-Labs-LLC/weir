'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * The feed, in the application frame.
 *
 * This replaces the page-headed, hero-led rendering that treated the feed as a landing page. The
 * feed is where a member already is; it opens on the posts.
 *
 * # What this file does not do
 *
 * It does not read anything. Every figure arrives from `FeedView`, which reads the store, the
 * chain and the entitlement objects and decides what a body may contain. Keeping the read out of
 * the presentation is why a post's words cannot leak through a rendering mistake: an unentitled
 * post arrives here with no body at all, not with a body this component is trusted to hide.
 *
 * # What is deliberately absent
 *
 * A support count. The design shows one; the store does not hold one. Rather than print a figure
 * nobody counted, the control carries no number — which is the same rule as "not measured", one
 * level quieter.
 */

import type { ReactNode } from 'react';
import NextLink from 'next/link';
import { ColumnHeader, PostCard, EmptyState, Avatar, type PostView } from '@projectx-social/ui';
import { AppFrame } from '@/components/app/AppFrame';

export type FeedTab = { label: string; href: string; current: boolean; note?: string | undefined };

export type FeedCreator = {
  handle: string;
  address: string;
  displayName: string;
  followers: string;
  isAgent: boolean;
};

export function FeedApp({
  viewerAddress,
  viewerHandle,
  viewerName,
  reader,
  posts,
  tabs,
  emptyMessage,
  creators,
  creatorCount,
  sessionNote,
  guestWall,
}: {
  viewerAddress: string | null;
  viewerHandle: string | null;
  viewerName: string | null;
  reader?: string | undefined;
  posts: readonly PostView[];
  tabs: readonly FeedTab[];
  emptyMessage: string;
  creators: readonly FeedCreator[];
  creatorCount: string;
  sessionNote: string;
  guestWall?: string | undefined;
}) {
  const viewer =
    viewerAddress === null
      ? ({ signedIn: false } as const)
      : ({ signedIn: true, address: viewerAddress, handle: viewerHandle, displayName: viewerName } as const);

  const current = tabs.find((t) => t.current);

  const aside: ReactNode = (
    <>
      <section className="w-card">
        <h3>Who is here</h3>
        <p>{creatorCount}</p>
        {creators.slice(0, 5).map((c) => (
          <div key={c.handle} className="w-card__row">
            <Avatar address={c.address} isAgent={c.isAgent} size={38} />
            <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <NextLink
                href={reader === undefined ? `/c/${c.handle}` : `/c/${c.handle}?reader=${reader}`}
                className="w-name"
                style={{ fontSize: 14 }}
              >
                {c.displayName}
              </NextLink>
              <span style={{ fontFamily: 'var(--w-mono)', fontSize: 12, color: 'var(--w-ink-7)' }}>
                @{c.handle} · {c.followers}
              </span>
            </span>
          </div>
        ))}
      </section>

    </>
  );

  return (
    <AppFrame viewer={viewer} reader={reader} aside={aside}>
      <ColumnHeader
        title="Home"
        {...(current?.note === undefined ? {} : { sub: current.note })}
        tabs={tabs.map((t) => ({ href: t.href, label: t.label }))}
        Link={({ href, children, ...rest }) => (
          <NextLink href={href} {...rest}>
            {children}
          </NextLink>
        )}
        pathname={current?.href}
      />

      <p
        style={{
          margin: 0,
          padding: '10px 20px',
          borderBottom: '1px solid var(--w-line)',
          fontFamily: 'var(--w-mono)',
          fontSize: 12,
          color: 'var(--w-ink-7)',
        }}
      >
        {sessionNote}
      </p>

      {viewerAddress === null ? null : (
        /*
          The way to publish, at the top of the feed where the design puts it.

          It is a link to the studio rather than an input that looks like a composer: publishing on
          Weir sets a price on chain and seals a body, which is not something a box on the feed can
          honestly pretend to do in one keystroke. A control that opens the real thing is truthful;
          a fake one that discards what you typed is not.
        */
        <NextLink
          href="/studio"
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            padding: '16px 20px',
            borderBottom: '1px solid var(--w-line)',
          }}
        >
          <Avatar address={viewerAddress} size={44} />
          <span style={{ fontFamily: 'var(--w-serif)', fontSize: 19, color: 'var(--w-ink-6)' }}>
            Publish something
          </span>
          <span className="w-btn w-btn--primary w-btn--sm" style={{ marginLeft: 'auto', minHeight: 38, padding: '0 22px' }}>
            Publish
          </span>
        </NextLink>
      )}

      {posts.length === 0 ? (
        <EmptyState fact={emptyMessage} />
      ) : (
        posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            Link={({ href, children, ...rest }) => (
              <NextLink href={href} {...rest}>
                {children}
              </NextLink>
            )}
          />
        ))
      )}

      {guestWall === undefined ? null : (
        <div style={{ padding: '22px 20px', borderBottom: '1px solid var(--w-line)', textAlign: 'center' }}>
          <p style={{ margin: '0 0 14px', fontFamily: 'var(--w-sans)', fontSize: 14, color: 'var(--w-ink-7)' }}>
            {guestWall}
          </p>
          <NextLink href="/signin" className="w-btn w-btn--primary">
            Sign in
          </NextLink>
        </div>
      )}
    </AppFrame>
  );
}
