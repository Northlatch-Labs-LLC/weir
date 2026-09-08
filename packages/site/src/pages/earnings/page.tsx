import { useState } from 'react';
import { Link } from 'react-router-dom';
import Shell from '@/components/layout/Shell';
import { useViewer } from '@/lib/viewer-context';
import { getTreasury } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { fmtSui } from '@/lib/format';
import SignedOutGate from '@/components/base/SignedOutGate';
import Icon from '@/components/base/Icon';

export default function Earnings() {
  const { viewer, claimEarnings } = useViewer();
  const treasuryRes = useApi(getTreasury);
  const [claimed, setClaimed] = useState<number | null>(null);

  if (!viewer.signedIn) {
    return (
      <Shell>
        <div className="mx-auto max-w-3xl px-4 pt-12 md:px-6">
          <SignedOutGate
            what="Your earnings show what your vault has collected and let you claim it. Sign in to see them."
            next="earnings"
          />
        </div>
      </Shell>
    );
  }

  const vault = viewer.creator.vault;
  const feeRate = treasuryRes.data?.feeRate ?? 0.029;
  const feePct = fmtSui(feeRate * 100);

  const doClaim = () => {
    const amount = claimEarnings();
    setClaimed(amount);
  };

  return (
    <Shell>
      <div className="mx-auto max-w-3xl px-4 pt-10 md:px-6">
        <header>
          <h1 className="font-serif text-h1 font-medium leading-[1.1] text-ink-10">
            What you have earned.
          </h1>
          <p className="prose-body mt-5 text-ink-9">
            A vault carries two balances: your earnings and the platform&apos;s fees. They are
            separate objects. Claiming your earnings cannot reach the fees.
          </p>
        </header>

        {!vault ? (
          <section className="mt-10 rounded-lg border border-ink-4 bg-ink-1 p-8">
            <h2 className="font-serif text-h4 font-medium text-ink-10">No vault.</h2>
            <p className="mt-3 text-body text-ink-8">
              Your earnings are not measured because you have not opened a vault. Opening a vault is
              the act that starts earning.
            </p>
            <Link
              to="/creator"
              className="mt-5 inline-flex min-h-[44px] items-center gap-2 rounded-md bg-mint px-5 py-2 text-body-sm font-semibold text-ink-0 hover:bg-mint-dim whitespace-nowrap cursor-pointer"
            >
              <Icon name="vault" size={16} />
              Open a vault
            </Link>
          </section>
        ) : (
          <>
            <section className="mt-10">
              <div className="rounded-lg border border-ink-4 bg-ink-1 p-6">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-body text-ink-8">Earnings, claimable</span>
                  <span className="font-mono text-h2 tabular-nums text-mint">{fmtSui(vault.earningsSui)} SUI</span>
                </div>
                <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-ink-4 pt-5 sm:grid-cols-3">
                  <div>
                    <dt className="text-caption text-ink-7">Settled, 30d</dt>
                    <dd className="mt-1 font-mono tabular-nums text-ink-10">{fmtSui(vault.settled30d)} SUI</dd>
                  </div>
                  <div>
                    <dt className="text-caption text-ink-7">Supporters</dt>
                    <dd className="mt-1 font-mono tabular-nums text-ink-10">{vault.supporters}</dd>
                  </div>
                  <div>
                    <dt className="text-caption text-ink-7">Platform fees, separate</dt>
                    <dd className="mt-1 font-mono tabular-nums text-ink-10">{fmtSui(vault.feesSui)} SUI</dd>
                  </div>
                </dl>
                <p className="mt-5 text-caption text-ink-7">
                  The fee is {feePct}%, taken once inside the same transaction. It is not yours to
                  claim.
                </p>
              </div>
            </section>

            <section className="mt-8 rounded-lg border border-ink-4 bg-ink-1 p-6">
              <h2 className="font-serif text-h4 font-medium text-ink-10">Claim</h2>
              <p className="mt-2 text-body-sm text-ink-8">
                Claiming sends your earnings from the vault to your wallet. Only your key can sign
                it.
              </p>

              {claimed === null ? (
                vault.earningsSui > 0 ? (
                  <button
                    type="button"
                    onClick={doClaim}
                    className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-md border-2 border-rose bg-rose px-5 py-2 text-body-sm font-semibold text-ink-0 whitespace-nowrap cursor-pointer"
                  >
                    <Icon name="vault" size={16} />
                    Claim {fmtSui(vault.earningsSui)} SUI
                  </button>
                ) : (
                  <p className="mt-4 text-body-sm text-ink-8">
                    0 SUI to claim. The vault is live and empty.
                  </p>
                )
              ) : (
                <p className="mt-4 text-body-sm text-mint" role="status">
                  Claimed {fmtSui(claimed)} SUI. It settles to your wallet on Sui.
                </p>
              )}
            </section>

            <p className="mt-8 text-caption text-ink-7">
              <Link to="/vault" className="underline decoration-ink-6 underline-offset-4 hover:text-mint">
                Your spendable balance lives in your vault
              </Link>
            </p>
          </>
        )}
      </div>
    </Shell>
  );
}