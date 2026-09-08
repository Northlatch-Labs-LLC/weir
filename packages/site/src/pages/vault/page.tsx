import { useState } from 'react';
import { Link } from 'react-router-dom';

import Shell from '@/components/layout/Shell';
import { useViewer } from '@/lib/viewer-context';
import { fmtSui, shortAddress } from '@/lib/format';
import { announceSettlement } from '@/components/base/WeirLine';
import SignedOutGate from '@/components/base/SignedOutGate';
import Icon from '@/components/base/Icon';

export default function Vault() {
  const { viewer } = useViewer();
  const [withdrawAmount, setWithdrawAmount] = useState(0.5);
  const [withdrawn, setWithdrawn] = useState<number | null>(null);

  if (!viewer.signedIn) {
    return (
      <Shell>
        <div className="mx-auto max-w-3xl px-4 pt-12 md:px-6">
          <SignedOutGate what="Your vault shows your balance and lets you withdraw it. Sign in to see it." />
        </div>
      </Shell>
    );
  }

  const v = viewer.vault;

  // Signed in, but no vault opened yet. Without this the page reads v.address and throws.
  if (v === null || v === undefined) {
    return (
      <Shell>
        <div className="mx-auto max-w-3xl px-4 pt-12 md:px-6">
          <h1 className="font-serif text-h1 font-medium text-ink-10">Vault</h1>
          <p className="mt-3 max-w-[62ch] text-body text-ink-8">
            You do not have a vault yet. A vault is where money paid to you lands, and only your
            address can open it.
          </p>
          <Link
            to="/creator"
            className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-md bg-mint px-5 py-2 text-body-sm font-semibold text-ink-0 hover:bg-mint-dim"
          >
            Open a vault
          </Link>
        </div>
      </Shell>
    );
  }

  const doWithdraw = () => {
    setWithdrawn(withdrawAmount);
    announceSettlement();
  };

  return (
    <Shell>
      <div className="mx-auto max-w-3xl px-4 pt-10 md:px-6">
        <header>
          <h1 className="font-serif text-h1 font-medium text-ink-10">Vault</h1>
          <p className="mt-2 font-mono text-body text-ink-8">vault {shortAddress(v.address)}</p>
        </header>

        {/* Balance — the one mint moment on this page */}
        <div className="mt-8 rounded-lg border border-ink-4 bg-ink-1 p-6">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-body text-ink-8">Balance</span>
            <span className="font-mono text-h1 tabular-nums text-mint">{fmtSui(v.balanceSui)} SUI</span>
          </div>
          <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-ink-4 pt-5 sm:grid-cols-4">
            <div>
              <dt className="text-caption text-ink-7">In, 30d</dt>
              <dd className="mt-1 font-mono tabular-nums text-ink-10">{fmtSui(v.inflow30d)} SUI</dd>
            </div>
            <div>
              <dt className="text-caption text-ink-7">Out, 30d</dt>
              <dd className="mt-1 font-mono tabular-nums text-ink-10">{fmtSui(v.outflow30d)} SUI</dd>
            </div>
            <div>
              <dt className="text-caption text-ink-7">Supporters</dt>
              <dd className="mt-1 font-mono tabular-nums text-ink-10">{v.supporters}</dd>
            </div>
            <div>
              <dt className="text-caption text-ink-7">Entries</dt>
              <dd className="mt-1 font-mono tabular-nums text-ink-10">{v.entries}</dd>
            </div>
          </dl>
        </div>

        {/* Withdraw — take it out */}
        <section className="mt-8 rounded-lg border border-ink-4 bg-ink-1 p-6">
          <h2 className="font-serif text-h4 font-medium text-ink-10">Withdraw</h2>
          <p className="mt-2 text-body-sm text-ink-8">
            Withdrawing sends coins from this vault to your wallet. Only your key can sign it.
          </p>

          {withdrawn === null ? (
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
              <div>
                <label htmlFor="withdraw-amount" className="block text-body-sm text-ink-9">Amount, in SUI</label>
                <input
                  id="withdraw-amount"
                  type="number"
                  min={0.01}
                  step={0.01}
                  value={withdrawAmount}
                  onChange={e => setWithdrawAmount(Number(e.target.value))}
                  className="mt-1 w-36 rounded-md border border-ink-5 bg-ink-2 px-3 py-2 font-mono text-body text-ink-10 tabular-nums"
                />
              </div>
              <button
                type="button"
                onClick={doWithdraw}
                disabled={withdrawAmount <= 0 || withdrawAmount > v.balanceSui}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md border-2 border-rose bg-rose px-5 py-2 text-body-sm font-semibold text-ink-0 disabled:opacity-40 whitespace-nowrap cursor-pointer"
              >
                <Icon name="vault" size={16} />
                Withdraw {fmtSui(withdrawAmount)} SUI
              </button>
            </div>
          ) : (
            <p className="mt-4 text-body-sm text-mint" role="status">
              Withdrawal of {fmtSui(withdrawn)} SUI submitted. It settles to your wallet on Sui.
            </p>
          )}
        </section>

        {/* The three facts, stated plainly */}
        <section className="mt-8">
          <ul className="space-y-3 text-body text-ink-8">
            <li className="flex gap-3"><span className="font-mono text-mint">·</span>You are paid directly. There is no payout to request, no threshold, no schedule.</li>
            <li className="flex gap-3"><span className="font-mono text-mint">·</span>The platform cannot hold your money. The contract has no method that transfers your coins.</li>
            <li className="flex gap-3"><span className="font-mono text-mint">·</span>Your vault opens with your key. We do not have a copy.</li>
          </ul>
        </section>
      </div>
    </Shell>
  );
}