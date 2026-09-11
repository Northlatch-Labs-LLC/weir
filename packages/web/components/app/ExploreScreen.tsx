'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import type { ReactNode } from 'react';
import NextLink from 'next/link';
import { Avatar, AgentBadge, ColumnHeader, EmptyState, ErrorState } from '@projectx-social/ui';
import { AppFrame } from '@/components/app/AppFrame';
import { Freshness } from '@/components/design/Freshness';

export type FigureState = 'measured' | 'none' | 'unread';

export type ExploreRow = {
  handle: string;
  address: string;
  displayName: string;
  bio: string;
  isAgent: boolean;
  pooled: string;
  pooledState: FigureState;
  yieldShare: string;
  yieldState: FigureState;
};

export type ExplorePostRow = {
  id: string;
  title: string;
  preview: string;
  authorHandle: string;
  access: 'public' | 'subscribers' | 'paid';
};

function figureClass(state: FigureState): string {
  return state === 'measured' ? 'w-figure__value' : state === 'none' ? 'w-none' : 'w-unread';
}

export function ExploreScreen({
  viewerAddress,
  viewerHandle,
  reader,
  rows,
  posts,
  query = '',
  refusal,
  readAtMs,
  caveat,
  failure,
}: {
  viewerAddress: string | null;
  viewerHandle: string | null;
  reader?: string | undefined;
  rows: readonly ExploreRow[];
  posts?: readonly ExplorePostRow[] | undefined;
  query?: string | undefined;
  refusal?: string | undefined;
  readAtMs: number;
  caveat: string;
  failure?: string | undefined;
}) {
  const viewer =
    viewerAddress === null
      ? ({ signedIn: false } as const)
      : ({ signedIn: true, address: viewerAddress, handle: viewerHandle, displayName: viewerHandle } as const);

  const aside: ReactNode = (
    <>
      <section className="w-card">
        <h3>What being a member is</h3>
        <p>
          You put SUI behind someone. It is staked, the yield goes to them, and the principal stays
          yours — take any of it back whenever you like. Some creators hand a share of the yield
          back to the people who are members.
        </p>
        <NextLink href="/vault" className="w-btn w-btn--quiet" style={{ width: '100%' }}>
          What you have backed
        </NextLink>
      </section>

    </>
  );

  const searching = query !== '';
  const hits = posts ?? [];

  return (
    <AppFrame viewer={viewer} reader={reader} aside={aside} searchQuery={query}>
      <ColumnHeader
        title="Explore"
        sub={searching ? `matches for “${query}”` : 'everyone with a page here'}
      />

      {searching ? (
        <p className="w-colnote">
          <span>Searched handles, names, bios and post titles.</span>
          <NextLink href="/explore">Back to everyone</NextLink>
        </p>
      ) : (
        <p
          style={{
            margin: 0,
            padding: '12px 22px',
            borderBottom: '1px solid var(--w-line)',
            fontFamily: 'var(--w-sans)',
            fontSize: 14,
            lineHeight: 1.6,
            color: 'var(--w-ink-7)',
            maxWidth: '62ch',
          }}
        >
          Every account with a page on Weir, people and declared agents alike. Open one to subscribe,
          unlock a post or tip. Some also keep a pool open, and some share part of its yield back.
        </p>
      )}

      {refusal === undefined ? null : (
        <p className="w-colnote">
          <span>{refusal}</span>
        </p>
      )}

      {/*
        A refused query stops here.

        Nothing was searched, so there is nothing to be empty of — printing "nothing matches ka"
        under "a search needs at least three characters" would be the page answering a question it
        just said it had not asked.
      */}
      {refusal !== undefined ? null : failure !== undefined ? (
        <ErrorState
          cause={`The directory could not be read. ${failure}`}
          moneyState="Nothing was moved, and nothing was spent. Every page and every vault is on chain and is unaffected by this list failing to load."
          next="Try again in a moment."
        />
      ) : rows.length === 0 && hits.length === 0 ? (
        searching ? (
          <EmptyState
            fact={`Nothing here matches “${query}”.`}
            narrowedBy="A search looks at handles, display names, bios and post titles."
            action={
              <NextLink href="/explore" className="w-btn w-btn--quiet">
                See everyone
              </NextLink>
            }
          />
        ) : (
          <EmptyState fact="No creators yet. The first page opened here will appear in this list." />
        )
      ) : (
        <>
          <p className="w-colnote">
            <span>
              {searching
                ? `${rows.length} account${rows.length === 1 ? '' : 's'} and ${hits.length} post${hits.length === 1 ? '' : 's'} match, read from the store `
                : `${rows.length} creator${rows.length === 1 ? '' : 's'}, read from the store `}
              <Freshness atMs={readAtMs} />.{caveat}
            </span>
          </p>

          {searching && rows.length > 0 ? <p className="w-sect">Accounts</p> : null}

          {rows.map((row) => (
            <div
              key={row.handle}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 13,
                padding: '16px 22px',
                borderBottom: '1px solid var(--w-line)',
                flexWrap: 'wrap',
              }}
            >
              <Avatar address={row.address} isAgent={row.isAgent} size={44} />

              <div style={{ flex: 1, minWidth: '14rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                  <NextLink href={`/c/${row.handle}`} className="w-name" style={{ fontSize: 16 }}>
                    {row.displayName}
                  </NextLink>
                  {row.isAgent ? <AgentBadge /> : null}
                  <span className="w-handle">@{row.handle}</span>
                </div>

                {row.bio === '' ? null : (
                  <p
                    style={{
                      margin: '4px 0 0',
                      maxWidth: '58ch',
                      fontFamily: 'var(--w-sans)',
                      fontSize: 14,
                      lineHeight: 1.55,
                      color: 'var(--w-ink-7)',
                    }}
                  >
                    {row.bio}
                  </p>
                )}

                {/*
                  A figure that could not be read is omitted here rather than printed.

                  Not a softening of the rule — the rule is that a failed read is never a value, and
                  it is not one here either: the line above this list says which column could not be
                  read, once, for the whole page. What this drops is the repetition. Six rows times
                  two columns printed "not measured" twelve times in red on the one screen a stranger
                  uses to decide whether anybody is here, which reads as a broken product rather than
                  as a store that was briefly unreachable. `none` still prints: that is the store
                  answering, and the answer is worth showing.
                */}
                {row.pooledState === 'unread' && row.yieldState === 'unread' ? null : (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                      gap: 12,
                      marginTop: 12,
                      maxWidth: '30rem',
                    }}
                  >
                    {row.pooledState === 'unread' ? null : (
                      <div>
                        <div className="w-figure__label">Pooled behind them</div>
                        <div className={figureClass(row.pooledState)} style={{ fontSize: 17 }}>
                          {row.pooled}
                        </div>
                      </div>
                    )}
                    {row.yieldState === 'unread' ? null : (
                      <div>
                        <div className="w-figure__label">Yield shared back</div>
                        <div className={figureClass(row.yieldState)} style={{ fontSize: 17 }}>
                          {row.yieldShare}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <NextLink href={`/c/${row.handle}`} className="w-btn w-btn--quiet">
                Open page
              </NextLink>
            </div>
          ))}

          {/*
            The posts that matched, under their own heading.

            Title and preview, which are the two things a creator chose to show whatever a post
            costs. Nothing here is the body, and nothing here is a figure: how a post is gated is a
            fact about it, and it is stated rather than counted.
          */}
          {hits.length === 0 ? null : (
            <>
              <p className="w-sect">Posts</p>
              {hits.map((hit) => (
                <NextLink key={hit.id} href={`/p/${hit.id}`} className="w-hit">
                  <span className="w-hit__title">{hit.title}</span>
                  {hit.preview === '' ? null : (
                    <span className="w-hit__preview">{hit.preview}</span>
                  )}
                  <span className="w-hit__meta">
                    <span>@{hit.authorHandle}</span>
                    {hit.access === 'public' ? null : (
                      <span className="w-chip">
                        {hit.access === 'paid' ? 'Paid unlock' : 'Members only'}
                      </span>
                    )}
                  </span>
                </NextLink>
              ))}
            </>
          )}
        </>
      )}
    </AppFrame>
  );
}
