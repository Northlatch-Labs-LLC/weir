import { useState } from 'react';
import Shell from '@/components/layout/Shell';
import { useViewer } from '@/lib/viewer-context';
import { getDepositAddress } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import SignedOutGate from '@/components/base/SignedOutGate';
import Icon from '@/components/base/Icon';
import { Loading, ErrorState } from '@/components/base/StateView';

export default function AddFunds() {
  const { viewer } = useViewer();
  const res = useApi(getDepositAddress, [viewer.signedIn]);
  const [copied, setCopied] = useState(false);

  if (!viewer.signedIn) {
    return (
      <Shell>
        <div className="mx-auto max-w-3xl px-4 pt-12 md:px-6">
          <SignedOutGate
            what="Add funds sends coins to your account's deposit address. Sign in to see it."
            next="add-funds"
          />
        </div>
      </Shell>
    );
  }

  const copy = async () => {
    if (!res.data) return;
    try {
      await navigator.clipboard.writeText(res.data.address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — the label stays "Copy"
    }
  };

  return (
    <Shell>
      <div className="mx-auto max-w-3xl px-4 pt-10 md:px-6">
        <header>
          <h1 className="font-serif text-h1 font-medium leading-[1.1] text-ink-10">Add funds</h1>
          <p className="prose-body mt-5 text-ink-9">
            Send coins to this address to top up your account.
          </p>
        </header>

        {res.status === 'loading' ? (
          <div className="mt-8"><Loading lines={2} /></div>
        ) : res.status === 'error' ? (
          <div className="mt-8">
            <ErrorState
              cause={res.error?.message ?? 'Your deposit address could not be read.'}
              moneyState="Nothing was read."
              next="Try loading the address again."
              retry={res.reload}
            />
          </div>
        ) : res.data ? (
          <>
            <section className="mt-8 rounded-lg border border-ink-4 bg-ink-1 p-6">
              <span className="text-caption text-ink-7">Deposit address</span>
              <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="break-all font-mono text-body text-ink-10">
                  {res.data.address}
                </span>
                <button
                  type="button"
                  onClick={copy}
                  className="inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-md border border-ink-5 bg-ink-2 px-4 py-2 text-body-sm text-ink-10 hover:border-ink-6 whitespace-nowrap cursor-pointer"
                >
                  <Icon name="share" size={15} />
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-4 text-body-sm text-ink-8">
                <span>
                  Coin{' '}
                  <span className="font-mono text-ink-10">{res.data.coin.toUpperCase()}</span>
                </span>
                <a
                  href={`https://suivision.xyz/address/${res.data.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[44px] items-center gap-1.5 text-mint hover:underline whitespace-nowrap cursor-pointer"
                >
                  View on explorer
                  <Icon name="external" size={14} />
                </a>
              </div>
            </section>

            <section className="mt-10">
              <h2 className="font-serif text-h4 font-medium text-ink-10">To add funds</h2>
              <ol className="mt-4 space-y-3 text-body text-ink-8">
                <li className="flex gap-3">
                  <span className="font-mono text-mint">1</span>
                  <span>Copy the deposit address.</span>
                </li>
                <li className="flex gap-3">
                  <span className="font-mono text-mint">2</span>
                  <span>Send SUI to it from your wallet.</span>
                </li>
                <li className="flex gap-3">
                  <span className="font-mono text-mint">3</span>
                  <span>Funds appear in your account after the transfer settles on Sui.</span>
                </li>
              </ol>
            </section>
          </>
        ) : null}
      </div>
    </Shell>
  );
}