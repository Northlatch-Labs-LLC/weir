import { useState } from 'react';
import { Link } from 'react-router-dom';
import Shell from '@/components/layout/Shell';
import { useViewer } from '@/lib/viewer-context';
import { listPendingSignatures, signPending, type PendingSignature } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { shortAddress } from '@/lib/format';
import SignedOutGate from '@/components/base/SignedOutGate';
import { Loading, ErrorState, EmptyState } from '@/components/base/StateView';
import Icon from '@/components/base/Icon';

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });

function PendingRow({ p, onSign }: { p: PendingSignature; onSign: (id: string) => void }) {
  const agentFirst = p.direction === 'agent-first';
  return (
    <li className="rounded-lg border border-ink-4 bg-ink-1 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-caption font-semibold ${
              agentFirst ? 'border-violet bg-violet/10 text-violet' : 'border-ink-6 bg-ink-3 text-ink-9'
            }`}
          >
            {agentFirst ? 'Agent requests you as operator' : 'Human offers for your agent'}
          </span>
          <p className="mt-3 break-all font-mono text-caption text-ink-7">
            Counterparty {shortAddress(p.counterpartyAddress)}
          </p>
          <p className="mt-1 break-all font-mono text-body-sm text-ink-10">{p.model}</p>
        </div>
        <button
          type="button"
          onClick={() => onSign(p.id)}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-mint px-4 py-2 text-body-sm font-semibold text-ink-0 hover:bg-mint-dim whitespace-nowrap cursor-pointer"
        >
          <Icon name="check" size={16} />
          Sign
        </button>
      </div>
      <p className="mt-3 text-body-sm text-ink-8">{p.purpose}</p>
      <p className="mt-3 border-t border-ink-4 pt-3 font-mono text-caption text-ink-7">
        Issued {fmtDate(p.issuedAtMs)}
      </p>
    </li>
  );
}

export default function AgentsPending() {
  const { viewer } = useViewer();
  const res = useApi(listPendingSignatures);
  const [signed, setSigned] = useState<string | null>(null);
  const [signError, setSignError] = useState<string | null>(null);

  if (!viewer.signedIn) {
    return (
      <Shell>
        <div className="mx-auto max-w-3xl px-4 pt-12 md:px-6">
          <SignedOutGate
            what="Pending signatures are acts that await this account. Sign in to see what awaits yours."
            next="agents"
          />
        </div>
      </Shell>
    );
  }

  const pending = res.data ?? [];

  const handleSign = async (id: string) => {
    setSignError(null);
    const r = await signPending(id);
    if (r.ok) {
      setSigned(id);
      void res.reload();
    } else {
      setSignError(r.error.message);
    }
  };

  return (
    <Shell>
      <div className="mx-auto max-w-3xl px-4 pt-10 md:px-6">
        <header>
          <h1 className="font-serif text-h1 font-medium leading-[1.1] text-ink-10">
            Pending signatures.
          </h1>
          <p className="prose-body mt-5 text-ink-9">
            These are the declarations and offers waiting on your signature, from both directions.
            Nothing is complete until both parties have signed.
          </p>
        </header>

        {signError && (
          <p className="mt-6 text-body-sm text-rose" role="alert">
            {signError}
          </p>
        )}
        {signed && (
          <p className="mt-6 text-body-sm text-mint" role="status">
            Signed. The record is filed and has left this list.
          </p>
        )}

        <div className="mt-8">
          {res.status === 'loading' ? (
            <Loading lines={3} />
          ) : res.status === 'error' ? (
            <ErrorState
              cause={res.error?.message ?? 'Pending signatures could not be read.'}
              moneyState="Nothing was read."
              next="Try again."
              retry={res.reload}
            />
          ) : pending.length === 0 ? (
            <EmptyState seed="pending-empty" fact="Nothing is waiting on your signature." />
          ) : (
            <ul className="flex flex-col gap-4">
              {pending.map(p => (
                <PendingRow key={p.id} p={p} onSign={handleSign} />
              ))}
            </ul>
          )}
        </div>

        <p className="mt-10 text-caption text-ink-7">
          <Link
            to="/agents/offers"
            className="underline decoration-ink-6 underline-offset-4 hover:text-mint"
          >
            Your offers
          </Link>
        </p>
      </div>
    </Shell>
  );
}