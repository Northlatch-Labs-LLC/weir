import { useMemo, useState } from 'react';
import Shell from '@/components/layout/Shell';
import { useViewer } from '@/lib/viewer-context';
import { listCreators } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { fmtSui } from '@/lib/format';
import SignedOutGate from '@/components/base/SignedOutGate';
import Icon from '@/components/base/Icon';
import { Loading, ErrorState, EmptyState } from '@/components/base/StateView';
import ChestDialog from './components/ChestDialog';

const AMOUNTS = [0.1, 0.25, 1, 5];

export default function Chests() {
  const { viewer } = useViewer();
  const creatorsRes = useApi(listCreators);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState(0.25);
  const [open, setOpen] = useState(false);

  const recipients = useMemo(() => {
    if (!creatorsRes.data) return [];
    return creatorsRes.data.filter(p => p.vaultId != null && p.handle !== viewer.handle);
  }, [creatorsRes.data, viewer.handle]);

  if (!viewer.signedIn) {
    return (
      <Shell>
        <div className="mx-auto max-w-3xl px-4 pt-12 md:px-6">
          <SignedOutGate
            what="A gift sends coins straight from your wallet into a creator's vault. Sign in to send one."
            next="chests"
          />
        </div>
      </Shell>
    );
  }

  const selected = recipients.find(r => r.handle === recipient) ?? recipients[0] ?? null;

  return (
    <Shell>
      <div className="mx-auto max-w-3xl px-4 pt-10 md:px-6">
        <header>
          <h1 className="font-serif text-h1 font-medium leading-[1.1] text-ink-10">
            Send a gift, once.
          </h1>
          <p className="prose-body mt-5 text-ink-9">
            A gift settles on chain and never expires. It goes straight from your wallet into the
            creator&apos;s vault, once.
          </p>
        </header>

        {creatorsRes.status === 'loading' ? (
          <div className="mt-8"><Loading lines={3} /></div>
        ) : creatorsRes.status === 'error' ? (
          <div className="mt-8">
            <ErrorState
              cause={creatorsRes.error?.message ?? 'Recipients could not be read.'}
              moneyState="Nothing was read."
              next="Try loading recipients again."
              retry={creatorsRes.reload}
            />
          </div>
        ) : recipients.length === 0 ? (
          <div className="mt-8"><EmptyState seed="chests-empty" fact="No one can receive a gift yet." /></div>
        ) : (
          <>
            <section className="mt-8">
              <label htmlFor="chest-recipient" className="block text-body-sm text-ink-9">
                Who receives it
              </label>
              <select
                id="chest-recipient"
                name="recipient"
                value={selected?.handle ?? ''}
                onChange={e => setRecipient(e.target.value)}
                className="mt-1 w-full max-w-sm rounded-md border border-ink-5 bg-ink-2 px-3 py-2 text-body text-ink-10 cursor-pointer"
              >
                {recipients.map(p => (
                  <option key={p.handle} value={p.handle}>
                    @{p.handle} — {p.displayName}
                  </option>
                ))}
              </select>
            </section>

            <section className="mt-8">
              <span id="chest-amount-label" className="block text-body-sm text-ink-9">
                Amount, in SUI
              </span>
              <div role="group" aria-labelledby="chest-amount-label" className="mt-2 flex flex-wrap gap-2">
                {AMOUNTS.map(v => {
                  const active = v === amount;
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setAmount(v)}
                      aria-pressed={active}
                      className={`inline-flex min-h-[44px] items-center rounded-md border px-4 py-2 font-mono text-caption whitespace-nowrap cursor-pointer ${
                        active
                          ? 'border-mint bg-mint font-semibold text-ink-0'
                          : 'border-ink-5 bg-ink-2 text-ink-9 hover:text-ink-10'
                      }`}
                    >
                      {fmtSui(v)} SUI
                    </button>
                  );
                })}
              </div>
            </section>

            <div className="mt-8">
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-mint px-5 py-2 text-body-sm font-semibold text-ink-0 hover:bg-mint-dim whitespace-nowrap cursor-pointer"
              >
                <Icon name="support" size={16} />
                Send a gift
              </button>
            </div>
          </>
        )}
      </div>

      {open && selected ? (
        <ChestDialog
          recipient={selected.handle}
          recipientName={selected.displayName}
          amount={amount}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </Shell>
  );
}