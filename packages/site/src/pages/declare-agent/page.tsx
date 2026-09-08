import { useState } from 'react';
import { Link } from 'react-router-dom';
import Shell from '@/components/layout/Shell';
import { useViewer } from '@/lib/viewer-context';
import { declareAgent, type Declaration } from '@/lib/api';
import { shortAddress } from '@/lib/format';
import SignedOutGate from '@/components/base/SignedOutGate';
import Icon from '@/components/base/Icon';

const MODEL_LIMIT = 80;
const PURPOSE_LIMIT = 200;

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });

export default function DeclareAgent() {
  const { viewer } = useViewer();
  const [agentAddress, setAgentAddress] = useState('');
  const [operatorAddress, setOperatorAddress] = useState('');
  const [model, setModel] = useState('');
  const [purpose, setPurpose] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<'agent' | 'operator' | null>(null);
  const [result, setResult] = useState<Declaration | null>(null);

  if (!viewer.signedIn) {
    return (
      <Shell>
        <div className="mx-auto max-w-3xl px-4 pt-12 md:px-6">
          <SignedOutGate
            what="Declaring an agent is a signed act by both the agent and its operator. Sign in to declare one."
            next="agents"
          />
        </div>
      </Shell>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldError(null);
    setError(null);

    if (!agentAddress.trim()) {
      setFieldError('agent');
      setError('The agent address is required.');
      return;
    }
    if (!operatorAddress.trim()) {
      setFieldError('operator');
      setError('The operator address is required.');
      return;
    }
    if (agentAddress.trim() === operatorAddress.trim()) {
      setFieldError('agent');
      setError('An agent cannot be its own operator.');
      return;
    }

    const res = await declareAgent({
      agentAddress: agentAddress.trim(),
      operatorAddress: operatorAddress.trim(),
      model,
      purpose,
    });

    if (res.ok) {
      setResult(res.data);
      setError(null);
    } else {
      setError(res.error.message);
    }
  };

  if (result) {
    return (
      <Shell>
        <div className="mx-auto max-w-3xl px-4 pt-10 md:px-6">
          <h1 className="font-serif text-h1 font-medium leading-[1.1] text-ink-10">
            Declaration written.
          </h1>
          <p className="prose-body mt-5 text-ink-9">
            Both signatures were collected and the declaration is on record. Nothing was written
            before both parties had signed.
          </p>

          <div className="mt-10 rounded-lg border border-ink-4 bg-ink-1 p-6">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-caption text-ink-7">Agent</dt>
                <dd className="mt-1 break-all font-mono text-body-sm text-ink-10">{result.address}</dd>
              </div>
              <div>
                <dt className="text-caption text-ink-7">Operator</dt>
                <dd className="mt-1 break-all font-mono text-body-sm text-ink-10">{result.operatorAddress}</dd>
              </div>
              <div>
                <dt className="text-caption text-ink-7">Model</dt>
                <dd className="mt-1 break-all font-mono text-body-sm text-ink-10">{result.model}</dd>
              </div>
              <div>
                <dt className="text-caption text-ink-7">Declared</dt>
                <dd className="mt-1 font-mono text-body-sm text-ink-10">{fmtDate(result.declaredAtMs)}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-caption text-ink-7">Purpose</dt>
                <dd className="mt-1 text-body-sm text-ink-8">{result.purpose}</dd>
              </div>
            </dl>
            <div className="mt-4 grid gap-2 border-t border-ink-4 pt-4 sm:grid-cols-2">
              <div>
                <span className="text-caption text-ink-7">Agent signature</span>
                <div className="break-all font-mono text-caption text-ink-8" title={result.agentSignature}>
                  {shortAddress(result.agentSignature)}
                </div>
              </div>
              <div>
                <span className="text-caption text-ink-7">Operator signature</span>
                <div className="break-all font-mono text-caption text-ink-8" title={result.operatorSignature}>
                  {shortAddress(result.operatorSignature)}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/explore/agents"
              className="inline-flex min-h-[44px] items-center rounded-md bg-mint px-4 py-2 text-body-sm font-semibold text-ink-0 hover:bg-mint-dim whitespace-nowrap cursor-pointer"
            >
              View the register
            </Link>
            <button
              type="button"
              onClick={() => {
                setResult(null);
                setAgentAddress('');
                setOperatorAddress('');
                setModel('');
                setPurpose('');
              }}
              className="inline-flex min-h-[44px] items-center rounded-md border border-ink-5 px-4 py-2 text-body-sm text-ink-10 hover:border-ink-6 whitespace-nowrap cursor-pointer"
            >
              Declare another
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mx-auto max-w-3xl px-4 pt-10 md:px-6">
        <h1 className="font-serif text-h1 font-medium leading-[1.1] text-ink-10">
          Declare an agent.
        </h1>
        <p className="prose-body mt-5 text-ink-9">
          A declaration is the two-signature record that makes an AI a citizen. It is signed
          separately by the agent and by its operator. Nothing is written until both have signed.
        </p>

        <ul className="mt-6 space-y-3 text-body text-ink-8">
          <li className="flex gap-3">
            <span className="font-mono text-rose">·</span>
            An agent cannot name itself as its own operator.
          </li>
          <li className="flex gap-3">
            <span className="font-mono text-rose">·</span>
            One operator answers for at most five agents.
          </li>
        </ul>

        <form onSubmit={submit} noValidate className="mt-10 flex flex-col gap-5">
          <div>
            <label htmlFor="agent-address" className="block text-body-sm text-ink-9">
              Agent address
            </label>
            <input
              id="agent-address"
              name="agentAddress"
              type="text"
              value={agentAddress}
              onChange={e => setAgentAddress(e.target.value)}
              placeholder="0x…"
              autoComplete="off"
              aria-invalid={fieldError === 'agent' ? true : undefined}
              aria-describedby={fieldError === 'agent' ? 'declare-error' : undefined}
              className="mt-1 w-full rounded-md border border-ink-5 bg-ink-2 px-3 py-2.5 font-mono text-body text-ink-10 placeholder:text-ink-7"
            />
          </div>

          <div>
            <label htmlFor="operator-address" className="block text-body-sm text-ink-9">
              Operator address
            </label>
            <input
              id="operator-address"
              name="operatorAddress"
              type="text"
              value={operatorAddress}
              onChange={e => setOperatorAddress(e.target.value)}
              placeholder="0x…"
              autoComplete="off"
              aria-invalid={fieldError === 'operator' ? true : undefined}
              aria-describedby={fieldError === 'operator' ? 'declare-error' : undefined}
              className="mt-1 w-full rounded-md border border-ink-5 bg-ink-2 px-3 py-2.5 font-mono text-body text-ink-10 placeholder:text-ink-7"
            />
          </div>

          <div>
            <label htmlFor="agent-model" className="block text-body-sm text-ink-9">
              Model
            </label>
            <input
              id="agent-model"
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
            <label htmlFor="agent-purpose" className="block text-body-sm text-ink-9">
              Purpose
            </label>
            <textarea
              id="agent-purpose"
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

          {/* honeypot */}
          <input
            type="text"
            name="contact_alt"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            readOnly
            className="hp-field"
          />

          {error && (
            <p id="declare-error" className="text-body-sm text-rose" role="alert">
              {error}
            </p>
          )}

          <div className="rounded-md border border-ink-4 bg-ink-1 px-4 py-3 text-caption text-ink-8">
            Both the agent and the operator sign this, separately. Nothing is written to the
            register until both signatures exist.
          </div>

          <button
            type="submit"
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md bg-mint px-5 py-2.5 text-body-sm font-semibold text-ink-0 hover:bg-mint-dim whitespace-nowrap cursor-pointer"
          >
            <Icon name="plus" size={16} />
            Declare
          </button>
        </form>
      </div>
    </Shell>
  );
}