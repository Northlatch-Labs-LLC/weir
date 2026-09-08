import { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import Shell from '@/components/layout/Shell';
import { getCreatorProfile, browse, type Post } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { groupFeed } from '@/lib/grouping';
import { fmtMist, shortAddress } from '@/lib/format';
import Avatar from '@/components/base/Avatar';
import AgentBadge from '@/components/base/AgentBadge';
import PostCard from '@/components/post/PostCard';
import PostGroup from '@/components/post/PostGroup';
import PaymentDialog from '@/components/post/PaymentDialog';
import SharePanel from '@/components/post/SharePanel';
import { Loading, ErrorState } from '@/components/base/StateView';
import Icon from '@/components/base/Icon';
import { useViewer } from '@/lib/viewer-context';

export default function CreatorProfile() {
  const { handle = '' } = useParams();
  const { viewer } = useViewer();
  const profileRes = useApi(() => getCreatorProfile(handle), [handle]);
  const postsRes = useApi(browse);
  const [supportOpen, setSupportOpen] = useState(false);
  const [sharePost, setSharePost] = useState<Post | null>(null);

  const creator = profileRes.data;
  const allPosts = postsRes.data ?? [];

  const theirPosts = useMemo(() => allPosts.filter(p => p.authorHandle === handle), [allPosts, handle]);
  const entries = useMemo(() => groupFeed(theirPosts), [theirPosts]);

  if (profileRes.status === 'loading') {
    return (
      <Shell>
        <div className="mx-auto max-w-3xl px-4 pt-16 md:px-6">
          <Loading lines={3} />
        </div>
      </Shell>
    );
  }

  if (profileRes.status === 'error' || !creator) {
    return (
      <Shell>
        <div className="mx-auto max-w-3xl px-4 pt-16 md:px-6">
          <ErrorState
            cause={profileRes.error?.message ?? `No account exists with the handle @${handle}.`}
            moneyState="Nothing was read and nothing was charged."
            next="Check the handle, or look through the accounts that do exist."
            retry={() => window.REACT_APP_NAVIGATE('/explore')}
          />
        </div>
      </Shell>
    );
  }

  const joined = new Date(creator.joinedAtMs).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
  const isOwn = viewer.signedIn && viewer.address === creator.owner;

  return (
    <Shell>
      <div className="mx-auto max-w-3xl px-4 pt-10 md:px-6">
        {/* Identity */}
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <Avatar seed={creator.owner} size={96} isAgent={creator.isAgent} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-serif text-h2 font-medium leading-tight text-ink-10">{creator.displayName}</h1>
                {creator.isAgent && <AgentBadge />}
              </div>
              <p className="font-mono text-body text-ink-8">@{creator.handle}</p>
              <p className="mt-3 text-body text-ink-9">{creator.bio}</p>
            </div>
          </div>

          {isOwn ? (
            <Link
              to="/settings"
              className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-md border border-ink-5 bg-ink-2 px-5 py-2.5 text-body-sm text-ink-10 hover:border-ink-6 whitespace-nowrap cursor-pointer"
            >
              <Icon name="settings" size={16} />
              Edit profile
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => setSupportOpen(true)}
              className="rank-primary inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-md px-5 py-2.5 text-body-sm text-ink-0 hover:bg-mint-dim whitespace-nowrap cursor-pointer"
            >
              <Icon name="support" size={16} />
              Support
            </button>
          )}
        </header>

        {/* Facts about this account — real numbers */}
        <dl className="mt-8 grid grid-cols-3 gap-4 border-y border-ink-4 py-5 text-center">
          <div>
            <dt className="text-caption text-ink-7">Posts</dt>
            <dd className="mt-1 font-mono text-h3 tabular-nums text-ink-10">{theirPosts.length}</dd>
          </div>
          <div>
            <dt className="text-caption text-ink-7">Followers</dt>
            <dd className="mt-1 font-mono text-h3 tabular-nums text-ink-10">{creator.followers}</dd>
          </div>
          <div>
            <dt className="text-caption text-ink-7">Subscribers</dt>
            <dd className="mt-1 font-mono text-h3 tabular-nums text-ink-10">{creator.subscribers}</dd>
          </div>
        </dl>

        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-caption text-ink-7">
          <span>Member since {joined}</span>
          <span className="font-mono">vault {shortAddress(creator.vaultId ?? creator.owner)}</span>
          {creator.subscriptionPrice !== null && (
            <span>Subscription · <span className="font-mono text-ink-9">{fmtMist(creator.subscriptionPrice)} SUI</span>/month</span>
          )}
        </div>

        {/* Their posts */}
        <section className="mt-12">
          <h2 className="mb-5 text-caption font-semibold uppercase tracking-wide text-ink-7">
            Published
          </h2>
          {postsRes.status === 'loading' ? (
            <Loading lines={3} />
          ) : postsRes.status === 'error' ? (
            <ErrorState
              cause={postsRes.error?.message ?? 'The posts could not be read.'}
              moneyState="Nothing was read."
              next="Try loading the posts again."
              retry={postsRes.reload}
            />
          ) : theirPosts.length === 0 ? (
            <p className="text-body text-ink-8">No posts yet.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {entries.map(e =>
                e.kind === 'single' ? (
                  <PostCard key={e.post.id} post={e.post} onSupport={() => setSupportOpen(true)} onShare={setSharePost} />
                ) : (
                  <PostGroup key={`${e.author}-${e.posts[0].id}`} entry={e} onSupport={() => setSupportOpen(true)} onShare={setSharePost} />
                )
              )}
            </div>
          )}
        </section>

        <p className="mt-10 text-caption text-ink-7">
          <Link to="/explore" className="underline decoration-ink-6 underline-offset-4 hover:text-mint">All accounts</Link>
        </p>
      </div>

      {supportOpen && (
        <PaymentDialog
          mode="support"
          creatorHandle={creator.handle}
          creatorName={creator.displayName}
          onClose={() => setSupportOpen(false)}
        />
      )}

      {sharePost && <SharePanel post={sharePost} onClose={() => setSharePost(null)} />}
    </Shell>
  );
}