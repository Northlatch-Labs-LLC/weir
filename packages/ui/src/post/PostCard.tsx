// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * A post, and the one place its access is drawn.
 *
 * # The rule that has already cost this product once
 *
 * The access marker states the POST's price — never the reader's relationship to it. A badge that
 * read `locked ? price : 'Free'` showed a buyer the word "Free" on a post they had just paid for,
 * because the reader's entitlement had been substituted for the post's terms. `access` here is a
 * fact about the post; `unlocked` is a separate fact about the reader, and the two are rendered
 * separately on purpose.
 *
 * # Media reserves its box
 *
 * Everything visual carries its shape before its bytes: a locked post's panel occupies what the
 * hidden media would occupy, and an image sits in a fixed aspect box. A feed that reflows as
 * pictures land is a feed people lose their place in.
 */

import type { ComponentType, CSSProperties, ReactNode } from 'react';
import { Avatar, AgentBadge } from '../base/Avatar';
import { Icon } from '../base/Icon';
import type { LinkComponent } from '../layout/AppShell';

export type PostAccess =
  | { kind: 'free' }
  | { kind: 'paid'; price: string | null }
  | { kind: 'subscribers'; tier: string | null };

export type PostAuthor = {
  address: string;
  handle: string;
  displayName: string;
  isAgent: boolean;
  avatarUrl?: string | null;
};

export type PostView = {
  id: string;
  author: PostAuthor;
  /** Already formatted for display; formatting lives in one place, not in a card. */
  when: string;
  whenISO?: string;
  title?: string | null;
  /** For a gated post this is the free lede, which is all that ever reaches the browser. */
  body: string;
  access: PostAccess;
  /** True when this reader holds it. A fact about the reader, never merged into `access`. */
  unlocked?: boolean;
  lockedAssets?: number;
  media?: ReadonlyArray<{ url: string; alt: string; width: number; height: number }>;
  comments: number;
  /**
   * How many people have supported this post.
   *
   * Optional because the store does not count it yet, and a control that prints `0` for something
   * nobody counted is the same defect as a zero standing in for an unread figure. Absent means the
   * action carries no number — never that the number is zero.
   */
  supporters?: number | undefined;
  /** Why this post is in front of this reader, when there is a reason worth stating. */
  context?: string | null;
};

function AccessChip({ access, unlocked }: { access: PostAccess; unlocked: boolean }) {
  if (unlocked) {
    return (
      <span className="w-chip w-chip--money">
        <Icon name="check" size={16} strokeWidth={2} /> Unlocked
      </span>
    );
  }
  if (access.kind === 'free') return <span className="w-chip">FREE</span>;
  if (access.kind === 'subscribers') {
    return <span className="w-chip w-chip--money">{access.tier ?? 'Subscribers'}</span>;
  }
  // A price we could not read is never rendered as a number, and never as free.
  return <span className="w-chip w-chip--money">{access.price ?? 'Locked'}</span>;
}

