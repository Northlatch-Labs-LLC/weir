import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Shell from '@/components/layout/Shell';
import { browse, type Post } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { groupFeed } from '@/lib/grouping';
import PostCard from '@/components/post/PostCard';
import PostGroup from '@/components/post/PostGroup';
import PaymentDialog from '@/components/post/PaymentDialog';
import SharePanel from '@/components/post/SharePanel';
import { EmptyState, Loading, ErrorState } from '@/components/base/StateView';

type Filter = 'all' | 'public' | 'paid' | 'subscribers';

export default function Feed() {
  const { status, data, error, reload } = useApi(browse);
  const [searchParams, setSearchParams] = useSearchParams();
  const rawAccess = searchParams.get('access');
  const filter: Filter =
    rawAccess === 'public' || rawAccess === 'paid' || rawAccess === 'subscribers' ? rawAccess : 'all';
  const setFilter = (key: Filter) =>
    setSearchParams(key === 'all' ? {} : { access: key }, { replace: true });
  const [supportPost, setSupportPost] = useState<Post | null>(null);
  const [sharePost, setSharePost] = useState<Post | null>(null);

  const posts = data ?? [];

  const filtered = useMemo(() => {
    if (filter === 'all') return posts;
    return posts.filter(p => p.access.kind === filter);
  }, [filter, posts]);

  const entries = useMemo(() => groupFeed(filtered), [filtered]);

  const filters: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: 'Everything', count: posts.length },
    { key: 'public', label: 'Free', count: posts.filter(p => p.access.kind === 'public').length },
    { key: 'paid', label: 'Locked', count: posts.filter(p => p.access.kind === 'paid').length },
    { key: 'subscribers', label: 'Subscribers only', count: posts.filter(p => p.access.kind === 'subscribers').length },
  ];

  return (
    <Shell>
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 pt-8 md:px-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <header className="mb-6">
            <h1 className="font-serif text-h1 font-medium text-ink-10">Feed</h1>
            <p className="mt-2 max-w-[62ch] text-body text-ink-8">
              Everything published, newest first. Consecutive posts by one account that share a
              subject are grouped, with the words they share printed in mono.
            </p>
          </header>

          <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label="Filter feed by access">
            {filters.map(f => {
              const active = filter === f.key;
              return (
                <button
                  key={f.key}
                  role="tab"
                  aria-selected={active}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={`inline-flex min-h-[44px] items-center gap-2 rounded-full px-4 py-1.5 text-body-sm whitespace-nowrap cursor-pointer ${
                    active
                      ? 'border-2 border-ink-10 bg-ink-3 font-semibold text-ink-10'
                      : 'border border-ink-5 bg-ink-1 text-ink-8 hover:text-ink-10'
                  }`}
                >
                  {f.label}
                  <span className="font-mono text-caption text-ink-9 tabular-nums">{f.count}</span>
                </button>
              );
            })}
          </div>

          {status === 'loading' ? (
            <Loading lines={4} />
          ) : status === 'error' ? (
            <ErrorState
              cause={error?.message ?? 'The feed could not be read.'}
              moneyState="Nothing was read."
              next="Try loading the feed again."
              retry={reload}
            />
          ) : entries.length === 0 ? (
            <EmptyState
              seed="feed-empty"
              fact="No posts match this filter."
              action={
                <button
                  type="button"
                  onClick={() => setFilter('all')}
                  className="inline-flex min-h-[44px] items-center rounded-md border border-ink-5 bg-ink-2 px-4 py-2 text-body-sm text-ink-10 whitespace-nowrap cursor-pointer"
                >
                  Show everything
                </button>
              }
            />
          ) : (
            <div className="flex flex-col gap-4">
              {entries.map(e =>
                e.kind === 'single' ? (
                  <PostCard key={e.post.id} post={e.post} onSupport={setSupportPost} onShare={setSharePost} />
                ) : (
                  <PostGroup key={`${e.author}-${e.posts[0].id}`} entry={e} onSupport={setSupportPost} onShare={setSharePost} />
                )
              )}
            </div>
          )}

          <div className="my-12 rounded-lg border border-dashed border-ink-4 p-6 text-center text-body-sm text-ink-7">
            You have reached the end. There are {posts.length} posts total, right now.
          </div>
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-20 flex flex-col gap-4">
            <div className="rounded-lg border border-ink-4 bg-ink-1 p-5">
              <h2 className="font-serif text-h4 text-ink-10">You are reading signed out.</h2>
              <p className="mt-2 text-body-sm text-ink-8">
                An account is a key on your device. No email is required. If you already have one,
                signing in restores it.
              </p>
              <div className="mt-4 flex gap-2">
                <a href="/join" className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-md bg-mint px-3 py-2 text-body-sm font-semibold text-ink-0 whitespace-nowrap cursor-pointer">Create account</a>
                <a href="/signin" className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-ink-5 px-3 py-2 text-body-sm text-ink-10 whitespace-nowrap cursor-pointer">Sign in</a>
              </div>
            </div>

            <div className="rounded-lg border border-ink-4 bg-ink-1 p-5">
              <h2 className="font-serif text-h4 text-ink-10">How the feed loads</h2>
              <ul className="mt-3 space-y-2 text-body-sm text-ink-8">
                <li>One request returns the page of posts, comment counts included.</li>
                <li>Comment bodies load only when a thread is opened.</li>
                <li>Viewer state is fetched once, not per card.</li>
              </ul>
            </div>
          </div>
        </aside>
      </div>

      {supportPost && (
        <PaymentDialog
          mode="support"
          creatorHandle={supportPost.authorHandle}
          creatorName={supportPost.author.displayName}
          onClose={() => setSupportPost(null)}
        />
      )}

      {sharePost && <SharePanel post={sharePost} onClose={() => setSharePost(null)} />}
    </Shell>
  );
}