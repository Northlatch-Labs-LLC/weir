import { useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '@/components/base/Icon';
import { announceSettlement } from '@/components/base/WeirLine';
import { fmtSui, suiToMist } from '@/lib/format';
import { pay, PAY_ORDER, useWallet, type PayStage } from '@/lib/wallet';

// A gift is a one-time payment, settled on chain, that never expires. It moves
// money, so it needs a connected wallet. The confirm names the recipient and
// the amount before anything is signed, and every stage announces itself.

type Stage = PayStage | 'confirm' | 'connect';

const ECOSYSTEM_URL = 'https://sui.io/ecosystem';

const LABELS: Record<PayStage, string> = {
  preparing: 'Preparing',
  'awaiting-signature': 'Awaiting signature',
  submitting: 'Submitted',
  confirming: 'Confirming on Sui',
  settled: 'Settled, 2.9% taken',
  rejected: '',
  'timed-out': '',
  failed: '',
};

type Props = {
  recipient: string;
  recipientName: string;
  amount: number;
  onClose: () => void;
};

export default function ChestDialog({ recipient, recipientName, amount, onClose }: Props) {
  const { signer, wallets, connect, busy: connectBusy, error: connectError } = useWallet();
  const [stage, setStage] = useState<Stage>('confirm');
  const [digest, setDigest] = useState<string | null>(null);
  const [failMessage, setFailMessage] = useState<string | null>(null);
  const [failDetail, setFailDetail] = useState<string | null>(null);

  const fee = amount * 0.029;

  const confirm = async () => {
    if (!signer) {
      setStage('connect');
      return;
    }
    setDigest(null);
    setFailMessage(null);
    setFailDetail(null);
    const res = await pay(
      { kind: 'tip', creatorHandle: recipient, amountMist: suiToMist(amount) },
      signer,
      (s, d) => {
        setStage(s);
        if (d) setFailMessage(d);
      },
    );
    if (res.ok) {
      setDigest(res.data.digest);
      announceSettlement();
    } else {
      setFailMessage(res.error.message);
      setFailDetail(res.error.detail ?? null);
    }
  };

  const retry = () => {
    setStage('confirm');
    setDigest(null);
    setFailMessage(null);
    setFailDetail(null);
  };

  const announcement: Record<Stage, string> = {
    confirm: '',
    connect: 'Connect a wallet to send.',
    preparing: 'Preparing the transaction.',
    'awaiting-signature': 'Awaiting signature from your wallet.',
    submitting: 'Submitted. Confirming on Sui.',
    confirming: 'Confirming on Sui.',
    settled: `Settled. ${fmtSui(fee)} SUI fee taken.`,
    rejected: 'The wallet rejected the signature. Nothing was sent.',
    'timed-out': 'The wallet did not respond. Nothing was sent.',
    failed: 'The payment failed. Nothing was sent.',
  };

  const inProgress =
    stage === 'preparing' ||
    stage === 'awaiting-signature' ||
    stage === 'submitting' ||
    stage === 'confirming' ||
    stage === 'settled';

  const isTerminal = stage === 'rejected' || stage === 'timed-out' || stage === 'failed';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="chest-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-0/70 p-4 md:items-center"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sr-only" aria-live="polite">{announcement[stage]}</div>

      <div className="w-full max-w-md rounded-lg border border-ink-4 bg-ink-1 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 id="chest-title" className="font-serif text-h3 font-medium text-ink-10">
              Send a gift
            </h3>
            <p className="mt-1 text-caption text-ink-8">
              {fmtSui(amount)} SUI to @{recipient} ({recipientName}). A gift settles on chain and
              never expires.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-ink-8 hover:text-ink-10 cursor-pointer"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        {stage === 'confirm' && (
          <>
            <dl className="mt-6 space-y-2 rounded-md border border-ink-4 bg-ink-2 p-4 text-caption">
              <div className="flex justify-between">
                <dt className="text-ink-8">To @{recipient}</dt>
                <dd className="font-mono tabular-nums text-ink-10">{fmtSui(amount * 0.971)} SUI</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-8">weir fee (2.9%)</dt>
                <dd className="font-mono tabular-nums text-ink-10">{fmtSui(fee)} SUI</dd>
              </div>
              <div className="flex justify-between border-t border-ink-4 pt-2">
                <dt className="text-ink-9">You send</dt>
                <dd className="font-mono tabular-nums text-ink-10">{fmtSui(amount)} SUI</dd>
              </div>
            </dl>

            {!signer && (
              <p className="mt-3 text-caption text-ink-7">You will need a connected wallet to send.</p>
            )}

            <div className="mt-6 flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-md border border-ink-5 bg-ink-2 px-4 py-2 text-body-sm text-ink-10 whitespace-nowrap cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirm}
                className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-md border-2 border-rose bg-rose px-4 py-2 text-body-sm font-semibold text-ink-0 whitespace-nowrap cursor-pointer"
              >
                Send {fmtSui(amount)} SUI
              </button>
            </div>
          </>
        )}

        {stage === 'connect' && (
          <>
            <div className="mt-6 rounded-md border border-ink-4 bg-ink-2 p-4">
              <p className="text-body-sm text-ink-9">
                Connect a wallet to send. Your coins go straight to @{recipient}&apos;s vault, and
                your wallet signs the transaction.
              </p>
            </div>

            {connectBusy ? (
              <p className="mt-4 text-body-sm text-ink-8">Connecting…</p>
            ) : wallets.length === 0 ? (
              <div className="mt-4">
                <p className="text-body-sm text-ink-9">No wallet is installed.</p>
                <a
                  href={ECOSYSTEM_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-md border border-ink-5 bg-ink-2 px-4 py-2 text-body-sm text-ink-10 hover:border-ink-6 whitespace-nowrap cursor-pointer"
                >
                  <span>Browse wallets</span>
                  <Icon name="external" size={15} />
                </a>
              </div>
            ) : (
              <div className="mt-4 flex flex-col gap-1">
                {wallets.map(w => (
                  <button
                    key={w.name}
                    type="button"
                    onClick={async () => {
                      await connect(w.name);
                      setStage('confirm');
                    }}
                    className="flex min-h-[44px] w-full items-center gap-3 rounded-md border border-ink-5 bg-ink-2 px-3 py-2 text-left text-body-sm text-ink-10 hover:border-ink-6 cursor-pointer"
                  >
                    {w.icon ? (
                      <img src={w.icon} alt="" className="h-5 w-5 rounded-sm" />
                    ) : (
                      <Icon name="wallet" size={18} />
                    )}
                    <span>{w.name}</span>
                  </button>
                ))}
              </div>
            )}

            {connectError && <p className="mt-3 text-caption text-rose">{connectError}</p>}

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setStage('confirm')}
                className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-md border border-ink-5 bg-ink-2 px-4 py-2 text-body-sm text-ink-10 whitespace-nowrap cursor-pointer"
              >
                Back
              </button>
            </div>
          </>
        )}

        {inProgress && (
          <div className="mt-6">
            <ol className="space-y-3 text-body-sm">
              {PAY_ORDER.map((key, i) => {
                const idx = PAY_ORDER.indexOf(stage as PayStage);
                const done = i < idx || stage === 'settled';
                const current = i === idx && stage !== 'settled';
                const statusWord = done ? 'Done' : current ? 'In progress' : 'Pending';
                return (
                  <li key={key} className="flex items-center gap-3">
                    <span
                      aria-hidden
                      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                        done
                          ? 'border-mint bg-mint text-ink-0'
                          : current
                            ? 'border-ink-8 text-ink-8'
                            : 'border-ink-5 text-ink-6'
                      }`}
                    >
                      {done ? (
                        <Icon name="check" size={13} />
                      ) : current ? (
                        <span className="h-2 w-2 rounded-full bg-current" />
                      ) : (
                        <span className="h-2 w-2 rounded-full border border-current" />
                      )}
                    </span>
                    <span className={done || current ? 'text-ink-10' : 'text-ink-8'}>{LABELS[key]}</span>
                    <span className="ml-auto font-mono text-caption text-ink-7">{statusWord}</span>
                  </li>
                );
              })}
            </ol>

            {(stage === 'submitting' || stage === 'confirming') && (
              <div className="mt-4 h-0.5 w-full overflow-hidden rounded-full bg-ink-4">
                <div className="weir-progress-bar h-full w-1/3 rounded-full bg-mint" />
              </div>
            )}

            {stage === 'settled' && digest && (
              <p className="mt-4 text-caption text-ink-8">
                This took seconds because it happened on a public chain.{' '}
                <Link
                  to={`/receipt/${digest}`}
                  className="font-mono text-mint underline underline-offset-4"
                >
                  View receipt
                </Link>
              </p>
            )}
          </div>
        )}

        {isTerminal && (
          <div className="mt-6">
            <div className="flex items-start gap-3 rounded-md border-2 border-rose bg-rose/10 p-4">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-rose text-rose">
                <Icon name="alert" size={14} />
              </span>
              <div>
                <p className="text-body-sm font-semibold text-rose">
                  {failMessage ??
                    (stage === 'timed-out'
                      ? 'The wallet did not respond.'
                      : stage === 'failed'
                        ? 'The payment failed.'
                        : 'The wallet rejected the signature.')}
                </p>
                <p className="mt-1 text-body-sm text-ink-8">{failDetail ?? 'Nothing was sent.'}</p>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={retry}
                className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-md border-2 border-rose bg-rose px-4 py-2 text-body-sm font-semibold text-ink-0 whitespace-nowrap cursor-pointer"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-ink-5 bg-ink-2 px-4 py-2 text-body-sm text-ink-10 whitespace-nowrap cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {stage === 'settled' && (
          <button
            type="button"
            onClick={onClose}
            className="mt-6 inline-flex min-h-[44px] w-full items-center justify-center rounded-md border border-ink-5 bg-ink-2 px-4 py-2 text-body-sm text-ink-10 whitespace-nowrap cursor-pointer"
          >
            Done
          </button>
        )}
      </div>
    </div>
  );
}