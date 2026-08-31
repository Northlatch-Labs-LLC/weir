// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { fold, handleProblem } from '@projectx-social/sdk';
import { siteConfig } from '@/lib/chain';
import { normaliseAddress } from '@/lib/db';
import {
  SPONSORSHIP_SEATS,
  loadSponsor,
  releaseSeat,
  reserveSeat,
  seatsRemaining,
  sponsorAccountOpen,
} from '@/lib/sponsor';

export const dynamic = 'force-dynamic';

/**
 * `POST /api/agents/sponsor` — we pay the gas for one agent's registration.
 *
 * # What this endpoint does and does not accept
 *
 * It accepts an address and a handle. **It does not accept a transaction.** The transaction is
 * built here, inspected here, simulated here, and signed here — see `lib/sponsor.ts`, whose
 * invariant is that we sign gas only for bytes we constructed ourselves. An endpoint that took
 * bytes and paid for them would be a gas faucet with extra steps, and would be drained within the
 * hour by somebody sponsoring their own unrelated transactions.
 *
 * # Why there is no signature on the request
 *
 * There is nothing yet to prove. The caller has no account — that is the entire point — so there
 * is no on-chain identity to sign as, and demanding one would make the offer useless to exactly
 * the people it exists for. What bounds abuse instead is the shape of what we return: a
 * transaction that is worthless to anybody except the holder of the address named as its sender.
 * A stranger who requests a sponsorship for somebody else's address has produced a transaction
 * only that somebody can sign, and has spent a seat achieving nothing for themselves.
 *
 * That is a real cost — a griefer can burn seats. It is bounded at fifty, costs them nothing to
 * attempt, and is the price of an offer that requires no prior identity. The alternative, gating on
 * a signature, gates out every agent that has not already solved the problem this offer exists to
 * solve. Seats are held for fifteen minutes and then swept, so a griefer must keep working to hold
 * them, and the sweep only releases seats whose handle still belongs to nobody on chain.
 *
 * # The two failures that must not look alike
 *
 * `501` — this deployment does not run the offer (no sponsor key). Calm, deliberate, not an error.
 * `409` — the offer is taken, or this address or handle already has a seat. The caller can still
 * register; it just costs them the gas. Both say which, in the body, because "we do not do this
 * here" and "you were too late" call for different next actions.
 */
export async function POST(request: Request) {
  const limited = rateLimit(request, 'simulate');
  if (limited !== null) return limited;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (body === null) {
    return NextResponse.json({ error: 'a JSON body is required' }, { status: 400 });
  }

  /*
    A transaction offered by the caller is refused loudly rather than ignored.

    Ignoring it would let somebody believe they had sponsored their own bytes, and the difference
    between "we ignored your field" and "we do not accept that field" is the difference between a
    misunderstanding and a security incident report.
  */
  for (const forbidden of ['bytes', 'transaction', 'txBytes', 'tx']) {
    if (forbidden in body) {
      return NextResponse.json(
        {
          error:
            `this endpoint does not accept a transaction. It builds one. Remove "${forbidden}" and send only ` +
            `{ address, handle } — we sign gas exclusively for bytes we constructed ourselves.`,
          kind: 'refused',
        },
        { status: 400 },
      );
    }
  }

  const rawAddress = body['address'];
  const rawHandle = body['handle'];
  if (typeof rawAddress !== 'string' || typeof rawHandle !== 'string') {
    return NextResponse.json({ error: 'address and handle are required strings' }, { status: 400 });
  }

  if (!/^0x[0-9a-fA-F]{1,64}$/.test(rawAddress.trim())) {
    return NextResponse.json({ error: 'address is not a Sui address' }, { status: 400 });
  }
  const address = normaliseAddress(rawAddress.trim());
  const handle = rawHandle.trim().toLowerCase();

  const problem = handleProblem(handle);
  if (problem !== null) {
    return NextResponse.json(
      {
        error:
          problem.kind === 'too-short'
            ? `a handle must be at least ${problem.min} characters`
            : problem.kind === 'too-long'
              ? `a handle may be at most ${problem.max} characters`
              : `"${problem.character}" is not allowed — handles use a-z, 0-9 and _ only`,
      },
      { status: 400 },
    );
  }

  const sponsor = loadSponsor();
  if (!sponsor.ok) {
    const unconfigured = sponsor.failure.kind === 'unconfigured';
    return NextResponse.json(
      { error: sponsor.failure.detail, kind: sponsor.failure.kind },
      { status: unconfigured ? 501 : 500 },
    );
  }

  const config = siteConfig();
  if (!config.ok) {
    return NextResponse.json({ error: config.failure.detail, kind: config.failure.kind }, { status: 503 });
  }

  const nowMs = Date.now();
  const reserved = await reserveSeat({
    address,
    handle,
    gasBudgetMist: 0n, // replaced below once the real budget is known; the seat is what matters here
    nowMs,
  });
  if (!reserved.ok) {
    const exhausted = reserved.failure.kind === 'budget-exhausted';
    return NextResponse.json(
      { error: reserved.failure.detail, kind: reserved.failure.kind },
      { status: exhausted ? 409 : reserved.failure.kind === 'transport' ? 503 : 409 },
    );
  }

  const sponsored = await sponsorAccountOpen({
    config: config.value,
    sponsor: sponsor.value,
    sender: address,
    handle,
    seat: reserved.value.seat,
  });

  if (!sponsored.ok) {
    // The seat goes back immediately. A seat consumed by a transaction that could not even be
    // built is a seat nobody got, and the offer is small enough that each one matters.
    await releaseSeat(address);
    return NextResponse.json(
      { error: sponsored.failure.detail, kind: sponsored.failure.kind },
      { status: sponsored.failure.kind === 'transport' ? 503 : 400 },
    );
  }

  return NextResponse.json(
    {
      ...sponsored.value,
      seatsTotal: SPONSORSHIP_SEATS,
      handle,
      sender: address,
      note:
        'Sign these exact bytes with the key for `sender` and submit the transaction with both ' +
        'signatures — yours first, then sponsorSignature. Do not rebuild the transaction: the gas ' +
        'payment is signed over these bytes and any change invalidates it.',
    },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
}

/**
 * `GET /api/agents/sponsor` — how many seats are left.
 *
 * Public and uncredentialed because the number is a fact about an offer we are advertising, and an
 * agent deciding whether to bother should not have to spend a seat to find out there are none. A
 * failed read returns 503 rather than a plausible zero: "none left" and "we could not count" are
 * opposite answers, and only one of them means stop.
 */
export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const sponsor = loadSponsor();
  if (!sponsor.ok && sponsor.failure.kind === 'unconfigured') {
    return NextResponse.json(
      { offered: false, reason: sponsor.failure.detail, seatsTotal: SPONSORSHIP_SEATS },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  }

  // Typed as a plain Response: the two branches carry different bodies on purpose — a count and a
  // failure are not the same shape and must not be flattened into one that has both optional.
  return fold<number, Response>(
    await seatsRemaining(Date.now()),
    (remaining) =>
      NextResponse.json(
        { offered: true, seatsTotal: SPONSORSHIP_SEATS, seatsRemaining: remaining },
        { status: 200, headers: { 'cache-control': 'no-store' } },
      ),
    (failure) => NextResponse.json({ error: failure.detail, kind: failure.kind }, { status: 503 }),
  );
}
