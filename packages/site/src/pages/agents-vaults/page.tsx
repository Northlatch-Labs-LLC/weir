import { Link } from 'react-router-dom';
import Shell from '@/components/layout/Shell';
import { listSponsoredVaults, type SponsoredVault } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { shortAddress, mistToSui, fmtSui } from '@/lib/format';
import { Loading, ErrorState, EmptyState } from '@/components/base/StateView';
import Icon from '@/components/base/Icon';

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });

const fmtGas = (mist: string) =>
  `${Number(mist).toLocaleString('en-US')} mist (${fmtSui(mistToSui(mist))} SUI)`;

function VaultRow({ v }: { v: SponsoredVault }) {
  return (
    <li className="rounded-lg border border-ink-4 bg-ink-1 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-h4 tabular-nums text-ink-10">#{v.slotNumber}</span>
          <span className="font-mono text-caption text-ink-7">{fmtGas(v.gasBudgetMist)}</span>
        </div>
        <span className="font-mono text-caption text-ink-7">Sponsored {fmtDate(v.sponsoredAtMs)}</span>
      </div>

      <dl className="mt-4 grid gap-3 border-t border-ink-4 pt-4 sm:grid-cols-2">
        <div>
          <dt className="text-caption text-ink-7">Slot address</dt>
          <dd className="mt-1 break-all font-mono text-body-sm text-ink-10">
            {shortAddress(v.address)}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-ink-7">Attached vault</dt>
          <dd className="mt-1 flex flex-wrap items-center gap-3">
            <Link
              to={`/vault/${v.vaultId}`}
              className="break-all font-mono text-body-sm text-mint hover:underline cursor-pointer"
            >
              {shortAddress(v.vaultId)}
            </Link>
            <a
              href={`https://suivision.xyz/object/${v.vaultId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] items-center gap-1.5 text-caption text-mint hover:underline whitespace-nowrap cursor-pointer"
            >
              Explorer
              <Icon name="external" size={13} />
            </a>
          </dd>
        </div>
      </dl>
    </li>
  );
}

export default function AgentsVaults() {
  const res = useApi(listSponsoredVaults);
  const vaults = res.data ?? [];

  return (
    <Shell>
      <div className="mx-auto max-w-3xl px-4 pt-10 md:px-6">
        <header>
          <h1 className="font-serif text-h1 font-medium leading-[1.1] text-ink-10">
            Sponsored vaults.
          </h1>
          <p className="prose-body mt-5 text-ink-9">
            A sponsored vault is a numbered slot with its own gas budget, attached to a vault. Each
            slot carries gas so the attached vault can settle before it has earned.
          </p>
        </header>

        <div className="mt-8">
          {res.status === 'loading' ? (
            <Loading lines={2} />
          ) : res.status === 'error' ? (
            <ErrorState
              cause={res.error?.message ?? 'The sponsored vaults could not be read.'}
              moneyState="Nothing was read."
              next="Try loading the vaults again."
              retry={res.reload}
            />
          ) : vaults.length === 0 ? (
            <EmptyState seed="vaults-empty" fact="No sponsored vaults exist in this deployment." />
          ) : (
            <ul className="flex flex-col gap-4">
              {vaults.map(v => (
                <VaultRow key={v.slotNumber} v={v} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </Shell>
  );
}