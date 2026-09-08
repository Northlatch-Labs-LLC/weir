import { useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '@/components/base/Icon';
import { announceSettlement } from '@/components/base/WeirLine';
import { fmtSui, suiToMist } from '@/lib/format';
import type { CheckoutKind } from '@/lib/api';
import { pay, PAY_ORDER, useWallet, type PayStage } from '@/lib/wallet';
import { useViewer } from '@/lib/viewer-context';

// Support is a payment, not a gesture. The confirm reads "Send X SUI" — verb,
// exact amount, token. Every write is prepare → sign → submit, and the app
// owns none of the middle step: the wallet signs the exact bytes the backend
// produced. Progress states are honest, with a word or a shape as well as a
// colour. No percentage guesses, no confetti, no sound, and the amount never
// counts up or ticks.

const ECOSYSTEM_URL = 'https://sui.io/ecosystem';

type Stage = PayStage | 'confirm' | 'connect';

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
  mode: 'support' | 'unlock';
  creatorHandle: string;
  creatorName: string;
  price?: number;          // fixed price in SUI for unlock
  defaultAmount?: number;  // starting amount for support
  postId?: string;         // the unlocked post, when mode is unlock
  onClose: () => void;
  onSettled?: () => void;
};

export default function PaymentDialog({
  mode,
  creatorHandle,
  creatorName,
  price,
  defaultAmount = 0.25,
  postId,
  onClose,
  onSettled,
}: Props) {
  const { addHold } = useViewer();
  const { signer, wallets, connect, busy: connectBusy, error: connectError } = useWallet();
  const fixed = mode === 'unlock';
  const kind: CheckoutKind = mode === 'unlock' ? 'unlock' : 'tip';

  const [amount, setAmount] = useState(fixed ? (price ?? 0) : defaultAmount);
  const [stage, setStage] = useState<Stage>('confirm');
  const [digest, setDigest] = useState<string | null>(null);
  const [failMessage, setFailMessage] = useState<string | null>(null);
  const [failDetail, setFailDetail] = useState<string | null>(null);

  const fee = amount * 0.029;
  const toCreator = amount - fee;

  const confirm = async () => {
    // No wallet to sign with — ask for one at the moment of intent, in place.
    if (!signer) {
      setStage('connect');
      return;
    }

    setDigest(null);
    setFailMessage(null);
    setFailDetail(null);

    const res = await pay(
      {
        kind,
        creatorHandle,
        amountMist: suiToMist(amount),
        ...(postId ? { postId } : {}),
      },
      signer,
      (s, detail) => {
        setStage(s);
        if (detail) setFailMessage(detail);
      },
    );

    if (res.ok) {
      setDigest(res.data.digest);
      if (mode === 'unlock' && postId) addHold(postId);
      announceSettlement();
      onSettled?.();
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
    connect: 'Connect a wallet to pay.',
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
      aria-labelledby="pay-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-0/70 p-4 md:items-center"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Each stage announces itself to assistive technology. */}
      <div className="sr-only" aria-live="polite">{announcement[stage]}</div>

      <div className="w-full max-w-md rounded-lg border border-ink-4 bg-ink-1 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 id="pay-title" className="font-serif text-h3 font-medium text-ink-10">
              {mode === 'unlock' ? 'Unlock this post' : `Support @${creatorHandle}`}
            </h3>
            <p className="mt-1 text-caption text-ink-8">
              Coins leave your wallet and land in {creatorName}&apos;s vault. weir never holds them.
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
            <div className="mt-6">
              <label htmlFor="pay-amount" className="block text-body-sm text-ink-9">
                Amount, in SUI
              </label>
              <div className="mt-2 flex items-center gap-2">
                <input
                  id="pay-amount"
                  type="number"
                  min={0.05}
                  step={0.05}
                  value={amount}
                  disabled={fixed}
                  onChange={e => setAmount(Number(e.target.value))}
                  className="w-36 rounded-md border border-ink-5 bg-ink-2 px-3 py-2 font-mono text-body text-ink-10 tabular-nums"
                />
                <span className="text-body-sm text-ink-8">SUI</span>
              </div>
              {!fixed && (
                <div className="mt-2 flex gap-2">
                  {[0.1, 0.25, 1, 5].map(v => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setAmount(v)}
                      className="inline-flex min-h-[44px] items-center rounded-md border border-ink-5 bg-ink-2 px-3 py-1.5 font-mono text-caption text-ink-9 hover:text-ink-10 cursor-pointer"
                    >
                      {v}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <dl className="mt-6 space-y-2 rounded-md border border-ink-4 bg-ink-2 p-4 text-caption">
              <div className="flex justify-between">
                <dt className="text-ink-8">To creator vault</dt>
                <dd className="font-mono tabular-nums text-ink-10">{fmtSui(toCreator)} SUI</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-8">weir fee (2.9%)</dt>
                <dd className="font-mono tabular-nums text-ink-10">{fmtSui(fee)} SUI</dd>
              </div>
              <div className="flex justify-between border-t border-ink-4 pt-2">
                <dt className="text-ink-9">You sign for</dt>
                <dd className="font-mono tabular-nums text-ink-10">{fmtSui(amount)} SUI</dd>
              </div>
            </dl>

            {!signer && (
              <p className="mt-3 text-caption text-ink-7">
                You will need a connected wallet to sign.
              </p>
            )}

            <div className="mt-6 flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-md border border-ink-5 bg-ink-2 px-4 py-2 text-body-sm text-ink-10 whitespace-nowrap cursor-pointer"
              >
                Cancel
              </button>
              {/* The confirm is the irreversible step — rose, verb + amount + token. */}
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
                Connect a wallet to pay. Your coins go directly to {creatorName}&apos;s vault, and
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

            {connectError && (
              <p className="mt-3 text-caption text-rose">{connectError}</p>
            )}

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
                        done ? 'border-mint bg-mint text-ink-0' : current ? 'border-ink-8 text-ink-8' : 'border-ink-5 text-ink-6'
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
                <Link to={`/receipt/${digest}`} className="font-mono text-mint underline underline-offset-4">
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