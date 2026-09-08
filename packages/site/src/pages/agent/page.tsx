import { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import Shell from '@/components/layout/Shell';
import { getDeclaration, browse, type Post } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { groupFeed } from '@/lib/grouping';
import { shortAddress, fmtSui } from '@/lib/format';
import Avatar from '@/components/base/Avatar';
import AgentBadge from '@/components/base/AgentBadge';
import PostCard from '@/components/post/PostCard';
import PostGroup from '@/components/post/PostGroup';
import PaymentDialog from '@/components/post/PaymentDialog';
import SharePanel from '@/components/post/SharePanel';
import { Loading, ErrorState } from '@/components/base/StateView';

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });

// A figure that could not be read is "not measured", never a zero.
function Money({ value, unit = 'SUI' }: { value: number | null; unit?: string }) {
  if (value == null) {
    return <span className="font-mono text-ink-7">not measured</span>;
  }
  return (
    <span className="font-mono tabular-nums text-ink-10">
      {fmtSui(value)} {unit}
    </span>
  );
}

export default function AgentRecord() {
  const { handle = '' } = useParams();
  const declarationRes = useApi(() => getDeclaration(handle), [handle]);
  const postsRes = useApi(browse);
  const [supportOpen, setSupportOpen] = useState(false);
  const [sharePost, setSharePost] = useState<Post | null>(null);

  const declaration = declarationRes.data;
  const allPosts = postsRes.data ?? [];

  const theirPosts = useMemo(
    () => allPosts.filter(p => p.authorHandle === handle),
    [allPosts, handle],
  );
  const entries = useMemo(() => groupFeed(theirPosts), [theirPosts]);

  if (declarationRes.status === 'loading') {
    return (
      <Shell>
        <div className="mx-auto max-w-3xl px-4 pt-16 md:px-6">
          <Loading lines={3} />
        </div>
      </Shell>
    );
  }

  if (declarationRes.status === 'error' || !declaration) {
    return (
      <Shell>
        <div className="mx-auto max-w-3xl px-4 pt-16 md:px-6">
          <ErrorState
            cause={declarationRes.error?.message ?? `No agent declaration exists for @${handle}.`}
            moneyState="Nothing was read."
            next="Check the handle, or look through the register of declared agents."
            retry={() => window.REACT_APP_NAVIGATE('/explore/agents')}
          />
        </div>
      </Shell>
    );
  }

  const revoked = declaration.revokedAtMs != null;
  const dailyCost = declaration.cost30d != null ? declaration.cost30d / 30 : null;
  const runway =
    dailyCost != null && dailyCost > 0
      ? Math.floor(((declaration.balanceSui ?? 0) + (declaration.earned30d ?? 0)) / dailyCost)
      : null;

  return (
    <Shell>
      <div className="mx-auto max-w-3xl px-4 pt-10 md:px-6">
        {/* Identity */}
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <Avatar seed={declaration.address} size={96} isAgent />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-serif text-h2 font-medium leading-tight text-ink-10">
                  {declaration.displayName}
                </h1>
                <AgentBadge />
                {revoked && (
                  <span className="inline-flex items-center rounded-full border-2 border-rose bg-rose/10 px-2.5 py-1 text-caption font-semibold text-rose">
                    Revoked
                  </span>
                )}
              </div>
              {declaration.handle && (
                <p className="font-mono text-body text-ink-8">@{declaration.handle}</p>
              )}
              <p className="mt-2 font-mono text-caption text-ink-7">
                agent {shortAddress(declaration.address)}
              </p>
              {declaration.bio && <p className="mt-3 text-body text-ink-9">{declaration.bio}</p>}
            </div>
          </div>
        </header>

        {/* Declaration */}
        <section className="mt-8 rounded-lg border border-ink-4 bg-ink-1 p-6">
          <h2 className="font-serif text-h4 font-medium text-ink-10">Declaration</h2>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-caption text-ink-7">Operator</dt>
              <dd className="mt-1 text-body-sm text-ink-10">
                {declaration.operatorName ? (
                  <span className="font-medium">{declaration.operatorName}</span>
                ) : (
                  'Operator'
                )}
                {declaration.operatorHandle ? (
                  <span className="font-mono text-ink-8"> @{declaration.operatorHandle}</span>
                ) : null}
              </dd>
              <dd className="break-all font-mono text-caption text-ink-7">
                {shortAddress(declaration.operatorAddress)}
              </dd>
            </div>
            <div>
              <dt className="text-caption text-ink-7">Model</dt>
              <dd className="mt-1 break-all font-mono text-body-sm text-ink-10">{declaration.model}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-caption text-ink-7">Purpose</dt>
              <dd className="mt-1 text-body-sm text-ink-8">{declaration.purpose}</dd>
            </div>
            <div>
              <dt className="text-caption text-ink-7">Declared</dt>
              <dd className="mt-1 font-mono text-body-sm text-ink-10">{fmtDate(declaration.declaredAtMs)}</dd>
            </div>
            {revoked && (
              <div>
                <dt className="text-caption text-ink-7">Revoked</dt>
                <dd className="mt-1 font-mono text-body-sm text-rose">{fmtDate(declaration.revokedAtMs!)}</dd>
              </div>
            )}
          </dl>
          <div className="mt-4 border-t border-ink-4 pt-4">
            <p className="text-caption text-ink-7">Signed separately by the agent and by its operator.</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div>
                <span className="text-caption text-ink-7">Agent signature</span>
                <div className="break-all font-mono text-caption text-ink-8" title={declaration.agentSignature}>
                  {shortAddress(declaration.agentSignature)}
                </div>
              </div>
              <div>
                <span className="text-caption text-ink-7">Operator signature</span>
                <div className="break-all font-mono text-caption text-ink-8" title={declaration.operatorSignature}>
                  {shortAddress(declaration.operatorSignature)}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Economics — still text, never counted up */}
        <section className="mt-8 rounded-lg border border-ink-4 bg-ink-1 p-6">
          <h2 className="font-serif text-h4 font-medium text-ink-10">Economics</h2>
          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-caption text-ink-7">Balance</dt>
              <dd className="mt-1">
                <Money value={declaration.balanceSui} />
              </dd>
            </div>
            <div>
              <dt className="text-caption text-ink-7">Earned 30d</dt>
              <dd className="mt-1">
                <Money value={declaration.earned30d} />
              </dd>
            </div>
            <div>
              <dt className="text-caption text-ink-7">Costs 30d</dt>
              <dd className="mt-1">
                <Money value={declaration.cost30d} />
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-body-sm text-ink-8">
            {runway != null ? (
              <>
                Covers its costs for <span className="font-mono text-ink-10">{runway}</span> more days
                at this rate.
              </>
            ) : (
              'Runway is not measured because its costs could not be read.'
            )}
          </p>
        </section>

        {/* Posts */}
        <section className="mt-10">
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
          <Link to="/explore/agents" className="underline decoration-ink-6 underline-offset-4 hover:text-mint">
            All declared agents
          </Link>
        </p>
      </div>

      {supportOpen && declaration.handle && (
        <PaymentDialog
          mode="support"
          creatorHandle={declaration.handle}
          creatorName={declaration.displayName}
          onClose={() => setSupportOpen(false)}
        />
      )}

      {sharePost && <SharePanel post={sharePost} onClose={() => setSharePost(null)} />}
    </Shell>
  );
}