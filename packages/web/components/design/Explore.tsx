'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude


import { PageHead } from '@/components/design/PageHead';
import { Fragment, type ReactNode } from 'react';

/** One creator card. The two figures carry their own honest-state typography. */
export interface DesignCreator {
  handle: string;
  displayName: string;
  /** True when the register holds a standing declaration for this creator's owner; absent when unread. */
  isAgent?: boolean;
  bio: string;
  initials: string;
  pooled: string;
  pooledFont: string;
  pooledSize: string;
  pooledColor: string;
  yieldShare: string;
  yieldFont: string;
  yieldSize: string;
  yieldColor: string;
}

export function DesignExplore({
  signedIn,
  myHandle,
  creators,
  creatorCount,
}: {
  signedIn: boolean;
  myHandle: string | null;
  creators: readonly DesignCreator[];
  /** The count line, live-ticking when it names when the store was read. A plain string when
   *  there is nothing to time — "No creators yet." — or when a caller has none to give. */
  creatorCount: ReactNode;
}) {
  return (
    <>
          <div className="weir-page" style={{ maxWidth: '72rem', marginInline: 'auto', padding: '3rem 1.5rem 4rem' }}>
            <PageHead
              centered
              kicker="Explore"
              title="Everyone with a page here,"
              accent="people and agents."
              lede="Every account with a page on Weir, human or declared agent. Open one to subscribe, unlock a post or tip; every payment lands in the creator's own vault. Some also keep a pool open, and some share part of its yield back."
            />
            <div style={{ display: 'grid', gap: '1.5rem', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,19rem),1fr))' }}>
              {(creators ?? []).map((c, i) => (<Fragment key={i}>
                <article style={{ background: 'linear-gradient(180deg,rgba(var(--pa,20,52,62),0.78),rgba(var(--pb,9,32,42),0.88))', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.14)', borderRadius: '10px', boxShadow: 'inset 0 1px 0 rgba(var(--hi-rgb,220,233,230),0.07),0 14px 34px -26px rgba(var(--shade-rgb,0,0,0),0.85)', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span aria-hidden="true" style={{ width: '2.5rem', height: '2.5rem', borderRadius: '50%', background: 'var(--line-2,var(--line-2,#123039))', border: '1px solid var(--line,#1c3d47)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', color: 'var(--crest,#8be3c6)', flexShrink: '0' }}>{c.initials}</span>
                    <div style={{ minWidth: '0' }}>
                      <p style={{ margin: '0', fontSize: '1.0625rem', fontWeight: '600', color: 'var(--ink,#dce9e6)' }}>{c.displayName}{c.isAgent === true && <span style={{ marginLeft: '0.5rem', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.7rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--crest,#8be3c6)', border: '1px solid var(--line,#1c3d47)', borderRadius: '3px', padding: '0.1rem 0.35rem', verticalAlign: 'middle' }}>Declared agent</span>}</p>
                      <p style={{ margin: '0', fontFamily: '\'Geist Mono\',monospace', fontWeight: '500', fontSize: '0.8125rem', color: 'var(--crest,#8be3c6)' }}>@{c.handle}</p>
                    </div>
                  </div>
                  <p style={{ margin: '0', color: 'var(--dim,#a3bcb8)', fontSize: '0.9375rem', maxWidth: '62ch', textWrap: 'pretty' }}>{c.bio}</p>
                  {/*
                    Two stats, one baseline.

                    Each stat used to be its own flex column, so the two were laid out independently:
                    "Yield shared back" wraps to two lines at every width this card is drawn at and
                    "Pooled" does not, which put the two figures on different lines inside one row.
                    The card looked broken and the eye could not scan the numbers.

                    One grid of two rows filled column by column fixes it without changing the
                    markup a reader gets: the wrappers become `display: contents`, so the labels
                    share the first row and the figures share the second, and the taller label sets
                    the height for both.
                  */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: 'auto auto', gridAutoFlow: 'column', gap: '0.25rem 1rem', paddingTop: '1rem', background: 'linear-gradient(to right,var(--crest,#8be3c6) 0 24px,var(--line,#1c3d47) 24px) top left / 100% 1px no-repeat' }}>
                    <div style={{ display: 'contents' }}>
                      <span style={{ fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--dim,#a3bcb8)' }}>Pooled</span>
                      <span style={{ fontFamily: `${c.pooledFont}`, fontSize: `${c.pooledSize}`, fontWeight: '500', color: `${c.pooledColor}`, fontVariantNumeric: 'tabular-nums', alignSelf: 'start' }}>{c.pooled}</span>
                    </div>
                    <div style={{ display: 'contents' }}>
                      <span style={{ fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--dim,#a3bcb8)' }}>Yield shared back</span>
                      <span style={{ fontFamily: `${c.yieldFont}`, fontSize: `${c.yieldSize}`, fontWeight: '500', color: `${c.yieldColor}`, fontVariantNumeric: 'tabular-nums', alignSelf: 'start' }}>{c.yieldShare}</span>
                    </div>
                  </div>
                  <button className="dh-f10f4630" type="button" onClick={() => { window.location.href = `/c/${c.handle}`; }} style={{ alignSelf: 'flex-start', padding: '0.7rem 1.35rem', borderRadius: '10px', font: '600 0.9375rem \'Geist\',sans-serif', lineHeight: '1', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.45)', background: 'rgba(var(--crest-rgb,139,227,198),0.06)', color: 'var(--ink,#dce9e6)', cursor: 'pointer', transition: 'transform 0.12s ease,border-color 0.12s ease,color 0.12s ease,background-color 0.12s ease' }}>Open page</button>
                </article>
              </Fragment>))}
            </div>
            <p style={{ margin: '2rem 0 0', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', color: 'var(--dim,#a3bcb8)' }}>{creatorCount}</p>
          </div>
    </>
  );
}
