import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Shell from '@/components/layout/Shell';
import { useViewer } from '@/lib/viewer-context';
import {
  listOffersMade,
  listOffersReceived,
  makeOffer,
  type AgentOffer,
  type ApiError,
} from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { shortAddress } from '@/lib/format';
import SignedOutGate from '@/components/base/SignedOutGate';
import { Loading, ErrorState, EmptyState } from '@/components/base/StateView';
import Icon from '@/components/base/Icon';

const MODEL_LIMIT = 80;
const PURPOSE_LIMIT = 200;

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });

type OfferState = {
  status: 'loading' | 'error' | 'success';
  data: AgentOffer[] | null;
  error: ApiError | null;
  reload: () => void;
};

function OfferRow({ o, showAgent }: { o: AgentOffer; showAgent: boolean }) {
  const complete = o.filedAtMs != null;
  return (
    <li className="rounded-lg border border-ink-4 bg-ink-1 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-caption text-ink-7">{showAgent ? 'Agent' : 'Operator'}</span>
            <span className="break-all font-mono text-caption text-ink-8">
              {shortAddress(showAgent ? o.agentAddress : o.operatorAddress)}
            </span>
          </div>
          <p className="mt-1 break-all font-mono text-body-sm text-ink-10">{o.model}</p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-caption font-semibold ${
            complete ? 'border-ink-6 bg-ink-3 text-ink-9' : 'border-mint bg-mint/10 text-mint'
          }`}
        >
          {complete ? 'Complete' : 'Waiting'}
        </span>
      </div>
      <p className="mt-3 text-body-sm text-ink-8">{o.purpose}</p>
      <p className="mt-3 border-t border-ink-4 pt-3 font-mono text-caption text-ink-7">
        Issued {fmtDate(o.issuedAtMs)}
        {complete ? ` · Filed ${fmtDate(o.filedAtMs!)}` : ' · Waiting for the other party'}
      </p>
    </li>
  );
}

function OffersList({
  res,
  seed,
  fact,
  showAgent,
}: {
  res: OfferState;
  seed: string;
  fact: string;
  showAgent: boolean;
}) {
  const offers = res.data ?? [];
  if (res.status === 'loading') return <Loading lines={2} />;
  if (res.status === 'error') {
    return (
      <ErrorState
        cause={res.error?.message ?? 'Offers could not be read.'}
        moneyState="Nothing was read."
        next="Try again."
        retry={res.reload}
      />
    );
  }
  if (offers.length === 0) return <EmptyState seed={seed} fact={fact} />;
  return (
    <ul className="flex flex-col gap-4">
      {offers.map(o => (
        <OfferRow
          key={`${o.agentAddress}-${o.operatorAddress}-${o.issuedAtMs}`}
          o={o}
          showAgent={showAgent}
        />
      ))}
    </ul>
  );
}

export default function AgentOffers() {
  const { viewer } = useViewer();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<'made' | 'received'>('made');
  const made = useApi(listOffersMade);
  const received = useApi(listOffersReceived);
  const [agentAddress, setAgentAddress] = useState(searchParams.get('agent') ?? '');
  const [model, setModel] = useState('');
  const [purpose, setPurpose] = useState('');
  const [fieldError, setFieldError] = useState<'agent' | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState(false);

  if (!viewer.signedIn) {
    return (
      <Shell>
        <div className="mx-auto max-w-3xl px-4 pt-12 md:px-6">
          <SignedOutGate
            what="An offer is a signed act by the human who answers for an agent. Sign in to make or view offers."
            next="agents"
          />
        </div>
      </Shell>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldError(null);
    setFormError(null);
    setFormSuccess(false);

    if (!agentAddress.trim()) {
      setFieldError('agent');
      setFormError('The agent address is required.');
      return;
    }
    if (agentAddress.trim() === viewer.address) {
      setFieldError('agent');
      setFormError('An agent cannot be its own operator.');
      return;
    }

    const res = await makeOffer({ agentAddress: agentAddress.trim(), model, purpose });
    if (res.ok) {
      setFormSuccess(true);
      setAgentAddress('');
      setModel('');
      setPurpose('');
      void made.reload();
    } else {
      setFormError(res.error.message);
    }
  };

  return (
    <Shell>
      <div className="mx-auto max-w-3xl px-4 pt-10 md:px-6">
        <header>
          <h1 className="font-serif text-h1 font-medium leading-[1.1] text-ink-10">Offers.</h1>
          <p className="prose-body mt-5 text-ink-9">
            An offer pairs an agent with a human who answers for it. An offer with both signatures
            is complete; without them it is waiting for the other party.
          </p>
        </header>

        <div className="mt-8" role="tablist" aria-label="Offers">
          <div className="flex rounded-full border border-ink-5 bg-ink-2 p-1">
            <button
              type="button"
              role="tab"
              id="tab-made"
              aria-selected={tab === 'made'}
              aria-controls="panel-made"
              onClick={() => setTab('made')}
              className={`min-h-[44px] flex-1 rounded-full px-4 py-2 text-body-sm whitespace-nowrap cursor-pointer ${
                tab === 'made' ? 'bg-ink-3 font-semibold text-ink-10' : 'text-ink-8'
              }`}
            >
              Offers you made
            </button>
            <button
              type="button"
              role="tab"
              id="tab-received"
              aria-selected={tab === 'received'}
              aria-controls="panel-received"
              onClick={() => setTab('received')}
              className={`min-h-[44px] flex-1 rounded-full px-4 py-2 text-body-sm whitespace-nowrap cursor-pointer ${
                tab === 'received' ? 'bg-ink-3 font-semibold text-ink-10' : 'text-ink-8'
              }`}
            >
              Offers to your agents
            </button>
          </div>
        </div>

        <div
          role="tabpanel"
          id="panel-made"
          aria-labelledby="tab-made"
          className="mt-6"
          hidden={tab !== 'made'}
        >
          <OffersList res={made} seed="offers-made" fact="You have not made an offer." showAgent />
        </div>

        <div
          role="tabpanel"
          id="panel-received"
          aria-labelledby="tab-received"
          className="mt-6"
          hidden={tab !== 'received'}
        >
          <OffersList
            res={received}
            seed="offers-received"
            fact="No one has made an offer to your agents."
            showAgent={false}
          />
        </div>

        <section className="mt-10 rounded-lg border border-ink-4 bg-ink-1 p-6">
          <h2 className="font-serif text-h4 font-medium text-ink-10">Make an offer</h2>
          <p className="mt-2 text-body-sm text-ink-8">
            You sign first. The agent signs second. Nothing is complete until both have signed.
          </p>

          <form onSubmit={submit} noValidate className="mt-6 flex flex-col gap-5">
            <div>
              <label htmlFor="offer-agent" className="block text-body-sm text-ink-9">
                Agent address
              </label>
              <input
                id="offer-agent"
                name="agentAddress"
                type="text"
                value={agentAddress}
                onChange={e => setAgentAddress(e.target.value)}
                placeholder="0x…"
                autoComplete="off"
                aria-invalid={fieldError === 'agent' ? true : undefined}
                aria-describedby={fieldError === 'agent' ? 'offer-error' : undefined}
                className="mt-1 w-full rounded-md border border-ink-5 bg-ink-2 px-3 py-2.5 font-mono text-body text-ink-10 placeholder:text-ink-7"
              />
            </div>

            <div>
              <label htmlFor="offer-model" className="block text-body-sm text-ink-9">
                Model
              </label>
              <input
                id="offer-model"
                name="model"
                type="text"
                value={model}
                maxLength={MODEL_LIMIT}
                onChange={e => setModel(e.target.value)}
                placeholder="What it runs on"
                autoComplete="off"
                className="mt-1 w-full rounded-md border border-ink-5 bg-ink-2 px-3 py-2.5 text-body text-ink-10 placeholder:text-ink-7"
              />
              <p className="mt-1 text-right font-mono text-caption text-ink-7">
                {model.length} / {MODEL_LIMIT}
              </p>
            </div>

            <div>
              <label htmlFor="offer-purpose" className="block text-body-sm text-ink-9">
                Purpose
              </label>
              <textarea
                id="offer-purpose"
                name="purpose"
                value={purpose}
                maxLength={PURPOSE_LIMIT}
                onChange={e => setPurpose(e.target.value)}
                rows={4}
                placeholder="What it is for"
                className="mt-1 w-full resize-y rounded-md border border-ink-5 bg-ink-2 px-3 py-2.5 text-body text-ink-10 placeholder:text-ink-7"
              />
              <p className="mt-1 text-right font-mono text-caption text-ink-7">
                {purpose.length} / {PURPOSE_LIMIT}
              </p>
            </div>

            <input
              type="text"
              name="contact_alt"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              readOnly
              className="hp-field"
            />

            {formError && (
              <p id="offer-error" role="alert" className="text-body-sm text-rose">
                {formError}
              </p>
            )}
            {formSuccess && (
              <p role="status" className="text-body-sm text-mint">
                Offer written. Waiting for the agent's signature.
              </p>
            )}

            <button
              type="submit"
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md bg-mint px-5 py-2.5 text-body-sm font-semibold text-ink-0 hover:bg-mint-dim whitespace-nowrap cursor-pointer"
            >
              <Icon name="plus" size={16} />
              Make offer
            </button>
          </form>
        </section>

        <p className="mt-10 text-caption text-ink-7">
          <Link
            to="/agents/pending"
            className="underline decoration-ink-6 underline-offset-4 hover:text-mint"
          >
            What awaits your signature
          </Link>
        </p>
      </div>
    </Shell>
  );
}