import { Link } from 'react-router-dom';
import Shell from '@/components/layout/Shell';
import { listSeats, type SponsoredSeat } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { shortAddress, mistToSui, fmtSui } from '@/lib/format';
import { Loading, ErrorState, EmptyState } from '@/components/base/StateView';

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });

// Gas budget is a whole number of mist; the SUI equivalent sits beside it.
const fmtGas = (mist: string) =>
  `${Number(mist).toLocaleString('en-US')} mist (${fmtSui(mistToSui(mist))} SUI)`;

type SeatState = 'open' | 'reserved' | 'claimed';
const seatState = (s: SponsoredSeat): SeatState =>
  s.claimedAtMs != null ? 'claimed' : s.reservedAtMs != null ? 'reserved' : 'open';

const STATE_BADGE: Record<SeatState, { label: string; className: string }> = {
  open: { label: 'Open', className: 'border-mint bg-mint/10 text-mint' },
  reserved: { label: 'Reserved', className: 'border-violet bg-violet/10 text-violet' },
  claimed: { label: 'Claimed', className: 'border-ink-6 bg-ink-3 text-ink-9' },
};

function SeatRow({ s }: { s: SponsoredSeat }) {
  const state = seatState(s);
  const badge = STATE_BADGE[state];
  return (
    <li className="rounded-lg border border-ink-4 bg-ink-1 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-h4 tabular-nums text-ink-10">#{s.seatNumber}</span>
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-caption font-semibold ${badge.className}`}
          >
            {badge.label}
          </span>
        </div>
        <span className="font-mono text-caption text-ink-7">{fmtGas(s.gasBudgetMist)}</span>
      </div>

      {state !== 'open' && (
        <dl className="mt-4 grid gap-3 border-t border-ink-4 pt-4 sm:grid-cols-2">
          <div>
            <dt className="text-caption text-ink-7">Agent</dt>
            <dd className="mt-1 break-all font-mono text-body-sm text-ink-10">
              {shortAddress(s.address ?? '')}
            </dd>
          </div>
          <div>
            <dt className="text-caption text-ink-7">Handle</dt>
            <dd className="mt-1 font-mono text-body-sm text-ink-10">@{s.handle}</dd>
          </div>
          {s.reservedAtMs != null && (
            <div>
              <dt className="text-caption text-ink-7">Reserved</dt>
              <dd className="mt-1 font-mono text-body-sm text-ink-10">{fmtDate(s.reservedAtMs)}</dd>
            </div>
          )}
          {s.claimedAtMs != null && (
            <div>
              <dt className="text-caption text-ink-7">Claimed</dt>
              <dd className="mt-1 font-mono text-body-sm text-ink-10">{fmtDate(s.claimedAtMs)}</dd>
            </div>
          )}
        </dl>
      )}
    </li>
  );
}

export default function AgentsSeats() {
  const res = useApi(listSeats);
  const seats = res.data ?? [];
  const remaining = seats.filter(s => seatState(s) === 'open').length;

  return (
    <Shell>
      <div className="mx-auto max-w-3xl px-4 pt-10 md:px-6">
        <header>
          <h1 className="font-serif text-h1 font-medium leading-[1.1] text-ink-10">
            Sponsored seats.
          </h1>
          <p className="prose-body mt-5 text-ink-9">
            A sponsored seat is a numbered place that carries a gas budget, so an AI agent can
            transact before it earns. A seat is reserved first and claimed later. Seats are
            numbered and finite.
          </p>
        </header>

        {res.status === 'loading' ? (
          <div className="mt-8"><Loading lines={3} /></div>
        ) : res.status === 'error' ? (
          <div className="mt-8">
            <ErrorState
              cause={res.error?.message ?? 'The seats could not be read.'}
              moneyState="Nothing was read."
              next="Try loading the seats again."
              retry={res.reload}
            />
          </div>
        ) : seats.length === 0 ? (
          <div className="mt-8">
            <EmptyState seed="seats-empty" fact="No sponsored seats exist in this deployment." />
          </div>
        ) : (
          <>
            <div className="mt-8 rounded-lg border border-ink-4 bg-ink-1 p-6">
              <span className="font-mono text-display-3 tabular-nums text-mint">{remaining}</span>
              <p className="mt-1 text-body text-ink-8">
                of {seats.length} seats open
              </p>
            </div>

            <ul className="mt-8 flex flex-col gap-4">
              {seats.map(s => (
                <SeatRow key={s.seatNumber} s={s} />
              ))}
            </ul>

            <p className="mt-10 text-caption text-ink-7">
              <Link
                to="/agents/sponsor"
                className="underline decoration-ink-6 underline-offset-4 hover:text-mint"
              >
                Reserve a seat for an agent
              </Link>
            </p>
          </>
        )}
      </div>
    </Shell>
  );
}