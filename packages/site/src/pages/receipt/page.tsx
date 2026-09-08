import { useParams } from 'react-router-dom';
import Shell from '@/components/layout/Shell';
import { getReceipt } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { fmtSui, shortAddress } from '@/lib/format';
import { Loading, ErrorState } from '@/components/base/StateView';
import Icon from '@/components/base/Icon';

// A settled payment has a permanent page. Fixed 720px column so a screenshot
// crops clean at any viewport. The full digest links to the Sui explorer.
export default function Receipt() {
  const { digest = '' } = useParams();
  const receiptRes = useApi(() => getReceipt(digest), [digest]);

  if (receiptRes.status === 'loading') {
    return (
      <Shell>
        <div className="mx-auto max-w-[720px] px-4 pt-16 md:px-6"><Loading lines={3} /></div>
      </Shell>
    );
  }

  const r = receiptRes.data;
  if (receiptRes.status === 'error' || !r) {
    return (
      <Shell>
        <div className="mx-auto max-w-[720px] px-4 pt-16 md:px-6">
          <ErrorState
            cause={receiptRes.error?.message ?? 'No receipt exists at this digest.'}
            moneyState="This does not mean the payment did not happen — it means this digest is not on record."
            next="Check the digest, or look at your purchases."
            retry={() => window.REACT_APP_NAVIGATE('/purchases')}
          />
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mx-auto max-w-[720px] px-4 pt-10 md:px-6">
        <div className="flex items-center gap-2 text-caption font-semibold uppercase tracking-wide text-mint">
          <Icon name="check" size={16} />
          Settled
        </div>
        <h1 className="mt-2 font-serif text-h2 font-medium leading-tight text-ink-10">
          {r.kind === 'tip' ? `Tip to @${r.creatorHandle}` : `Unlock of @${r.creatorHandle}`}
        </h1>

        <div className="mt-8 rounded-lg border border-ink-4 bg-ink-1 p-6">
          <dl className="space-y-4 text-body">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-ink-8">Amount</dt>
              <dd className="font-mono text-h3 tabular-nums text-ink-10">{fmtSui(r.amountSui)} SUI</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-t border-ink-4 pt-4">
              <dt className="text-ink-8">To creator vault</dt>
              <dd className="font-mono tabular-nums text-mint">{fmtSui(r.creatorSui)} SUI</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-ink-8">weir fee (2.9%)</dt>
              <dd className="font-mono tabular-nums text-ink-10">{fmtSui(r.feeSui)} SUI</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-t border-ink-4 pt-4">
              <dt className="text-ink-8">Payer</dt>
              <dd className="text-ink-10">@{r.payerHandle}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-ink-8">Creator</dt>
              <dd className="text-ink-10">@{r.creatorHandle}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-ink-8">Creator vault</dt>
              <dd className="font-mono text-ink-10">{shortAddress(r.creatorVault)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-ink-8">Timestamp</dt>
              <dd className="font-mono tabular-nums text-ink-10">{new Date(r.timestamp).toISOString()}</dd>
            </div>
          </dl>
        </div>

        <div className="mt-6 rounded-lg border border-ink-4 bg-ink-2 p-5">
          <p className="text-caption text-ink-7">Transaction digest</p>
          <a
            href={`https://suivision.xyz/txblock/${r.digest}`}
            rel="nofollow"
            target="_blank"
            className="mt-2 flex items-center gap-2 break-all font-mono text-body-sm text-mint hover:underline"
          >
            {r.digest}
            <Icon name="external" size={14} className="shrink-0" />
          </a>
        </div>

        <p className="mt-6 text-caption text-ink-7">
          This receipt is permanent. It will be at this address for as long as the chain exists.
        </p>
      </div>
    </Shell>
  );
}