'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude


import { PageTabs, type Tab } from '@/components/shell/PageTabs';
import { PageHead } from '@/components/design/PageHead';
import { Fragment } from 'react';
import { PostCard } from '@/components/PostCard';
import type { VisiblePost } from '@/lib/content';
import type { Entity } from '@/components/EntityType';

export interface DesignFeedPost {
  post: VisiblePost;
  price?: string;
  reader?: string;
  entities?: Entity[];
  /** From the declaration register, when the page looked. See `PostCard`'s prop of the same name. */
  authorIsAgent?: boolean;
}
export interface DesignFeedCreator {
  displayName: string;
  initials: string;
  meta: string;
  href: string;
}
export interface DesignBuiltOn {
  name: string;
  /** The text fallback shown when no logo is supplied. Kept so a missing file degrades to letters. */
  mark: string;
  note: string;
  href: string;
  /**
   * The partner's own icon, served from `public/brand/built-on/`. Decorative: the name beside it is
   * the accessible label, so the image carries an empty `alt` rather than repeating it.
   */
  logo?: string;
}

export function DesignHome({
  signedIn,
  myHandle,
  feed,
  feedTabs,
  feedEmptyMessage,
  creators,
  creatorCount,
  sessionLabel,
  guestWall,
  builtOn,
}: {
  signedIn: boolean;
  myHandle: string | null;
  feed: readonly DesignFeedPost[];
  feedTabs: readonly Tab[];
  feedEmptyMessage: string;
  creators: readonly DesignFeedCreator[];
  creatorCount: string;
  sessionLabel: string;
  /** Where the guest sample ends, and how to see past it. Absent when nothing is withheld. */
  guestWall?: string;
  builtOn: readonly DesignBuiltOn[];
}) {
  const feedEmpty = feed.length === 0;

  return (
    <>
          <div className="weir-page" style={{ maxWidth: '72rem', marginInline: 'auto', padding: '3rem 1.5rem 4rem' }}>
            <div className="weir-cols">
              <section aria-label="Feed">
                {/*
                  The ported design's page head: the page's name, left, and one sentence saying
                  what is on it.

                  It was a centred hero — kicker "Feed", title "What's new", accent "above the
                  waterline." — which is a landing-page device on a page a member opens every day.
                  A hero belongs where somebody is being introduced to the product; the feed is
                  where they already are.
                */}
                <PageHead
                  title="Feed"
                  lede="Everything published, newest first. Consecutive posts by one account that share a subject are grouped."
                />
                <PageTabs label="Feed view" items={feedTabs} />
                <p className="feed-session">{sessionLabel}</p>
                <div style={{ marginTop: '1.5rem', display: 'grid', gap: '1.25rem' }}>
                  {(feed ?? []).map((post, i) => (<Fragment key={i}>
                    <PostCard post={post.post} price={post.price} reader={post.reader} entities={post.entities} authorIsAgent={post.authorIsAgent} />
                  </Fragment>))}
                  {guestWall !== undefined && (
                    <p className="feed-wall">
                      {guestWall} <a href="/signin?next=%2Ffeed">Sign in</a>
                    </p>
                  )}
                  {feedEmpty && (<>
                    <div style={{ border: '1px solid var(--line,#1c3d47)', borderLeft: '3px solid var(--sand,#d9c9a3)', borderRadius: '10px', padding: '1rem 1.5rem', color: 'var(--dim,#a3bcb8)', fontSize: '0.9375rem', maxWidth: '62ch', textWrap: 'pretty' }}>{feedEmptyMessage}</div>
                  </>)}
                </div>
              </section>

              {/*
                The rail, rewritten in classes.

                Every rule here used to be an inline style, which is why the pivot could not reach
                it: an inline gradient and a hardcoded `'Geist Mono'` outrank any stylesheet, so
                this column kept the old design while the rest of the page changed. Classes let the
                theme own it.

                "Built on" is gone from the rail. Five partner logos beside a feed answer a
                question nobody reading posts is asking; they belong on `/security`, which exists to
                say what this is built on.
              */}
              <aside className="rr">
                <section aria-label="Creators">
                  <p className="rr-head">Creators here</p>
                  <div className="rr-list">
                    {(creators ?? []).map((c, i) => (
                      <a key={i} className="rr-person" href={c.href}>
                        <span className="rr-person__mark" aria-hidden>
                          {c.initials}
                        </span>
                        <span className="rr-person__text">
                          <span className="rr-person__name">{c.displayName}</span>
                          <span className="rr-person__meta">{c.meta}</span>
                        </span>
                      </a>
                    ))}
                    <a className="rr-more" href="/explore">
                      {creatorCount}
                    </a>
                  </div>
                </section>
              </aside>
            </div>
          </div>
    </>
  );
}
