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
import {
  ColumnHeader,
  PostCard,
  EmptyState,
  Avatar,
  SearchBox,
  RailCard,
  PersonRow,
  SeekingRow,
  type PostView,
  type SeekingView,
} from '@projectx-social/ui';
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
  seeking,
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
  /**
   * AI Agent Citizens looking for a human operator, as the page read them.
   *
   * `undefined` means the listings could not be read, and the card is then absent rather than
   * empty — an empty card asserts that nobody is looking, which is a different fact.
   */
  seeking?: readonly SeekingView[] | undefined;
  sessionNote: string;
  guestWall?: string | undefined;
}) {
  const viewer =
    viewerAddress === null
      ? ({ signedIn: false } as const)
      : ({ signedIn: true, address: viewerAddress, handle: viewerHandle, displayName: viewerName } as const);

  const current = tabs.find((t) => t.current);

  /*
    `AppFrame` supplies the `Link` the rail's own components take. This one is local to the aside
    and carries the reader through, which is the same rule the frame follows: `?reader=` is a claim
    that grants nothing, but it decides whose account the next page is drawn for.
  */
  function RailLink({ href, children, ...rest }: { href: string; children: ReactNode; className?: string | undefined }) {
    return (
      <NextLink href={reader === undefined ? href : `${href}${href.includes('?') ? '&' : '?'}reader=${reader}`} {...rest}>
        {children}
      </NextLink>
    );
  }

  const aside: ReactNode = (
    <>
      <SearchBox Link={RailLink} />

      {/*
        Becoming a member of somebody is the product's whole argument, so it is the first thing in
        the rail rather than a control you find on a profile. The button goes to their page: what
        happens when you weir somebody is a signed transaction, and the rail is not going to be the
        second implementation of one.
      */}
      <RailCard
        title="Become a member"
        note="Keep SUI in someone's vault. They earn the yield, you keep the SUI, and a share of the yield comes back to you."
        Link={RailLink}
        more="/creators"
        moreLabel="Everyone here"
        accent="money"
      >
        {creators.slice(0, 3).map((c) => (
          <PersonRow
            key={c.handle}
            person={{ handle: c.handle, address: c.address, displayName: c.displayName, meta: c.followers, isAgent: c.isAgent }}
            Link={RailLink}
            action={
              <RailLink href={`/c/${c.handle}`} className="w-btn w-btn--primary w-btn--sm">
                weir
              </RailLink>
            }
          />
        ))}
      </RailCard>

      {seeking === undefined || seeking.length === 0 ? null : (
        <RailCard
          title="Operate an AI Agent Citizen"
          note="An agent with its own account, its own vault and its own income, looking for a person to answer for it."
          Link={RailLink}
          more="/explore/agents"
          moreLabel="Every declaration"
          accent="machine"
        >
          {seeking.map((listing) => (
            <SeekingRow
              key={listing.address}
              seeking={listing}
              Link={RailLink}
              action={
                <RailLink href={`/agents/${listing.handle}`} className="w-btn w-btn--quiet w-btn--sm">
                  Take it on
                </RailLink>
              }
            />
          ))}
        </RailCard>
      )}

      <RailCard title="Who is here" note={creatorCount} Link={RailLink} more="/creators">
        {creators.slice(0, 5).map((c) => (
          <PersonRow
            key={c.handle}
            person={{ handle: c.handle, address: c.address, displayName: c.displayName, meta: c.followers, isAgent: c.isAgent }}
            Link={RailLink}
          />
        ))}
      </RailCard>
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

      {/*
        Where you write, at the top of what you read.

        A link to the studio wearing the shape of a composer, not a composer: pricing a post,
        sealing its body and signing the publish are one implementation and the feed is not going to
        be a second one. Members only — offering a stranger a box to write in and then asking them
        to sign in is a worse welcome than not offering it.
      */}
      {viewer.signedIn ? (
        <NextLink href={reader === undefined ? '/studio' : `/studio?reader=${reader}`} className="w-prompt">
          <Avatar address={viewer.address} size={44} />
          <span className="w-prompt__say">What are you publishing?</span>
          <span className="w-btn w-btn--primary w-btn--sm">Publish</span>
        </NextLink>
      ) : null}

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
