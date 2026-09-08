import { Link, useParams } from 'react-router-dom';
import Shell from '@/components/layout/Shell';
import { getVault } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { fmtSui } from '@/lib/format';
import { relativeTime } from '@/lib/grouping';
import Icon from '@/components/base/Icon';
import { Loading, ErrorState, EmptyState } from '@/components/base/StateView';

export default function VaultDetail() {
  const { id = '' } = useParams();
  const res = useApi(() => getVault(id), [id]);
  const vault = res.data;

  return (
    <Shell>
      <div className="mx-auto max-w-3xl px-4 pt-10 md:px-6">
        <header>
          <h1 className="font-serif text-h1 font-medium leading-[1.1] text-ink-10">Vault</h1>
          {vault && <p className="mt-2 break-all font-mono text-body text-ink-8">{vault.address}</p>}
        </header>

        {res.status === 'loading' ? (
          <div className="mt-8"><Loading lines={3} /></div>
        ) : res.status === 'error' || !vault ? (
          <div className="mt-8">
            <ErrorState
              cause={res.error?.message ?? 'This vault could not be read.'}
              moneyState="Nothing was read."
              next="Try loading the vault again."
              retry={res.reload}
            />
          </div>
        ) : (
          <>
            <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-body-sm text-ink-8">
              <span>
                Coin <span className="font-mono text-ink-10">{vault.coin.toUpperCase()}</span>
              </span>
              <a
                href={`https://suivision.xyz/object/${vault.address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[44px] items-center gap-1.5 text-mint hover:underline whitespace-nowrap cursor-pointer"
              >
                View on explorer
                <Icon name="external" size={14} />
              </a>
            </div>

            <section className="mt-8">
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-lg border border-ink-4 bg-ink-1 p-5">
                  <dt className="text-caption text-ink-7">Earnings</dt>
                  <dd className="mt-1 font-mono text-h3 tabular-nums text-mint">
                    {fmtSui(vault.earningsSui)} SUI
                  </dd>
                </div>
                <div className="rounded-lg border border-ink-4 bg-ink-1 p-5">
                  <dt className="text-caption text-ink-7">Platform fee</dt>
                  <dd className="mt-1 font-mono text-h3 tabular-nums text-ink-10">
                    {fmtSui(vault.feesSui)} SUI
                  </dd>
                </div>
              </dl>
              <p className="mt-3 text-body-sm text-ink-8">
                The earnings and the platform fee are separate objects. Claiming one cannot reach
                the other.
              </p>
            </section>

            <section className="mt-10">
              <h2 className="font-serif text-h4 font-medium text-ink-10">Settled payments</h2>
              {vault.settledPayments.length === 0 ? (
                <div className="mt-4">
                  <EmptyState
                    seed={`vault-${vault.address}`}
                    fact="No payments have settled into this vault yet."
                  />
                </div>
              ) : (
                <ul className="mt-4 divide-y divide-ink-4 rounded-lg border border-ink-4 bg-ink-1">
                  {vault.settledPayments.map(p => (
                    <li
                      key={p.digest}
                      className="flex flex-wrap items-center justify-between gap-3 p-4"
                    >
                      <span className="font-mono tabular-nums text-ink-10">
                        {fmtSui(p.amountSui)} SUI
                      </span>
                      <div className="flex items-center gap-4">
                        <span className="font-mono text-caption text-ink-7">
                          {relativeTime(p.timestamp)}
                        </span>
                        <Link
                          to={`/receipt/${p.digest}`}
                          className="inline-flex min-h-[44px] items-center gap-1.5 text-caption text-mint hover:underline whitespace-nowrap cursor-pointer"
                        >
                          Receipt
                          <Icon name="external" size={13} />
                        </Link>
                      </div>
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