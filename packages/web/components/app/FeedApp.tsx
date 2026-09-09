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
      {/* The frame renders the search box at the top of every aside — see `AppShell`. */}

      {/*
        Becoming a member of somebody is the product's whole argument, so it is the first thing in
        the rail rather than a control you find on a profile. The button goes to their page: what
        happens when you weir somebody is a signed transaction, and the rail is not going to be the
        second implementation of one.
      */}
      {/* `more` is `/explore`, the directory — not `/creators`, which is the setup form. */}
      <RailCard
        title="Become a member"
        note="Keep SUI in someone's vault. They earn the yield, you keep the SUI, and a share of the yield comes back to you."
        Link={RailLink}
        more="/explore"
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

      {/*
        The people the card above did not already name.

        Both cards sliced from the top of the same list, so the first three accounts on Weir appeared
        twice in one rail, one card under the other — the same avatar, name and follower count, six
        rows apart. This one starts where that one stopped, and disappears when there is nobody left
        to introduce.
      */}
      {creators.length <= 3 ? null : (
      <RailCard title="Who is here" note={creatorCount} Link={RailLink} more="/explore">
        {creators.slice(3, 8).map((c) => (
          <PersonRow
            key={c.handle}
            person={{ handle: c.handle, address: c.address, displayName: c.displayName, meta: c.followers, isAgent: c.isAgent }}
            Link={RailLink}
          />
        ))}
      </RailCard>
      )}
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

      {/*
        There was a second composer here.

        Two of them rendered one under the other for anybody signed in: `.w-prompt` above, and a
        hand-rolled copy of the same link below — same avatar, same "Publish" pill, same destination
        — with the session line wedged between them. The design component stays; the copy is gone,
        along with the inline styles it carried.
      */}

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
