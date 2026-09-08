import { Link } from 'react-router-dom';
import Shell from '@/components/layout/Shell';
import Sill from '@/components/base/Sill';
import Icon from '@/components/base/Icon';
import { getTreasury } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { fmtSui } from '@/lib/format';
import { relativeTime } from '@/lib/grouping';
import { Loading, ErrorState } from '@/components/base/StateView';

export default function Treasury() {
  const treasuryRes = useApi(getTreasury);
  const treasury = treasuryRes.data;

  if (treasuryRes.status === 'loading') {
    return (
      <Shell>
        <div className="mx-auto max-w-3xl px-4 pt-16 md:px-6"><Loading lines={3} /></div>
      </Shell>
    );
  }

  if (treasuryRes.status === 'error' || !treasury) {
    return (
      <Shell>
        <div className="mx-auto max-w-3xl px-4 pt-16 md:px-6">
          <ErrorState
            cause={treasuryRes.error?.message ?? 'The treasury figures could not be read.'}
            moneyState="Nothing was read."
            next="Try loading the treasury again."
            retry={treasuryRes.reload}
          />
        </div>
      </Shell>
    );
  }

  const totalAllocated = treasury.allocation.reduce((s, a) => s + a.sui, 0);

  return (
    <Shell>
      <div className="mx-auto max-w-3xl px-4 pt-10 md:px-6">
        <header>
          <h1 className="font-serif text-h1 font-medium leading-[1.1] text-ink-10">
            The 2.9% goes to running weir.
          </h1>
          <p className="prose-body mt-5 text-ink-9">
            2.9% is taken inside the same transaction, as a second transfer signed by the buyer.
            There is no second step. It is the platform&apos;s only revenue, and it is accounted for
            in public. It is not your money held in custody — it is a fee, already spent on keeping
            the network running.
          </p>
        </header>

        <Sill />

        <section className="py-10">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-ink-4 bg-ink-1 p-5">
              <dt className="text-caption text-ink-7">Fee rate</dt>
              <dd className="mt-1 font-mono text-h3 tabular-nums text-ink-10">{fmtSui(treasury.feeRate * 100)}%</dd>
            </div>
            <div className="rounded-lg border border-ink-4 bg-ink-1 p-5">
              <dt className="text-caption text-ink-7">Fees collected</dt>
              <dd className="mt-1 font-mono text-h3 tabular-nums text-ink-10">{fmtSui(treasury.totalFeesSui)} SUI</dd>
            </div>
            <div className="rounded-lg border border-ink-4 bg-ink-1 p-5">
              <dt className="text-caption text-ink-7">Settled payments</dt>
              <dd className="mt-1 font-mono text-h3 tabular-nums text-ink-10">{treasury.settledCount}</dd>
            </div>
          </dl>
        </section>

        <Sill />

        <section className="py-10">
          <h2 className="font-serif text-h2 font-medium text-ink-10">Where the collected fee goes.</h2>
          <ul className="mt-6 divide-y divide-ink-4 rounded-lg border border-ink-4 bg-ink-1">
            {treasury.allocation.map(a => (
              <li key={a.label} className="flex items-baseline justify-between gap-4 p-4">
                <span className="text-body text-ink-9">{a.label}</span>
                <span className="font-mono tabular-nums text-ink-10">{fmtSui(a.sui)} SUI</span>
              </li>
            ))}
            <li className="flex items-baseline justify-between gap-4 border-t border-ink-4 p-4">
              <span className="text-body-sm font-medium text-ink-10">Total</span>
              <span className="font-mono tabular-nums text-ink-10">{fmtSui(totalAllocated)} SUI</span>
            </li>
          </ul>
        </section>

        <Sill />

        <section className="py-10">
          <h2 className="font-serif text-h2 font-medium text-ink-10">The last settled fee.</h2>
          <div className="mt-5 rounded-lg border border-ink-4 bg-ink-1 p-5">
            <dl className="space-y-2 text-body-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-ink-8">Payment</dt>
                <dd className="font-mono tabular-nums text-ink-10">{fmtSui(treasury.lastSettled.amountSui)} SUI</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-8">Fee (2.9%)</dt>
                <dd className="font-mono tabular-nums text-ink-10">{fmtSui(treasury.lastSettled.feeSui)} SUI</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-8">When</dt>
                <dd className="font-mono tabular-nums text-ink-10">{relativeTime(treasury.lastSettled.timestamp)}</dd>
              </div>
            </dl>
            <Link
              to={`/receipt/${treasury.lastSettled.digest}`}
              className="mt-4 flex min-h-[44px] items-center gap-2 break-all font-mono text-caption text-mint hover:underline"
            >
              {treasury.lastSettled.digest}
              <Icon name="external" size={14} className="shrink-0" />
            </Link>
          </div>
        </section>

        <Sill />

        <section className="py-12">
          <p className="prose-body text-ink-8">
            If weir vanished tomorrow, every vault would still belong to its owner. The fee is a
            cost paid once, at the moment of the transaction — not a balance we hold on your behalf.
          </p>
        </section>
      </div>
    </Shell>
  );
}