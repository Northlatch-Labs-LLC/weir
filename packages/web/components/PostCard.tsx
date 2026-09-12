// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import type { VisiblePost } from '@/lib/content';

import { UnlockButton } from '@/components/UnlockButton';
import { PostBody } from '@/components/PostBody';
import { Comments } from './Comments';
import { PostActions } from '@/components/PostActions';
import { EntityType, type Entity } from '@/components/EntityType';
import { SealedMedia } from '@/components/SealedMedia';
import { SealedBody } from '@/components/SealedBody';
import { AGENT_PILL_TITLE } from '@/components/design/ExploreFunnel';

/**
 * One entry in a feed, as a card is given it: the post plus what the viewer's session adds.
 *
 * Every list that renders PostCard builds an array of these, so the shape lives beside the card
 * that reads it.
 */
export interface FeedPost {
  post: VisiblePost;
  price?: string;
  reader?: string;
  entities?: Entity[];
  authorIsAgent?: boolean;
}

function badgeClass(post: VisiblePost): string {
  switch (post.access.kind) {
    case 'paid':
      return 'pill paid';
    case 'subscribers':
      return 'pill subs';
    default:
      return 'pill free';
  }
}

function badgeLabel(post: VisiblePost, price?: string): string {
  switch (post.access.kind) {
    case 'paid':
      if (!post.locked) return 'Unlocked';
      return price === undefined ? 'Locked' : `Locked · ${price}`;
    case 'subscribers': {
      const tier = post.access.tier;
      const who = tier > 0 ? `Tier ${tier + 1} subscribers` : 'Subscribers';
      return post.locked ? `${who} only` : who;
    }
    default:
      return 'Free';
  }
}

export function PostCard({
  post,
  price,
  reader,
  entities,
  authorIsAgent,
}: {
  entities?: Entity[];
  authorIsAgent?: boolean;
  post: VisiblePost;
  price?: string;
  reader?: string;
}) {
  const initial = post.authorHandle.slice(0, 2);

  return (
    <article className="card card--railed">
      <div className="card__main">
      <div className="byline">
        <span className="avatar" aria-hidden>
          {initial}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <a className="byline-name" href={`/c/${post.authorHandle}${reader === undefined ? '' : `?reader=${reader}`}`}>
            @{post.authorHandle}
          </a>
          {(entities ?? []).map((entity) => (
            <EntityType key={entity} entity={entity} />
          ))}
          <div className="byline-meta">
            {new Date(post.createdAtMs).toLocaleDateString('en-US', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              timeZone: 'UTC',
            })}
          </div>
        </div>
        {authorIsAgent === true && (
          <span className="pill" title={AGENT_PILL_TITLE}>
            Agent
          </span>
        )}
        <span className={badgeClass(post)}>{badgeLabel(post, price)}</span>
      </div>

      <h3 className="post-title">{post.title}</h3>

      {post.assetIds !== undefined && post.assetIds.length > 0 && (
        <div className="media-grid">
          {post.assetIds.map((assetId) => {
            const href = `/api/media/${post.id}/${assetId}${reader === undefined ? '' : `?reader=${reader}`}`;

            return <SealedMedia key={assetId} className="post-media" src={href} />;
          })}
        </div>
      )}

      <p className="post-preview">{post.preview}</p>

      {post.edition === 'machine-absent' && (
        <p className="unmeasured">
          Your Unlock is for the machine edition of this post, and this post was published before
          machine editions were sealed. Its words were never sealed to that key; only the creator
          can republish it.
        </p>
      )}
      {post.sealedBody !== undefined && post.access.kind !== 'public' ? (
        <SealedBody
          sealed={post.sealedBody}
          preview={post.preview}
          vaultId={post.vaultId}
          {...(post.access.kind === 'paid' ? { contentKey: post.access.contentKey } : {})}
          {...(post.approver === undefined ? {} : { approver: post.approver })}
        />
      ) : (
        post.body !== undefined && post.body !== '' &&
          <PostBody body={post.body} preview={post.preview} />
      )}

      {post.locked && (
        <div className="locked">
          <div className="locked-lines" aria-hidden>
            <i /><i /><i /><i />
          </div>
          <div className="locked-cta">
            <div>
              <div className="locked-price">
                {post.unlockWith === 'subscribe' ? 'Subscribers' : (price ?? 'Price not read')}
                {post.unlockWith !== 'subscribe' && <small>one payment</small>}
              </div>
              <p className="locked-why">
                {post.unlockWith === 'subscribe'
                  ? 'Included with a subscription to this creator.'
                  : 'Yours permanently. The Unlock is an object in your wallet.'}
              </p>
            </div>
            {post.unlockWith === 'subscribe' || post.access.kind !== 'paid' ? (
              <a
                className="btn"
                href={`/c/${post.authorHandle}${reader === undefined ? '' : `?reader=${reader}`}`}
              >
                See tiers
              </a>
            ) : (
              <UnlockButton
                vaultId={post.vaultId}
                contentKey={post.access.contentKey}
                expectedPrice={post.access.price}
                priceLabel={price ?? 'the listed price'}
              />
            )}
          </div>
        </div>
      )}

        {!post.locked && (
          <div id={`comments-${post.id}`}>
            <Comments postId={post.id} reader={reader} count={post.commentCount} />
          </div>
        )}
      </div>

      <PostActions
        postId={post.id}
        authorHandle={post.authorHandle}
        reader={reader}
        showComments={!post.locked}
      />
    </article>
  );
}
