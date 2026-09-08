import { Link } from 'react-router-dom';
import Shell from '@/components/layout/Shell';
import { useViewer } from '@/lib/viewer-context';
import { getPurchases } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { fmtMist } from '@/lib/format';
import SignedOutGate from '@/components/base/SignedOutGate';
import Icon from '@/components/base/Icon';
import { EmptyState, Loading, ErrorState } from '@/components/base/StateView';

export default function Purchases() {
  const { viewer } = useViewer();
  const purchasesRes = useApi(() => getPurchases(), [viewer.signedIn]);

  if (!viewer.signedIn) {
    return (
      <Shell>
        <div className="mx-auto max-w-3xl px-4 pt-12 md:px-6">
          <SignedOutGate what="Your purchases are the posts you have unlocked, and their receipts. Sign in to see them." />
        </div>
      </Shell>
    );
  }

  const purchases = purchasesRes.data;

  return (
    <Shell>
      <div className="mx-auto max-w-3xl px-4 pt-10 md:px-6">
        <header>
          <h1 className="font-serif text-h1 font-medium text-ink-10">Purchases</h1>
          <p className="mt-2 text-body text-ink-8">
            The posts you have paid for, and the receipts that prove it.
          </p>
        </header>

        {purchasesRes.status === 'loading' ? (
          <div className="mt-8"><Loading lines={3} /></div>
        ) : purchasesRes.status === 'error' ? (
          <div className="mt-8">
            <ErrorState
              cause={purchasesRes.error?.message ?? 'Your purchases could not be read.'}
              moneyState="Nothing was read."
              next="Try loading your purchases again."
              retry={purchasesRes.reload}
            />
          </div>
        ) : (
          <>
            <section className="mt-8">
              <h2 className="mb-4 text-caption font-semibold uppercase tracking-wide text-ink-7">Unlocked posts</h2>
              {!purchases || purchases.unlocks.length === 0 ? (
                <EmptyState seed="purchases-empty" fact="No posts yet." />
              ) : (
                <ul className="divide-y divide-ink-4 rounded-lg border border-ink-4 bg-ink-1">
                  {purchases.unlocks.map(post => (
                    <li key={post.id} className="flex items-center gap-3 p-4">
                      <div className="min-w-0 flex-1">
                        <Link to={`/p/${post.id}`} className="clamp-2 font-serif text-[17px] leading-snug text-ink-10 hover:text-mint">
                          {post.title}
                        </Link>
                        <div className="mt-1 text-caption text-ink-7">
                          @{post.authorHandle} · <span className="font-mono">{fmtMist(post.price)} SUI</span>
                        </div>
                      </div>
                      <Link
                        to={`/p/${post.id}`}
                        className="inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-md border border-ink-5 bg-ink-2 px-4 py-2 text-body-sm text-ink-9 hover:border-ink-6 hover:text-ink-10 whitespace-nowrap cursor-pointer"
                      >
                        <Icon name="unlock" size={16} />
                        Read
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="mt-10">
              <h2 className="mb-4 text-caption font-semibold uppercase tracking-wide text-ink-7">Receipts</h2>
              {!purchases || purchases.receipts.length === 0 ? (
                <EmptyState seed="receipts-empty" fact="No receipts yet." />
              ) : (
                <ul className="divide-y divide-ink-4 rounded-lg border border-ink-4 bg-ink-1">
                  {purchases.receipts.map(r => (
                    <li key={r.digest} className="flex items-center gap-3 p-4">
                      <div className="min-w-0 flex-1">
                        <div className="text-body-sm text-ink-10">
                          {r.kind === 'tip' ? `Tip to @${r.creatorHandle}` : `Unlocked @${r.creatorHandle}`}
                        </div>
                        <div className="font-mono text-caption tabular-nums text-ink-7">
                          {r.amountSui} SUI · {r.timestamp.slice(0, 10)}
                        </div>
                      </div>
                      <Link
                        to={`/receipt/${r.digest}`}
                        className="inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-md border border-ink-5 bg-ink-2 px-4 py-2 text-body-sm text-ink-9 hover:border-ink-6 hover:text-ink-10 whitespace-nowrap cursor-pointer"
                      >
                        <Icon name="external" size={16} />
                        Receipt
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </Shell>
  );
}