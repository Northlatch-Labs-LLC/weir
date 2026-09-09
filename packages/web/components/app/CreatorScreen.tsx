'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * A creator's page, in the application frame.
 *
 * # What this does not touch
 *
 * Every control that takes money — subscribe, deposit, tip, follow — arrives as a slot, already
 * built by the page from the vault it read on this request. This component places them; it never
 * decides a price, a tier or a fee. That is the same rule as the unlock dialog and for the same
 * reason: one implementation of a payment, not two.
 *
 * # Figures carry their own honesty
 *
 * `stats` arrive pre-classified by the page: a figure that was read is mono, tabular and full ink;
 * one that could not be read says "not measured" in the body face, in the alert colour, and is
 * never shaped like a number. This renders what it is handed rather than re-deciding, so the
 * distinction cannot be lost in a redesign.
 */

import type { ReactNode } from 'react';
import NextLink from 'next/link';
import { Avatar, AgentBadge, Icon, ColumnHeader, PostCard, EmptyState, type PostView } from '@projectx-social/ui';
import { AppFrame } from '@/components/app/AppFrame';

export type CreatorFigure = {
  label: string;
  value: string;
  note: string;
  /** True when the page could not read it. Never drawn as a number. */
  unread: boolean;
};

export type CreatorTierView = {
  price: string;
  cadence: string;
  net: string;
  held: boolean;
  action: ReactNode;
};

