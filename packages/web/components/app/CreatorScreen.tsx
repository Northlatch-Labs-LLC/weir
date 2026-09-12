'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import type { ReactNode } from 'react';
import NextLink from 'next/link';
import { Avatar, AgentBadge, Icon, ColumnHeader, PostCard, EmptyState, VaultSigil, type PostView } from '@projectx-social/ui';
import { AppFrame } from '@/components/app/AppFrame';

export type CreatorTab = 'posts' | 'membership';

export type CreatorFigure = {
  label: string;
  value: string;
  note: string;
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
  tipNote,
  figuresNote,
  depositSlot,
  depositLine,
  stakeVaultId,
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
    sui: string;
  };
  counts: { posts: number; followers: number; subscribers: number | null };
  figures: readonly CreatorFigure[];
  tiers: readonly CreatorTierView[];
  posts: readonly PostView[];
  followSlot: ReactNode;
  tipSlot?: ReactNode;
  tipNote?: string | null;
  figuresNote?: string | null;
  depositSlot?: ReactNode;
  depositLine?: string | undefined;
  /**
   * The stake vault this page's membership deposits into, when the account has opened one.
   *
   * Only for the sigil. Nothing here reads a balance, and the sigil draws the basin empty rather
   * than at a level nobody measured.
   */
  stakeVaultId?: string | undefined;
  accountName?: string | undefined;
  tab: CreatorTab;
  tabHref: Record<CreatorTab, string>;
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
          {/*
            The vault's own face, drawn from its object id.

            A sigil is the one mark on this page that could not belong to any other account: two
            vaults cannot share an id, so they cannot share a sigil, and a reader can check it
            against an explorer. The basin draws empty — this page does not read the balance, and a
            full-looking basin over an unread balance would be a claim about somebody's money.
          */}
          <div className="w-member__head">
            {stakeVaultId === undefined ? null : <VaultSigil vaultId={stakeVaultId} size={40} />}
            <h3 style={{ color: 'var(--w-mint)' }}>Become a member</h3>
          </div>
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
        back={{ href: '/explore', label: 'Explore' }}
        Link={({ href, children, ...rest }) => (
          <NextLink href={href} {...rest}>
            {children}
          </NextLink>
        )}
      />

      <div style={{ height: 150, background: 'var(--w-raised)', borderBottom: '1px solid var(--w-line)', position: 'relative' }} aria-hidden>
        <svg width="100%" height="150" viewBox="0 0 640 150" preserveAspectRatio="none">
          <defs>
            <pattern id="w-bnr" width="30" height="30" patternUnits="userSpaceOnUse">
              <path d="M30 0H0v30" fill="none" stroke="rgba(89,99,124,0.2)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="640" height="150" fill="var(--w-raised)" />
          <rect width="640" height="150" fill="url(#w-bnr)" />
          <circle cx="120" cy="150" r="120" fill="rgba(95,214,164,0.08)" />
          <circle cx="520" cy="20" r="130" fill="rgba(169,139,250,0.06)" />
        </svg>
      </div>

      <div style={{ padding: '0 22px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: -40, gap: 12, flexWrap: 'wrap' }}>
          <span style={{ border: '4px solid var(--w-ground)', borderRadius: 999, lineHeight: 0, position: 'relative', zIndex: 1 }}>
            <Avatar address={profile.address} isAgent={profile.isAgent} size={92} />
          </span>
          <span style={{ display: 'flex', gap: 10, paddingBottom: 6, flexWrap: 'wrap' }}>
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
            <b className="w-mono" style={{ color: 'var(--w-ink-10)', fontWeight: 600 }}>
              {counts.subscribers === null ? '—' : counts.subscribers}
            </b>{' '}
            subscribers
          </span>
        </div>

        {tipSlot === undefined ? null : (
          <div style={{ maxWidth: '34rem', marginBottom: 16 }}>{tipSlot}</div>
        )}

        {tipNote === null || tipNote === undefined ? null : (
          <p style={{ margin: '0 0 12px', maxWidth: '56ch', fontFamily: 'var(--w-sans)', fontSize: 13.5, lineHeight: 1.6, color: 'var(--w-ink-7)' }}>
            {tipNote}
          </p>
        )}

        {figures.length === 0 ? (
          figuresNote === null || figuresNote === undefined ? null : (
            <p style={{ margin: '0 0 20px', maxWidth: '56ch', fontFamily: 'var(--w-sans)', fontSize: 13.5, lineHeight: 1.6, color: 'var(--w-ink-7)' }}>
              {figuresNote}
            </p>
          )
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 9.5rem), 1fr))', gap: 12, marginBottom: 20 }}>
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
        )}
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
                  <span className="w-mono" style={{ fontSize: 19, fontWeight: 600, color: t.price === 'reading from the chain' ? 'var(--w-rose)' : 'var(--w-ink-10)' }}>
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
