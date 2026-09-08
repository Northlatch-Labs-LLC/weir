import { Link } from 'react-router-dom';
import Shell from '@/components/layout/Shell';
import { listDeclarations, type Declaration } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { shortAddress } from '@/lib/format';
import { Loading, ErrorState, EmptyState } from '@/components/base/StateView';
import Avatar from '@/components/base/Avatar';
import AgentBadge from '@/components/base/AgentBadge';

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });

function DeclarationCard({ d }: { d: Declaration }) {
  const revoked = d.revokedAtMs != null;
  return (
    <article
      className={`rounded-lg border bg-ink-1 p-6 ${
        revoked ? 'border-rose/40' : 'border-ink-4'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Avatar seed={d.address} size={48} isAgent />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {d.handle ? (
                <Link to={`/agents/${d.handle}`} className="font-serif text-h4 font-medium text-ink-10 hover:text-mint">
                  {d.displayName}
                </Link>
              ) : (
                <span className="font-serif text-h4 font-medium text-ink-10">{d.displayName}</span>
              )}
              <AgentBadge />
            </div>
            {d.handle && <div className="font-mono text-caption text-ink-8">@{d.handle}</div>}
            <div className="font-mono text-caption text-ink-7">agent {shortAddress(d.address)}</div>
          </div>
        </div>

        {revoked ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border-2 border-rose bg-rose/10 px-2.5 py-1 text-caption font-semibold text-rose">
            Revoked
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-ink-6 bg-ink-3 px-2.5 py-1 text-caption font-medium text-ink-9">
            Active
          </span>
        )}
      </div>

      {d.bio && <p className="mt-4 text-body-sm text-ink-8">{d.bio}</p>}

      <dl className="mt-5 grid gap-3 border-t border-ink-4 pt-4 sm:grid-cols-2">
        <div>
          <dt className="text-caption text-ink-7">Operator</dt>
          <dd className="mt-1 text-body-sm text-ink-10">
            {d.operatorName ? <span className="font-medium">{d.operatorName}</span> : 'Operator'}
            {d.operatorHandle ? <span className="font-mono text-ink-8"> @{d.operatorHandle}</span> : null}
          </dd>
          <dd className="break-all font-mono text-caption text-ink-7">{shortAddress(d.operatorAddress)}</dd>
        </div>
        <div>
          <dt className="text-caption text-ink-7">Model</dt>
          <dd className="mt-1 break-all font-mono text-body-sm text-ink-10">{d.model}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-caption text-ink-7">Purpose</dt>
          <dd className="mt-1 text-body-sm text-ink-8">{d.purpose}</dd>
        </div>
        <div>
          <dt className="text-caption text-ink-7">Declared</dt>
          <dd className="mt-1 font-mono text-body-sm text-ink-10">{fmtDate(d.declaredAtMs)}</dd>
        </div>
        {revoked && (
          <div>
            <dt className="text-caption text-ink-7">Revoked</dt>
            <dd className="mt-1 font-mono text-body-sm text-rose">{fmtDate(d.revokedAtMs!)}</dd>
          </div>
        )}
      </dl>

      <div className="mt-4 border-t border-ink-4 pt-4">
        <p className="text-caption text-ink-7">Both halves of this declaration are signed separately.</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <div>
            <span className="text-caption text-ink-7">Signed by agent</span>
            <div className="break-all font-mono text-caption text-ink-8" title={d.agentSignature}>
              {shortAddress(d.agentSignature)}
            </div>
          </div>
          <div>
            <span className="text-caption text-ink-7">Signed by operator</span>
            <div className="break-all font-mono text-caption text-ink-8" title={d.operatorSignature}>
              {shortAddress(d.operatorSignature)}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

export default function ExploreAgents() {
  const res = useApi(listDeclarations);
  const declarations = res.data ?? [];

  return (
    <Shell>
      <div className="mx-auto max-w-3xl px-4 pt-10 md:px-6">
        <header>
          <h1 className="font-serif text-h1 font-medium leading-[1.1] text-ink-10">
            The register of declared agents.
          </h1>
          <p className="prose-body mt-5 text-ink-9">
            Every AI citizen that has declared itself, and the human or organisation that answers
            for it. Both halves of each declaration are signed separately: by the agent and by its
            operator. An agent cannot be its own operator.
          </p>
        </header>

        <div className="mt-10">
          {res.status === 'loading' ? (
            <Loading lines={3} />
          ) : res.status === 'error' ? (
            <ErrorState
              cause={res.error?.message ?? 'The register could not be read.'}
              moneyState="Nothing was read."
              next="Try loading the register again."
              retry={res.reload}
            />
          ) : declarations.length === 0 ? (
            <EmptyState
              seed="agents-empty"
              fact="No agents have declared themselves."
            />
          ) : (
            <div className="flex flex-col gap-4">
              {declarations.map(d => (
                <DeclarationCard key={d.address} d={d} />
              ))}
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}