export function PostCard({
  post,
  Link,
  Image,
  onSupport,
  onUnlock,
  onShare,
}: {
  post: PostView;
  Link: LinkComponent;
  Image?: ComponentType<{ src: string; alt: string; width: number; height: number; style?: CSSProperties }> | undefined;
  onSupport?: ((post: PostView) => void) | undefined;
  onUnlock?: ((post: PostView) => void) | undefined;
  onShare?: ((post: PostView) => void) | undefined;
}) {
  const { author, access } = post;
  const locked = !post.unlocked && access.kind !== 'free';

  let bodyRegion: ReactNode = null;
  if (locked) {
    bodyRegion = (
      <div className="w-locked">
        {/*
          What is behind the panel, stated once, in a line.

          The panel used to be an icon over a button in a tall centred column and said nothing at
          all — the reader had to infer from a padlock what kind of gate this was. It says which
          gate, and how many pictures are behind it when there are any, in the space the padlock
          alone used to take.
        */}
        <span className="w-locked__what">
          <Icon name="lock" size={20} strokeWidth={1.6} />
          <span>
            {access.kind === 'paid' ? 'Bought once, kept for good.' : 'For subscribers.'}
            {post.lockedAssets !== undefined && post.lockedAssets > 0
              ? ` ${post.lockedAssets} ${post.lockedAssets === 1 ? 'image' : 'images'} inside.`
              : ''}
          </span>
        </span>
        {access.kind === 'paid' ? (
          <button
            type="button"
            className="w-btn w-btn--primary"
            style={{ minHeight: 40 }}
            onClick={onUnlock === undefined ? undefined : () => onUnlock(post)}
            disabled={access.price === null}
          >
            {access.price === null ? 'Not priced yet' : `Unlock · ${access.price}`}
          </button>
        ) : (
          <button
            type="button"
            className="w-btn w-btn--primary"
            style={{ minHeight: 40 }}
            onClick={onSupport === undefined ? undefined : () => onSupport(post)}
          >
            {access.tier === null ? 'Subscribe' : `Subscribe · ${access.tier}`}
          </button>
        )}
      </div>
    );
  } else if (post.media !== undefined && post.media.length > 0) {
    const first = post.media[0]!;
    bodyRegion = (
      <div className="w-media">
        {Image === undefined ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={first.url} alt={first.alt} width={first.width} height={first.height} />
        ) : (
          <Image src={first.url} alt={first.alt} width={first.width} height={first.height} />
        )}
      </div>
    );
  }

  return (
    <article className="w-post" aria-labelledby={`post-${post.id}`}>
      {post.context === undefined || post.context === null ? null : (
        <p className="w-post__context">
          <Icon name="support" size={16} strokeWidth={1.7} />
          <span>{post.context}</span>
        </p>
      )}

      <div className="w-post__row">
        <Link href={`/c/${author.handle}`} aria-label={author.displayName}>
          <Avatar address={author.address} src={author.avatarUrl} isAgent={author.isAgent} size={44} />
        </Link>

        <div className="w-post__body">
          <div className="w-post__byline">
            <Link href={`/c/${author.handle}`} className="w-name">
              {author.displayName}
            </Link>
            {author.isAgent ? <AgentBadge /> : null}
            <Link href={`/c/${author.handle}`} className="w-handle">
              @{author.handle}
            </Link>
            <span style={{ color: 'var(--w-ink-6)' }}>·</span>
            <Link href={`/p/${post.id}`} className="w-handle">
              <time dateTime={post.whenISO}>{post.when}</time>
            </Link>
            <span style={{ marginLeft: 'auto' }}>
              <AccessChip access={access} unlocked={post.unlocked === true} />
            </span>
          </div>

          {post.title === undefined || post.title === null ? null : (
            <h2 id={`post-${post.id}`} className="w-post__title">
              <Link href={`/p/${post.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                {post.title}
              </Link>
            </h2>
          )}
          {post.body === '' ? null : <p className="w-post__text">{post.body}</p>}

          {bodyRegion}

          <div className="w-actions">
            <Link href={`/p/${post.id}#comments`} className="w-action">
              <Icon name="comment" size={18} />
              <span className="w-action__count">{post.comments}</span>
              <span className="w-vh">comments</span>
            </Link>
            <button
              type="button"
              className="w-action w-action--money"
              onClick={onSupport === undefined ? undefined : () => onSupport(post)}
            >
              <Icon name="support" size={18} />
              {post.supporters === undefined ? null : (
                <span className="w-action__count">{post.supporters}</span>
              )}
              <span className="w-vh">Support this post</span>
            </button>
            <button
              type="button"
              className="w-action"
              onClick={onShare === undefined ? undefined : () => onShare(post)}
            >
              <Icon name="share" size={18} />
              <span className="w-vh">Share</span>
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
