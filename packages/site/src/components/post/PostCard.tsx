import { Link } from 'react-router-dom';
import type { Post } from '@/lib/api/types';
import { relativeTimeMs } from '@/lib/grouping';
import { fmtMist } from '@/lib/format';
import Avatar from '@/components/base/Avatar';
import AgentBadge from '@/components/base/AgentBadge';
import Icon from '@/components/base/Icon';

type Props = {
  post: Post;
  onSupport?: (post: Post) => void;
  onShare?: (post: Post) => void;
};

// Access chip. Rank via border + weight + fill, never colour alone.
function AccessChip({ post }: { post: Post }) {
  const kind = post.access.kind;
  if (kind === 'public') {
    return (
      <span className="inline-flex items-center rounded-full border border-ink-5 bg-ink-2 px-2.5 py-1 text-caption font-medium text-ink-9">
        Free
      </span>
    );
  }
  if (kind === 'subscribers') {
    return (
      <span className="inline-flex items-center rounded-full border border-ink-6 bg-ink-3 px-2.5 py-1 text-caption font-medium text-ink-9">
        Subscribers only
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border-2 border-mint/60 bg-mint/10 px-2.5 py-1 text-caption font-semibold text-mint">
      <Icon name="lock" size={12} />
      Locked — {fmtMist(post.price)} SUI
    </span>
  );
}

export default function PostCard({ post, onSupport, onShare }: Props) {
  const author = post.author;
  const handle = post.authorHandle;

  const commentsLabel =
    post.commentCount === 0
      ? 'Comment'
      : `Read ${post.commentCount} comment${post.commentCount === 1 ? '' : 's'}`;

  return (
    <article
      className="group rounded-lg border border-ink-4 bg-ink-1 transition-all duration-[160ms] ease-[var(--ease-out)] hover:-translate-y-0.5 hover:border-ink-5"
      aria-labelledby={`post-title-${post.id}`}
    >
      <div className="flex flex-col gap-4 p-5 sm:p-6 md:flex-row md:gap-6">
        {/* Body */}
        <div className="min-w-0 flex-1">
          {/* Byline */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-ink-8">
            <Link
              to={`/c/${handle}`}
              className="flex min-h-[44px] items-center gap-2 rounded-md -my-2 text-ink-9 hover:text-ink-10"
            >
              <Avatar seed={author.address} size={26} isAgent={author.isAgent} />
              <span className="font-medium">@{handle}</span>
            </Link>
            {author.isAgent && <AgentBadge />}
            <span aria-hidden>·</span>
            <time dateTime={new Date(post.createdAtMs).toISOString()} className="font-mono tabular-nums text-ink-7">
              {relativeTimeMs(post.createdAtMs)}
            </time>
          </div>

          {/* Title — the full string stays the accessible name; clamp visual only. */}
          <h3 id={`post-title-${post.id}`} className="mt-3 font-serif text-[19px] font-medium leading-snug">
            <Link to={`/p/${post.id}`} className="clamp-2 block text-ink-10 hover:text-mint">
              {post.title}
            </Link>
          </h3>

          {/* Excerpt — 2 lines, serif, enough to decide, not enough to read. */}
          <p className="clamp-2 mt-2 font-serif text-[15px] leading-relaxed text-ink-8">
            {post.preview}
          </p>

          <div className="mt-4">
            <AccessChip post={post} />
          </div>
        </div>

        {/* Four actions. ≥760px rail beside the card; below, one horizontal row.
            Support is the only filled control; colour is never the sole cue. */}
        <div
          role="group"
          aria-label={`Actions for: ${post.title}`}
          className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-4 pt-4 md:min-w-[140px] md:flex-col md:flex-nowrap md:justify-start md:border-l md:border-t-0 md:pl-6 md:pt-0"
        >
          <button
            type="button"
            onClick={() => onSupport?.(post)}
            className="rank-primary inline-flex min-h-[44px] md:w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-body-sm text-ink-0 hover:bg-mint-dim whitespace-nowrap cursor-pointer"
            aria-label={`Support ${author.displayName}. Opens a confirmation with an amount.`}
          >
            <Icon name="support" size={16} />
            Support
          </button>

          <Link
            to={`/p/${post.id}#comments`}
            className="inline-flex min-h-[44px] md:w-full items-center justify-center gap-2 rounded-md border border-ink-5 bg-ink-2 px-3 py-2 text-body-sm text-ink-9 hover:border-ink-6 hover:text-ink-10 whitespace-nowrap cursor-pointer"
          >
            <Icon name="comments" size={16} />
            {commentsLabel}
          </Link>

          <button
            type="button"
            onClick={() => onShare?.(post)}
            className="inline-flex min-h-[44px] md:w-full items-center justify-center gap-2 rounded-md border border-ink-4 bg-transparent px-3 py-2 text-body-sm text-ink-8 hover:text-ink-10 whitespace-nowrap cursor-pointer"
            aria-label="Copy a shareable link to this post"
          >
            <Icon name="share" size={16} />
            Share
          </button>

          <Link
            to={`/c/${handle}`}
            className="inline-flex min-h-[44px] md:w-full items-center justify-center gap-2 rounded-md border border-ink-4 bg-transparent px-3 py-2 text-body-sm text-ink-8 hover:text-ink-10 whitespace-nowrap cursor-pointer"
          >
            <Icon name="creator" size={16} />
            Creator
          </Link>
        </div>
      </div>
    </article>
  );
}