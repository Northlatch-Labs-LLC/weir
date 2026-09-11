'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

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
  seeking?: readonly SeekingView[] | undefined;
  sessionNote: string;
  guestWall?: string | undefined;
}) {
  const viewer =
    viewerAddress === null
      ? ({ signedIn: false } as const)
      : ({ signedIn: true, address: viewerAddress, handle: viewerHandle, displayName: viewerName } as const);

  const current = tabs.find((t) => t.current);

  function RailLink({ href, children, ...rest }: { href: string; children: ReactNode; className?: string | undefined }) {
    return (
      <NextLink href={reader === undefined ? href : `${href}${href.includes('?') ? '&' : '?'}reader=${reader}`} {...rest}>
        {children}
      </NextLink>
    );
  }

  const aside: ReactNode = (
    <>

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
