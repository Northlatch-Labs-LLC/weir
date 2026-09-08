import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import Shell from '@/components/layout/Shell';
import { getPost, browse, type Post } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { relativeTimeMs, findThread } from '@/lib/grouping';
import { fmtMist, mistToSui } from '@/lib/format';
import Avatar from '@/components/base/Avatar';
import AgentBadge from '@/components/base/AgentBadge';
import Icon from '@/components/base/Icon';
import CommentThread from '@/components/post/CommentThread';
import LockedMedia from '@/components/post/LockedMedia';
import PaymentDialog from '@/components/post/PaymentDialog';
import SharePanel from '@/components/post/SharePanel';
import { Loading, ErrorState } from '@/components/base/StateView';
import { useViewer } from '@/lib/viewer-context';

export default function PostDetail() {
  const { id = '' } = useParams();
  const { viewer } = useViewer();
  const postRes = useApi(() => getPost(id), [id]);
  const postsRes = useApi(browse);

  const [supportOpen, setSupportOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const post = postRes.data;
  const allPosts = postsRes.data ?? [];

  if (postRes.status === 'loading') {
    return (
      <Shell>
        <div className="mx-auto max-w-3xl px-4 pt-16 md:px-6">
          <Loading lines={4} />
        </div>
      </Shell>
    );
  }

  if (postRes.status === 'error' || !post) {
    return (
      <Shell>
        <div className="mx-auto max-w-3xl px-4 pt-16 md:px-6">
          <ErrorState
            cause={postRes.error?.message ?? 'No post exists at this address.'}
            moneyState="Nothing was read and nothing was charged."
            next="Check the link, or read something from the feed."
            retry={() => window.REACT_APP_NAVIGATE('/feed')}
          />
        </div>
      </Shell>
    );
  }

  const author = post.author;
  const held = viewer.signedIn && viewer.holds.includes(post.id);
  const subscribed = viewer.signedIn && viewer.subscribedTo.includes(post.authorHandle);
  const canRead =
    post.access.kind === 'public' ||
    held ||
    (post.access.kind === 'subscribers' && subscribed);

  const media = post.assetIds;
  const paragraphs = post.body.split('\n\n').filter(Boolean);

  return (
    <Shell>
      <article className="mx-auto max-w-3xl px-4 pt-10 md:px-6">
        {/* Byline */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-ink-8">
          <Link to={`/c/${post.authorHandle}`} className="flex min-h-[44px] items-center gap-2 rounded-md -my-2 text-ink-9 hover:text-ink-10">
            <Avatar seed={author.address} size={32} isAgent={author.isAgent} />
            <span className="font-medium">@{post.authorHandle}</span>
          </Link>
          {author.isAgent && <AgentBadge />}
          <span aria-hidden>·</span>
          <time dateTime={new Date(post.createdAtMs).toISOString()} className="font-mono tabular-nums text-ink-7">
            {relativeTimeMs(post.createdAtMs)}
          </time>
        </div>

        <h1 className="mt-5 font-serif text-h2 font-medium leading-[1.2] text-ink-10">
          {post.title}
        </h1>

        <p className="mt-4 font-serif text-[19px] leading-[1.65] text-ink-8">
          {post.preview}
        </p>

        {/* Access state */}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <AccessChip post={post} />
          {post.purchaseCount > 0 && (
            <span className="font-mono text-caption tabular-nums text-ink-7">
              {post.purchaseCount} on-chain purchase{post.purchaseCount === 1 ? '' : 's'}
            </span>
          )}
        </div>

        <div className="mt-8 border-t border-ink-4 pt-8">
          {canRead ? (
            <>
              <div className="flex flex-col gap-5">
                {paragraphs.map((p, i) => (
                  <p key={i} className="prose-body text-ink-9">{p}</p>
                ))}
              </div>

              {media.length > 0 && (
                <div className="mt-8 flex flex-col gap-4">
                  {media.map((src, i) => (
                    <figure key={i}>
                      <img
                        src={src}
                        alt={`${post.title} — image ${i + 1}`}
                        title={`${post.title} — image ${i + 1}`}
                        className="w-full rounded-lg border border-ink-4"
                      />
                    </figure>
                  ))}
                </div>
              )}
            </>
          ) : post.access.kind === 'paid' ? (
            <LockedView post={post} onUnlock={() => setSupportOpen(true)} />
          ) : (
            <SubscribersView authorHandle={post.authorHandle} />
          )}
        </div>

        {/* Four actions */}
        <div className="mt-8 flex flex-wrap items-center gap-2 border-t border-ink-4 pt-6">
          <button
            type="button"
            onClick={() => setSupportOpen(true)}
            className="rank-primary inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md px-4 py-2 text-body-sm text-ink-0 hover:bg-mint-dim whitespace-nowrap cursor-pointer"
          >
            <Icon name="support" size={16} />
            Support
          </button>
          <a
            href="#comments"
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md border border-ink-5 bg-ink-2 px-4 py-2 text-body-sm text-ink-9 hover:border-ink-6 hover:text-ink-10 whitespace-nowrap cursor-pointer"
          >
            <Icon name="comments" size={16} />
            {post.commentCount === 0 ? 'Comment' : `Read ${post.commentCount} comment${post.commentCount === 1 ? '' : 's'}`}
          </a>
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md border border-ink-4 px-4 py-2 text-body-sm text-ink-8 hover:text-ink-10 whitespace-nowrap cursor-pointer"
          >
            <Icon name="share" size={16} />
            Share
          </button>
          <Link
            to={`/c/${post.authorHandle}`}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md border border-ink-4 px-4 py-2 text-body-sm text-ink-8 hover:text-ink-10 whitespace-nowrap cursor-pointer"
          >
            <Icon name="creator" size={16} />
            Creator
          </Link>
        </div>

        {/* Comments — load on intent, opened here */}
        <section id="comments" className="mt-10">
          <CommentThread postId={post.id} signedIn={viewer.signedIn} />
        </section>

        {/* Way onward — always visible, no need to touch the browser back button */}
        <Onward post={post} allPosts={allPosts} />
      </article>

      {supportOpen && (
        <PaymentDialog
          mode={post.access.kind === 'paid' && !canRead ? 'unlock' : 'support'}
          creatorHandle={post.authorHandle}
          creatorName={author.displayName}
          price={post.price ? mistToSui(post.price) : undefined}
          postId={post.id}
          onClose={() => setSupportOpen(false)}
        />
      )}

      {shareOpen && <SharePanel post={post} onClose={() => setShareOpen(false)} />}
    </Shell>
  );
}

// A way onward from every post. When the post belongs to a thread, list the
// whole run, numbered, the current item marked, every sibling linked by its
// full title. Otherwise list the author's three most recent other posts.
function Onward({ post, allPosts }: { post: Post; allPosts: Post[] }) {
  const handle = post.authorHandle;
  const thread = findThread(allPosts, post.id);
  const authorPosts = allPosts.filter(p => p.authorHandle === handle);

  if (thread && thread.posts.length >= 2) {
    // A run reads forward: oldest first, so "post four of seven" is position 4.
    const ordered = [...thread.posts].reverse();
    const position = ordered.findIndex(p => p.id === post.id) + 1;
    return (
      <section aria-label="More in this run" className="mt-10 border-t border-ink-4 pt-6">
        <p className="text-body text-ink-8">
          More from{' '}
          <Link to={`/c/${handle}`} className="font-medium text-ink-10 underline decoration-ink-6 underline-offset-4 hover:text-mint">
            @{handle}
          </Link>
          . This post is {position} of {thread.posts.length} in a run.
        </p>
        <p className="mt-1 font-mono text-caption text-ink-7">
          Grouped on: {thread.sharedTokens.join(', ')}
        </p>
        <ol className="mt-4 space-y-2">
          {ordered.map((p, i) => {
            const isCurrent = p.id === post.id;
            return (
              <li key={p.id} className="flex items-baseline gap-3">
                <span className="w-6 shrink-0 text-right font-mono text-caption tabular-nums text-ink-7">
                  {i + 1}
                </span>
                {isCurrent ? (
                  <span className="font-serif text-body font-medium text-ink-10">
                    {p.title}
                    <span className="ml-2 whitespace-nowrap font-mono text-caption font-normal text-ink-7">current</span>
                  </span>
                ) : (
                  <Link to={`/p/${p.id}`} className="font-serif text-body text-ink-9 hover:text-mint">
                    {p.title}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </section>
    );
  }

  const others = authorPosts.filter(p => p.id !== post.id).slice(0, 3);

  return (
    <section aria-label="More from this author" className="mt-10 border-t border-ink-4 pt-6">
      <p className="text-body text-ink-8">
        More from{' '}
        <Link to={`/c/${handle}`} className="font-medium text-ink-10 underline decoration-ink-6 underline-offset-4 hover:text-mint">
          @{handle}
        </Link>{' '}
        — {authorPosts.length} post{authorPosts.length === 1 ? '' : 's'} published.
      </p>
      {others.length > 0 && (
        <ul className="mt-4 space-y-2">
          {others.map(p => (
            <li key={p.id}>
              <Link to={`/p/${p.id}`} className="font-serif text-body text-ink-9 hover:text-mint">
                {p.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AccessChip({ post }: { post: Post }) {
  const kind = post.access.kind;
  if (kind === 'public') {
    return <span className="inline-flex items-center rounded-full border border-ink-5 bg-ink-2 px-2.5 py-1 text-caption font-medium text-ink-9">Free</span>;
  }
  if (kind === 'subscribers') {
    return <span className="inline-flex items-center rounded-full border border-ink-6 bg-ink-3 px-2.5 py-1 text-caption font-medium text-ink-9">Subscribers only</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border-2 border-mint/60 bg-mint/10 px-2.5 py-1 text-caption font-semibold text-mint">
      <Icon name="lock" size={12} />
      Locked — {fmtMist(post.price)} SUI
    </span>
  );
}

// Locked means locked. The body is ciphertext the platform cannot read.
function LockedView({ post, onUnlock }: { post: Post; onUnlock: () => void }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3 rounded-lg border border-ink-4 bg-ink-2 px-4 py-5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ink-5 text-ink-8">
          <Icon name="lock" size={18} />
        </span>
        <p className="text-body-sm text-ink-8">
          The body of this post is encrypted. weir holds ciphertext and cannot read it. Unlock to
          decrypt and read it here.
        </p>
      </div>

      {post.assetIds.length > 0 && <LockedMedia count={post.assetIds.length} />}

      <button
        type="button"
        onClick={onUnlock}
        className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-md border-2 border-mint bg-mint px-5 py-3 text-body font-semibold text-ink-0 hover:bg-mint-dim whitespace-nowrap cursor-pointer sm:w-auto"
      >
        <Icon name="unlock" size={18} />
        Unlock — {fmtMist(post.price)} SUI
      </button>
    </div>
  );
}

function SubscribersView({ authorHandle }: { authorHandle: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-ink-4 bg-ink-2 px-4 py-5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ink-5 text-ink-8">
        <Icon name="lock" size={18} />
      </span>
      <p className="text-body-sm text-ink-8">
        This post is for subscribers of @{authorHandle}. Subscribe to read it.
      </p>
    </div>
  );
}