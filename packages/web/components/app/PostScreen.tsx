'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useState } from 'react';
import NextLink from 'next/link';
import { Avatar, AgentBadge, Icon, ColumnHeader } from '@projectx-social/ui';
import { AppFrame } from '@/components/app/AppFrame';
import { UnlockDialog } from '@/components/app/UnlockDialog';
import { Comments } from '@/components/Comments';
import { SealedBody } from '@/components/SealedBody';
import type { VisiblePost } from '@/lib/content';

export function PostScreen({
  post,
  author,
  when,
  whenISO,
  price,
  unlock,
  viewerAddress,
  viewerHandle,
  reader,
  commentCount,
  coinType,
}: {
  post: VisiblePost;
  author: { handle: string; displayName: string; address: string; isAgent: boolean; bio: string };
  when: string;
  whenISO: string;
  price: string | null;
  unlock?: { vaultId: string; contentKey: string; expectedPrice: string } | undefined;
  viewerAddress: string | null;
  viewerHandle: string | null;
  reader?: string | undefined;
  commentCount: number;
  coinType?: string | null | undefined;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const viewer =
    viewerAddress === null
      ? ({ signedIn: false } as const)
      : ({ signedIn: true, address: viewerAddress, handle: viewerHandle, displayName: viewerHandle } as const);

  const locked = post.locked;
  const paid = post.unlockWith === 'purchase';

  const aside = (
    <>
      <section className="w-card">
        <h3>{author.displayName}</h3>
        <p>{author.bio === '' ? 'No description yet.' : author.bio}</p>
        <div className="w-card__row">
          <Avatar address={author.address} isAgent={author.isAgent} size={38} />
          <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <NextLink href={`/c/${author.handle}`} className="w-name" style={{ fontSize: 14 }}>
              {author.displayName}
            </NextLink>
            <span style={{ fontFamily: 'var(--w-mono)', fontSize: 12, color: 'var(--w-ink-7)' }}>
              @{author.handle}
            </span>
          </span>
          <NextLink href={`/c/${author.handle}`} className="w-btn w-btn--quiet w-btn--sm" style={{ marginLeft: 'auto' }}>
            Open
          </NextLink>
        </div>
      </section>
    </>
  );

  return (
    <AppFrame viewer={viewer} reader={reader} aside={aside}>
      <ColumnHeader
        title="Post"
        back={{ href: `/c/${author.handle}`, label: author.displayName }}
        Link={({ href, children, ...rest }) => (
          <NextLink href={href} {...rest}>
            {children}
          </NextLink>
        )}
      />

      <article style={{ padding: '20px 22px 4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <NextLink href={`/c/${author.handle}`} aria-label={author.displayName}>
            <Avatar address={author.address} isAgent={author.isAgent} size={48} />
          </NextLink>
          <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <NextLink href={`/c/${author.handle}`} className="w-name" style={{ fontSize: 16 }}>
                {author.displayName}
              </NextLink>
              {author.isAgent ? <AgentBadge /> : null}
            </span>
            <span style={{ fontFamily: 'var(--w-mono)', fontSize: 13, color: 'var(--w-ink-7)' }}>
              @{author.handle} · <time dateTime={whenISO}>{when}</time>
            </span>
          </span>
          <NextLink href={`/c/${author.handle}`} className="w-btn w-btn--quiet w-btn--sm" style={{ marginLeft: 'auto' }}>
            Open page
          </NextLink>
        </div>

        <h2
          style={{
            margin: '18px 0 10px',
            fontFamily: 'var(--w-serif)',
            fontSize: 30,
            fontWeight: 600,
            lineHeight: 1.22,
            color: 'var(--w-ink-10)',
            textWrap: 'pretty',
          }}
        >
          {post.title}
        </h2>

        <p
          style={{
            margin: '0 0 16px',
            fontFamily: 'var(--w-serif)',
            fontSize: 19,
            lineHeight: 1.65,
            color: 'var(--w-ink-9)',
            maxWidth: '62ch',
          }}
        >
          {post.preview}
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          {locked ? (
            <span className="w-chip w-chip--money">{price ?? 'Locked'}</span>
          ) : paid || post.unlockWith === 'subscribe' ? (
            <span className="w-chip w-chip--money">
              <Icon name="check" size={16} strokeWidth={2} /> Unlocked
            </span>
          ) : (
            <span className="w-chip">FREE</span>
          )}
        </div>
      </article>

      {locked ? (
        <div
          style={{
            margin: '0 22px 18px',
            border: '1px solid var(--w-line-strong)',
            borderRadius: 16,
            background: 'var(--w-raised)',
            padding: '34px 24px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 13,
          }}
        >
          <span style={{ color: 'var(--w-ink-6)' }}>
            <Icon name="lock" size={28} strokeWidth={1.5} />
          </span>
          <p
            style={{
              margin: 0,
              maxWidth: '42ch',
              textAlign: 'center',
              fontFamily: 'var(--w-sans)',
              fontSize: 14,
              lineHeight: 1.6,
              color: 'var(--w-ink-7)',
            }}
          >
            {post.unlockWith === 'subscribe'
              ? `The rest of this post opens for ${author.displayName}'s subscribers.`
              : 'The rest of this post is encrypted. The key releases to your wallet the moment you unlock.'}
          </p>
          {post.unlockWith === 'subscribe' ? (
            <NextLink href={`/c/${author.handle}`} className="w-btn w-btn--primary">
              See the tiers
            </NextLink>
          ) : unlock === undefined || price === null ? (
            <p className="w-unread" style={{ margin: 0, fontSize: 14 }}>
              The price is being read from the chain. It appears here the moment the chain answers.
            </p>
          ) : (
            <button type="button" className="w-btn w-btn--primary" onClick={() => setDialogOpen(true)}>
              Unlock · {price}
            </button>
          )}
        </div>
      ) : (
        <div style={{ padding: '0 22px 20px' }}>
          {post.sealedBody === undefined ? (
            <div
              style={{
                fontFamily: 'var(--w-serif)',
                fontSize: 19,
                lineHeight: 1.65,
                color: 'var(--w-ink-9)',
                maxWidth: '68ch',
                whiteSpace: 'pre-wrap',
              }}
            >
              {post.body}
            </div>
          ) : (
            <SealedBody
              sealed={post.sealedBody}
              preview={post.preview}
              vaultId={post.vaultId}
              coinType={coinType ?? null}
              {...(post.access.kind === 'paid' ? { contentKey: post.access.contentKey } : {})}
              {...(post.approver === undefined ? {} : { approver: post.approver })}
            />
          )}
        </div>
      )}

      <div id="comments" style={{ borderTop: '1px solid var(--w-line)', padding: '4px 22px 24px' }}>
        <Comments postId={post.id} count={commentCount} {...(reader === undefined ? {} : { reader })} />
      </div>

      {dialogOpen && unlock !== undefined && price !== null ? (
        <UnlockDialog
          vaultId={unlock.vaultId}
          contentKey={unlock.contentKey}
          expectedPrice={unlock.expectedPrice}
          priceLabel={price}
          creatorHandle={author.handle}
          creatorName={author.displayName}
          creatorAddress={author.address}
          creatorIsAgent={author.isAgent}
          onClose={() => setDialogOpen(false)}
        />
      ) : null}
    </AppFrame>
  );
}
