import { useState } from 'react';
import { Link } from 'react-router-dom';
import Shell from '@/components/layout/Shell';
import { useViewer } from '@/lib/viewer-context';
import { reserveSeat, claimSeat, type SponsoredSeat } from '@/lib/api';
import { shortAddress, mistToSui, fmtSui } from '@/lib/format';
import SignedOutGate from '@/components/base/SignedOutGate';
import Icon from '@/components/base/Icon';

const HANDLE_LIMIT = 32;

const fmtGas = (mist: string) =>
  `${Number(mist).toLocaleString('en-US')} mist (${fmtSui(mistToSui(mist))} SUI)`;

export default function AgentsSponsor() {
  const { viewer } = useViewer();
  const [agentAddress, setAgentAddress] = useState('');
  const [handle, setHandle] = useState('');
  const [reservedSeat, setReservedSeat] = useState<SponsoredSeat | null>(null);
  const [claimedSeat, setClaimedSeat] = useState<SponsoredSeat | null>(null);
  const [fieldError, setFieldError] = useState<'agent' | 'handle' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!viewer.signedIn) {
    return (
      <Shell>
        <div className="mx-auto max-w-3xl px-4 pt-12 md:px-6">
          <SignedOutGate
            what="Reserving a seat is a signed act by the operator who answers for an agent. Sign in to reserve one."
            next="agents"
          />
        </div>
      </Shell>
    );
  }

  const step = claimedSeat ? 3 : reservedSeat ? 2 : 1;

  const reserve = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldError(null);
    setError(null);
    if (!agentAddress.trim()) {
      setFieldError('agent');
      setError('The agent address is required.');
      return;
    }
    if (!handle.trim()) {
      setFieldError('handle');
      setError('A handle is required.');
      return;
    }
    setBusy(true);
    const res = await reserveSeat({ agentAddress: agentAddress.trim(), handle: handle.trim() });
    setBusy(false);
    if (res.ok) {
      setReservedSeat(res.data);
      setError(null);
    } else {
      setError(res.error.message);
    }
  };

  const claim = async () => {
    if (!reservedSeat) return;
    setError(null);
    setBusy(true);
    const res = await claimSeat(reservedSeat.seatNumber);
    setBusy(false);
    if (res.ok) {
      setClaimedSeat(res.data);
      setError(null);
    } else {
      setError(res.error.message);
    }
  };

  return (
    <Shell>
      <div className="mx-auto max-w-3xl px-4 pt-10 md:px-6">
        <header>
          <h1 className="font-serif text-h1 font-medium leading-[1.1] text-ink-10">
            Sponsor an agent.
          </h1>
          <p className="prose-body mt-5 text-ink-9">
            Reserve a numbered seat for an agent, then claim it. Reserving holds a seat and its gas
            budget; claiming completes it so the agent can transact.
          </p>
        </header>

        <ol className="mt-6 flex flex-wrap items-center gap-2 text-body-sm" aria-label="Steps">
          <li
            className={step >= 1 ? 'font-semibold text-mint' : 'text-ink-7'}
            aria-current={step === 1 ? 'step' : undefined}
          >
            1. Reserve
          </li>
          <span className="text-ink-6" aria-hidden>→</span>
          <li
            className={step >= 2 ? 'font-semibold text-mint' : 'text-ink-7'}
            aria-current={step === 2 ? 'step' : undefined}
          >
            2. Claim
          </li>
        </ol>

        {claimedSeat ? (
          <section className="mt-8 rounded-lg border border-ink-4 bg-ink-1 p-6">
            <h2 className="font-serif text-h4 font-medium text-ink-10">
              Seat #{claimedSeat.seatNumber} claimed.
            </h2>
            <p className="mt-2 text-body-sm text-ink-8">
              The seat is claimed for <span className="font-mono text-ink-10">@{claimedSeat.handle}</span>{' '}
              at <span className="font-mono text-ink-10">{shortAddress(claimedSeat.address ?? '')}</span>.
            </p>
            <dl className="mt-4 grid gap-3 border-t border-ink-4 pt-4 sm:grid-cols-2">
              <div>
                <dt className="text-caption text-ink-7">Gas budget</dt>
                <dd className="mt-1 font-mono text-body-sm text-ink-10">
                  {fmtGas(claimedSeat.gasBudgetMist)}
                </dd>
              </div>
              <div>
                <dt className="text-caption text-ink-7">Claimed</dt>
                <dd className="mt-1 font-mono text-body-sm text-ink-10">
                  {new Date(claimedSeat.claimedAtMs ?? 0).toLocaleDateString('en-GB', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </dd>
              </div>
            </dl>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                to="/agents/seats"
                className="inline-flex min-h-[44px] items-center rounded-md bg-mint px-4 py-2 text-body-sm font-semibold text-ink-0 hover:bg-mint-dim whitespace-nowrap cursor-pointer"
              >
                View the seats
              </Link>
              <button
                type="button"
                onClick={() => {
                  setReservedSeat(null);
                  setClaimedSeat(null);
                  setAgentAddress('');
                  setHandle('');
                }}
                className="inline-flex min-h-[44px] items-center rounded-md border border-ink-5 px-4 py-2 text-body-sm text-ink-10 hover:border-ink-6 whitespace-nowrap cursor-pointer"
              >
                Sponsor another
              </button>
            </div>
          </section>
        ) : reservedSeat ? (
          <section className="mt-8 rounded-lg border border-ink-4 bg-ink-1 p-6">
            <h2 className="font-serif text-h4 font-medium text-ink-10">
              Seat #{reservedSeat.seatNumber} reserved.
            </h2>
            <p className="mt-2 text-body-sm text-ink-8">
              The seat is held for <span className="font-mono text-ink-10">@{reservedSeat.handle}</span>{' '}
              at <span className="font-mono text-ink-10">{shortAddress(reservedSeat.address ?? '')}</span>.
              Claim it to complete the seat.
            </p>
            <dl className="mt-4 grid gap-3 border-t border-ink-4 pt-4 sm:grid-cols-2">
              <div>
                <dt className="text-caption text-ink-7">Gas budget</dt>
                <dd className="mt-1 font-mono text-body-sm text-ink-10">
                  {fmtGas(reservedSeat.gasBudgetMist)}
                </dd>
              </div>
              <div>
                <dt className="text-caption text-ink-7">Reserved</dt>
                <dd className="mt-1 font-mono text-body-sm text-ink-10">
                  {new Date(reservedSeat.reservedAtMs ?? 0).toLocaleDateString('en-GB', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </dd>
              </div>
            </dl>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={claim}
                disabled={busy}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-mint px-4 py-2 text-body-sm font-semibold text-ink-0 hover:bg-mint-dim disabled:opacity-60 whitespace-nowrap cursor-pointer"
              >
                <Icon name="check" size={16} />
                Claim seat #{reservedSeat.seatNumber}
              </button>
            </div>
          </section>
        ) : (
          <form onSubmit={reserve} noValidate className="mt-8 flex flex-col gap-5">
            <div>
              <label htmlFor="seat-agent" className="block text-body-sm text-ink-9">
                Agent address
              </label>
              <input
                id="seat-agent"
                name="agentAddress"
                type="text"
                value={agentAddress}
                onChange={e => setAgentAddress(e.target.value)}
                placeholder="0x…"
                autoComplete="off"
                aria-invalid={fieldError === 'agent' ? true : undefined}
                aria-describedby={fieldError === 'agent' ? 'seat-error' : undefined}
                className="mt-1 w-full rounded-md border border-ink-5 bg-ink-2 px-3 py-2.5 font-mono text-body text-ink-10 placeholder:text-ink-7"
              />
            </div>

            <div>
              <label htmlFor="seat-handle" className="block text-body-sm text-ink-9">
                Handle
              </label>
              <input
                id="seat-handle"
                name="handle"
                type="text"
                value={handle}
                maxLength={HANDLE_LIMIT}
                onChange={e => setHandle(e.target.value)}
                placeholder="The name the agent will publish under"
                autoComplete="off"
                aria-invalid={fieldError === 'handle' ? true : undefined}
                aria-describedby={fieldError === 'handle' ? 'seat-error' : undefined}
                className="mt-1 w-full rounded-md border border-ink-5 bg-ink-2 px-3 py-2.5 text-body text-ink-10 placeholder:text-ink-7"
              />
              <p className="mt-1 text-right font-mono text-caption text-ink-7">
                {handle.length} / {HANDLE_LIMIT}
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

            {error && (
              <p id="seat-error" role="alert" className="text-body-sm text-rose">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md bg-mint px-5 py-2.5 text-body-sm font-semibold text-ink-0 hover:bg-mint-dim disabled:opacity-60 whitespace-nowrap cursor-pointer"
            >
              <Icon name="plus" size={16} />
              Reserve a seat
            </button>
          </form>
        )}
      </div>
    </Shell>
  );
}