export function CreatorScreen({
  profile,
  counts,
  figures,
  tiers,
  posts,
  followSlot,
  tipSlot,
  depositSlot,
  depositLine,
  accountName,
  tab,
  tabHref,
  viewerAddress,
  viewerHandle,
  reader,
  emptyMessage,
}: {
  profile: {
    handle: string;
    displayName: string;
    bio: string;
    address: string;
    isAgent: boolean;
    /** Their .sui name when they hold one, else the handle — never a guess. */
    sui: string;
  };
  counts: { posts: number; followers: number; subscribers: number | null };
  figures: readonly CreatorFigure[];
  tiers: readonly CreatorTierView[];
  posts: readonly PostView[];
  followSlot: ReactNode;
  tipSlot?: ReactNode;
  depositSlot?: ReactNode;
  depositLine?: string | undefined;
  /**
   * The ACCOUNT behind this page — its reverse-resolved name, or its address.
   *
   * The support vault belongs to the account, not to the page, and one account can publish several
   * pages. Attributing the vault to `profile.displayName` makes each of those pages claim the same
   * on-chain object under a different name, which is the confusion `test/creator-page.test.ts`
   * exists to stop.
   */
  accountName?: string | undefined;
  tab: 'posts' | 'membership';
  tabHref: Record<'posts' | 'membership', string>;
  viewerAddress: string | null;
  viewerHandle: string | null;
  reader?: string | undefined;
  emptyMessage: string;
}) {
  const viewer =
    viewerAddress === null
      ? ({ signedIn: false } as const)
      : ({ signedIn: true, address: viewerAddress, handle: viewerHandle, displayName: viewerHandle } as const);

  const aside = (
    <>
      {depositSlot === undefined ? null : (
        <section className="w-card w-card--money">
          <h3 style={{ color: 'var(--w-mint)' }}>Back this account</h3>
          {accountName === undefined ? null : (
            <p className="w-mono" style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--w-ink-7)' }}>
              {accountName}
            </p>
          )}
          <p style={{ color: 'var(--w-ink-9)' }}>
            {depositLine ??
              'Your SUI stays yours and comes back whenever you ask. It earns while it sits there and the earnings go to the account behind this page. The vault belongs to that account rather than to this page, so it backs every page they publish.'}
          </p>
          {depositSlot}
        </section>
      )}
      <section className="w-card">
        <h3>About</h3>
        <p>{profile.bio === '' ? 'No description yet.' : profile.bio}</p>
        <div className="w-card__row" style={{ justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'var(--w-sans)', fontSize: 13, color: 'var(--w-ink-7)' }}>Name on chain</span>
          <span className="w-mono" style={{ fontSize: 12, color: 'var(--w-ink-9)' }}>
            {profile.sui}
          </span>
        </div>
      </section>
    </>
  );

  return (
    <AppFrame viewer={viewer} reader={reader} aside={aside}>
      <ColumnHeader
        title={profile.displayName}
        sub={counts.followers === 1 ? '1 follower' : `${counts.followers} followers`}
      />

      {/*
        The banner is drawn, not uploaded. A creator page leads with the writing, and a photograph
        behind the name is a second brand fighting the product's own — so this is the same fine
        grid the rest of the application sits on, and nobody has to supply an image to look finished.
      */}
      <div style={{ height: 150, background: 'var(--w-raised)', borderBottom: '1px solid var(--w-line)', position: 'relative' }} aria-hidden>
        <svg width="100%" height="150" viewBox="0 0 640 150" preserveAspectRatio="none">
          <defs>
            <pattern id="w-bnr" width="30" height="30" patternUnits="userSpaceOnUse">
              <path d="M30 0H0v30" fill="none" stroke="rgba(89,99,124,0.2)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="640" height="150" fill="#070c14" />
          <rect width="640" height="150" fill="url(#w-bnr)" />
          <circle cx="120" cy="150" r="120" fill="rgba(95,214,164,0.08)" />
          <circle cx="520" cy="20" r="130" fill="rgba(169,139,250,0.06)" />
        </svg>
      </div>

      <div style={{ padding: '0 22px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: -40, gap: 12, flexWrap: 'wrap' }}>
          {/* Above the banner, which is `position: relative` and would otherwise paint over it. */}
          <span style={{ border: '4px solid var(--w-ground)', borderRadius: 999, lineHeight: 0, position: 'relative', zIndex: 1 }}>
            <Avatar address={profile.address} isAgent={profile.isAgent} size={92} />
          </span>
          <span style={{ display: 'flex', gap: 10, paddingBottom: 6, flexWrap: 'wrap' }}>
            {tipSlot}
            {followSlot}
          </span>
        </div>

        <h2 style={{ margin: '14px 0 2px', display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--w-sans)', fontSize: 23, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--w-ink-10)' }}>
          {profile.displayName}
          {profile.isAgent ? <AgentBadge /> : null}
        </h2>
        <p style={{ margin: '0 0 10px', fontFamily: 'var(--w-mono)', fontSize: 14, color: 'var(--w-ink-7)' }}>
          @{profile.handle}
        </p>
        {profile.bio === '' ? null : (
          <p style={{ margin: '0 0 12px', maxWidth: '56ch', fontFamily: 'var(--w-serif)', fontSize: 17, lineHeight: 1.6, color: 'var(--w-ink-9)' }}>
            {profile.bio}
          </p>
        )}

        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontFamily: 'var(--w-sans)', fontSize: 14, color: 'var(--w-ink-7)', marginBottom: 18 }}>
          <span>
            <b className="w-mono" style={{ color: 'var(--w-ink-10)', fontWeight: 600 }}>{counts.posts}</b> posts
          </span>
          <span>
            <b className="w-mono" style={{ color: 'var(--w-ink-10)', fontWeight: 600 }}>{counts.followers}</b> followers
          </span>
          <span>
            {/* Subscriptions are objects in buyers' wallets, so this server cannot count them. An
                em dash says "not counted"; a zero would say "nobody", which is a different claim. */}
            <b className="w-mono" style={{ color: 'var(--w-ink-10)', fontWeight: 600 }}>
              {counts.subscribers === null ? '—' : counts.subscribers}
            </b>{' '}
            subscribers
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(figures.length, 3)}, minmax(0, 1fr))`, gap: 12, marginBottom: 20 }}>
          {figures.map((f) => (
            <div key={f.label} className="w-card" style={{ padding: '14px 16px' }}>
              <div className="w-figure__label">{f.label}</div>
              {f.unread ? (
                <div className="w-unread" style={{ fontSize: 17 }}>{f.value}</div>
              ) : (
                <div className="w-figure__value" style={{ fontSize: 19 }}>{f.value}</div>
              )}
              <div className="w-figure__note">{f.note}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="w-tabs">
        <NextLink href={tabHref.posts} className="w-tab" aria-current={tab === 'posts' ? 'page' : undefined}>
          <span>Posts</span>
          <span className="w-tab__rule" />
        </NextLink>
        <NextLink href={tabHref.membership} className="w-tab" aria-current={tab === 'membership' ? 'page' : undefined}>
          <span>Membership</span>
          <span className="w-tab__rule" />
        </NextLink>
      </div>

      {tab === 'membership' ? (
        <div style={{ padding: '18px 22px', display: 'grid', gap: 12 }}>
          {tiers.length === 0 ? (
            <EmptyState fact={`${profile.displayName} has no membership open right now.`} />
          ) : (
            tiers.map((t, i) => (
              <div key={`${t.cadence}-${i}`} className="w-card">
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
                  <span className="w-mono" style={{ fontSize: 19, fontWeight: 600, color: t.price === 'not measured' ? 'var(--w-rose)' : 'var(--w-ink-10)' }}>
                    {t.price}
                  </span>
                  {t.held ? (
                    <span className="w-chip w-chip--money">
                      <Icon name="check" size={16} strokeWidth={2} /> Held
                    </span>
                  ) : null}
                </div>
                <p style={{ margin: '0 0 4px', fontFamily: 'var(--w-sans)', fontSize: 14, color: 'var(--w-ink-9)' }}>{t.cadence}</p>
                <p style={{ margin: '0 0 14px', fontFamily: 'var(--w-sans)', fontSize: 13, color: 'var(--w-ink-7)' }}>{t.net}</p>
                {t.action}
              </div>
            ))
          )}
        </div>
      ) : posts.length === 0 ? (
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
    </AppFrame>
  );
}
