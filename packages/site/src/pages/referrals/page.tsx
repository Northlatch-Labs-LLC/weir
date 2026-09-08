import { useState } from 'react';
import Shell from '@/components/layout/Shell';
import { useViewer } from '@/lib/viewer-context';
import { getReferrals } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { fmtSui } from '@/lib/format';
import SignedOutGate from '@/components/base/SignedOutGate';
import Icon from '@/components/base/Icon';
import { Loading, ErrorState } from '@/components/base/StateView';

export default function Referrals() {
  const { viewer } = useViewer();
  const res = useApi(getReferrals, [viewer.signedIn]);
  const [copied, setCopied] = useState(false);

  if (!viewer.signedIn) {
    return (
      <Shell>
        <div className="mx-auto max-w-3xl px-4 pt-12 md:px-6">
          <SignedOutGate
            what="Your referral link is tied to your account. Sign in to see what it has brought in."
            next="referrals"
          />
        </div>
      </Shell>
    );
  }

  const copy = async () => {
    if (!res.data) return;
    try {
      await navigator.clipboard.writeText(res.data.link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — the label stays "Copy link"
    }
  };

  return (
    <Shell>
      <div className="mx-auto max-w-3xl px-4 pt-10 md:px-6">
        <header>
          <h1 className="font-serif text-h1 font-medium leading-[1.1] text-ink-10">
            Your referral link.
          </h1>
          <p className="prose-body mt-5 text-ink-9">
            The accounts that joined through your link, and what that has paid.
          </p>
        </header>

        {res.status === 'loading' ? (
          <div className="mt-8"><Loading lines={3} /></div>
        ) : res.status === 'error' ? (
          <div className="mt-8">
            <ErrorState
              cause={res.error?.message ?? 'Your referral could not be read.'}
              moneyState="Nothing was read."
              next="Try loading your referral again."
              retry={res.reload}
            />
          </div>
        ) : res.data ? (
          <>
            <section className="mt-8 rounded-lg border border-ink-4 bg-ink-1 p-6">
              <span className="break-all font-mono text-body text-ink-10">{res.data.link}</span>
              <button
                type="button"
                onClick={copy}
                className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-md border border-ink-5 bg-ink-2 px-4 py-2 text-body-sm text-ink-10 hover:border-ink-6 whitespace-nowrap cursor-pointer"
              >
                <Icon name="share" size={15} />
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </section>

            <section className="mt-8">
              <dl className="grid grid-cols-2 gap-4">
                <div className="rounded-lg border border-ink-4 bg-ink-1 p-5">
                  <dt className="text-caption text-ink-7">Accounts joined</dt>
                  <dd className="mt-1 font-mono text-h3 tabular-nums text-ink-10">
                    {res.data.accountsJoined}
                  </dd>
                </div>
                <div className="rounded-lg border border-ink-4 bg-ink-1 p-5">
                  <dt className="text-caption text-ink-7">Paid</dt>
                  <dd className="mt-1 font-mono text-h3 tabular-nums text-mint">
                    {fmtSui(res.data.paidSui)} SUI
                  </dd>
                </div>
              </dl>
            </section>
          </>
        ) : null}
      </div>
    </Shell>
  );
}