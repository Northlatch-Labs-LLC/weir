'use client';
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude


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
                <PageHead
              centered
                  kicker="Feed"
                  title="What's new"
                  accent="above the waterline."
                  lede="Posts from the creators here. A paid post opens when your wallet holds the unlock or the subscription for it."
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

              <aside style={{ display: 'grid', alignContent: 'start', gap: '2.5rem' }}>
                <section aria-label="Creators">
                  <p style={{ margin: '0 0 0.75rem', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', fontWeight: '500', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--sand,#d9c9a3)' }}>Pool behind someone</p>
                  <div style={{ display: 'grid', gap: '0.75rem' }}>
                    {(creators ?? []).map((c, i) => (<Fragment key={i}>
                      <a className="dh-cc3e1ebd" href={c.href} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'linear-gradient(180deg,rgba(var(--pa,20,52,62),0.78),rgba(var(--pb,9,32,42),0.88))', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.14)', borderRadius: '10px', boxShadow: 'inset 0 1px 0 rgba(var(--hi-rgb,220,233,230),0.07),0 14px 34px -26px rgba(var(--shade-rgb,0,0,0),0.85)', padding: '0.875rem 1rem', textDecoration: 'none', transition: 'border-color 0.12s ease,transform 0.12s ease' }}>
                        <span aria-hidden="true" style={{ width: '2.25rem', height: '2.25rem', borderRadius: '50%', background: 'var(--line-2,var(--line-2,#123039))', border: '1px solid var(--line,#1c3d47)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.75rem', color: 'var(--crest,#8be3c6)', flexShrink: '0' }}>{c.initials}</span>
                        <span style={{ minWidth: '0' }}>
                          <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.9375rem', fontWeight: '600', color: 'var(--ink,#dce9e6)' }}>{c.displayName}</span>
                          <span style={{ display: 'block', fontFamily: '\'Geist Mono\',monospace', fontVariantNumeric: 'tabular-nums', fontSize: '0.8125rem', color: 'var(--dim,#a3bcb8)' }}>{c.meta}</span>
                        </span>
                      </a>
                    </Fragment>))}
                    <a href="/explore" style={{ fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', color: 'var(--crest,#8be3c6)' }}>{creatorCount}</a>
                  </div>
                </section>

                <section aria-label="Built on">
                  <p style={{ margin: '0 0 0.75rem', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', fontWeight: '500', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--sand,#d9c9a3)' }}>Built on</p>
                  <ul style={{ margin: '0', padding: '0', listStyle: 'none', display: 'grid', gap: '0.5rem' }}>
                    {(builtOn ?? []).map((item, i) => (<Fragment key={i}>
                      <li style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}><span aria-hidden="true" style={{ flex: '0 0 auto', width: '1.6rem', height: '1.6rem', borderRadius: '7px', background: 'linear-gradient(180deg,rgba(var(--pa,20,52,62),0.95),rgba(var(--pb,9,32,42),0.95))', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.28)', boxShadow: 'inset 0 1px 0 rgba(var(--hi-rgb,220,233,230),0.09),0 0 12px -6px rgba(var(--crest-rgb,139,227,198),0.7)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.6875rem', fontWeight: '500', letterSpacing: '0.02em', color: 'var(--crest,#8be3c6)' }}>{item.logo !== undefined ? <img src={item.logo} alt="" width={20} height={20} style={{ width: '1.25rem', height: '1.25rem', objectFit: 'contain' }} /> : item.mark}</span><a href={item.href} style={{ fontSize: '0.9375rem', fontWeight: '600', color: 'var(--ink,#dce9e6)' }}>{item.name}</a><span style={{ fontSize: '0.8125rem', color: 'var(--dim,#a3bcb8)' }}>{item.note}</span></li>
                    </Fragment>))}
                  </ul>
                </section>
              </aside>
            </div>
          </div>
    </>
  );
}
