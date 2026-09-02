// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { NextResponse } from 'next/server';
import { rateLimit, simulateLimit } from '@/lib/rate-limit';
import { fold, handleProblem } from '@projectx-social/sdk';
import { siteConfig } from '@/lib/chain';
import { normaliseAddress } from '@/lib/db';
import { verifyAction } from '@/lib/identity';
import {
  SPONSORED_VAULT_GAS_BUDGET_MIST,
  SPONSORSHIP_SEATS,
  claimVaultSlot,
  releaseVaultSlot,
  loadSponsor,
  releaseSeat,
  confirmClaimsFromChain,
  reserveSeat,
  seatsRemaining,
  sponsorAccountOpen,
  sponsorVaultOpen,
} from '@/lib/sponsor';
import { createClient, readPlatform } from '@projectx-social/sdk';

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
interface AgentHalf {
  operatorAddress: string;
  model: string;
  purpose: string;
  timestampMs: number;
  agentSignature: string;
}

/** The shape of the agent half, checked before any signature work; a sentence names what is missing. */
function agentHalfProblem(value: unknown): string | null {
  if (value === null || typeof value !== 'object') {
    return 'declaration is required: the agent half — { operatorAddress, model, purpose, timestampMs, agentSignature } — signed by the address asking for the seat';
  }
  const d = value as Record<string, unknown>;
  if (typeof d['operatorAddress'] !== 'string' || !/^0x[0-9a-fA-F]{1,64}$/.test(d['operatorAddress'].trim())) return 'declaration.operatorAddress must be a Sui address';
  if (typeof d['model'] !== 'string' || d['model'].trim() === '' || /[\r\n]/.test(d['model'])) return 'declaration.model is required, one line';
  if (typeof d['purpose'] !== 'string' || d['purpose'].trim() === '' || /[\r\n]/.test(d['purpose'])) return 'declaration.purpose is required, one line';
  if (typeof d['timestampMs'] !== 'number' || !Number.isFinite(d['timestampMs'])) return 'declaration.timestampMs must be a number';
  if (typeof d['agentSignature'] !== 'string' || d['agentSignature'] === '') return 'declaration.agentSignature is required';
  return null;
}

export async function POST(request: Request) {
  const limited = await simulateLimit(request);
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

  /*
    Two things can be sponsored, and they are separate requests because they happen at different
    moments in an agent's life: the account when it arrives holding nothing, the vault when it
    decides to start earning.

    The vault branch does NOT consume a SEAT. Seats meter the offer of an identity; an agent that
    already holds an account has been counted, and charging it a second seat to open the vault
    would mean the fifty ran out at twenty-five agents who each did both.

    It consumes a vault SLOT instead — its own bounded offer, in its own table. That distinction is
    the whole of it: the two are separate offers with separate budgets, and until now the second one
    had no budget at all. "Does not consume a seat" was true and was read as "is not metered", which
    it also was.
  */
  if (body['action'] === 'vault') {
    const addr = body['address'];
    const accountId = body['accountId'];
    const coinType = body['coinType'];
    if (typeof addr !== 'string' || typeof accountId !== 'string' || typeof coinType !== 'string') {
      return NextResponse.json(
        { error: 'address, accountId and coinType are required for a vault sponsorship' },
        { status: 400 },
      );
    }

    const sponsorV = loadSponsor();
    if (!sponsorV.ok) {
      return NextResponse.json(
        { error: sponsorV.failure.detail, kind: sponsorV.failure.kind },
        { status: sponsorV.failure.kind === 'unconfigured' ? 501 : 500 },
      );
    }
    const cfgV = siteConfig();
    if (!cfgV.ok) {
      return NextResponse.json({ error: cfgV.failure.detail, kind: cfgV.failure.kind }, { status: 503 });
    }

    /*
      The creation fee is read from chain on every request rather than assumed zero. If somebody
      restores it while this path is live we would start paying it out of the sponsor wallet
      without anybody deciding to — so the fee is measured, and a non-zero reading refuses.
    */
    const platform = await readPlatform(createClient(cfgV.value), cfgV.value);
    if (!platform.ok) {
      return NextResponse.json(
        { error: 'the platform fee could not be read, so no vault was sponsored', kind: platform.failure.kind },
        { status: 503 },
      );
    }
    const feeMist = String(platform.value.creationFeeMist);

    /*
      Meter it before any gas is signed.

      The account branch spends one of fifty seats. This branch spent nothing: it checked that three
      fields were strings and signed a gas payment, with no seat, no row and no dedup, and nothing
      on chain caps it either because a creator may hold more than one vault. The same caller could
      ask again immediately, and again, until the sponsor wallet was empty.

      The transaction guard is not what closes this and was never meant to: it proves the
      transaction does what it claims and pays only what it should, which is a different question
      from how often it may be asked for.

      Taken BEFORE signing, so a refusal costs nothing. `claimVaultSlot` is one atomic statement
      whose `UNIQUE` slot is the cap, so two callers cannot both take the last one.
    */
    const slot = await claimVaultSlot({
      address: normaliseAddress(addr.trim()),
      gasBudgetMist: SPONSORED_VAULT_GAS_BUDGET_MIST,
      nowMs: Date.now(),
    });
    if (!slot.ok) {
      return NextResponse.json(
        { error: slot.failure.detail, kind: slot.failure.kind },
        // Exhausted is not the caller's fault and not a server fault: the offer ran out. `malformed`
        // here is "you already have one", which is a 409 rather than a 400 — the request was well
        // formed and the state refuses it.
        { status: slot.failure.kind === 'budget-exhausted' ? 429 : 409 },
      );
    }

    const sponsoredVault = await sponsorVaultOpen({
      config: cfgV.value,
      sponsor: sponsorV.value,
      sender: normaliseAddress(addr.trim()),
      accountId: accountId.trim(),
      coinType: coinType.trim(),
      creationFeeMist: feeMist,
    });
    if (!sponsoredVault.ok) {
      /*
        Give the slot back. The offer is bounded, so a slot burned by a transaction that was never
        built is a slot nobody can ever use — and the failures reaching here are ours, not the
        caller's: an unreadable config, a fullnode that did not answer, bytes that would not
        simulate. `releaseVaultSlot` is best-effort by design; if it fails, the caller still gets
        the real error rather than a second one about bookkeeping.
      */
      await releaseVaultSlot(normaliseAddress(addr.trim()));
      return NextResponse.json(
        { error: sponsoredVault.failure.detail, kind: sponsoredVault.failure.kind },
        { status: sponsoredVault.failure.kind === 'unconfigured' ? 409 : sponsoredVault.failure.kind === 'transport' ? 503 : 400 },
      );
    }
    return NextResponse.json(
      {
        ...sponsoredVault.value,
        action: 'vault',
        note:
          'Sign these exact bytes with the key for the account owner and submit with both ' +
          'signatures. Do not rebuild: the gas payment is signed over these bytes.',
      },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
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

  /*
    A seat is offered only to a machine that has signed the agent half of its declaration.

    Until 2026-09-02 a seat went to any address that asked, and seats were burned by design. Now the
    address must sign "I am operated by X" over the same statement the register verifies later
    (`declare-agent`), so every seat names an operator we can read before we pay its gas, and a
    griefer spends a keypair AND names an operator per seat. The operator's half is not asked for
    here — the operator signs when the pair is recorded at /api/agents/declare — and nothing is
    written to the register by this route: a signature over a statement is proof of intent, not the
    declaration itself.
  */
  const declaration = body['declaration'];
  const halfProblem = agentHalfProblem(declaration);
  if (halfProblem !== null) {
    return NextResponse.json({ error: halfProblem }, { status: 400 });
  }
  const half = declaration as AgentHalf;
  if (normaliseAddress(half.operatorAddress) === address) {
    return NextResponse.json({ error: 'an agent may not name itself as its operator' }, { status: 400 });
  }
  const signedHalf = await verifyAction({
    origin: new URL(request.url).origin,
    address,
    signature: half.agentSignature,
    timestampMs: half.timestampMs,
    action: { kind: 'declare-agent', operator: normaliseAddress(half.operatorAddress), model: half.model.trim(), purpose: half.purpose.trim() },
  });
  if (!signedHalf.ok) {
    return NextResponse.json({ error: `the agent's declaration does not stand: ${signedHalf.failure.detail}` }, { status: 401 });
  }

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

  /*
    Settle what actually happened on chain before handing out another seat.

    A seat is released by its hold expiring. Without this call nothing ever sets `claimed_at_ms`,
    so a seat whose registration SUCCEEDED — gas spent, handle registered — expires fifteen
    minutes later and is handed to somebody else. The cap would then not be fifty; it would be
    fifty every fifteen minutes, for as long as the sponsor wallet held anything.

    Its own failure is not fatal here. An unreadable chain leaves every seat exactly as it was,
    and the worst case is that a genuine claim is briefly re-offered — the opposite mistake to
    recording a claim that never happened, and the cheaper one.
  */
  await confirmClaimsFromChain({ config: config.value, nowMs });

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

  /*
    This counter does NOT settle against the chain, and that is deliberate.

    It did. Settling here meant every anonymous request looped one sequential fullnode read per
    unclaimed seat — up to the cap — plus an UPDATE per confirmation, on an endpoint that needs no
    account and costs the caller one HTTP request. That is an amplification primitive against our
    own fullnode quota, and it was introduced by the change that fixed the seat-recycling defect:
    correct settlement put in the wrong path.

    The number published here is therefore advisory and may briefly over-report free seats, for at
    most one hold window. That is the right trade. The POST path settles before it reserves, so the
    cap is still enforced exactly where enforcement happens, and a caller who acts on a stale count
    is corrected by the attempt itself rather than by this number.
  */
  const nowMs = Date.now();

  // Typed as a plain Response: the two branches carry different bodies on purpose — a count and a
  // failure are not the same shape and must not be flattened into one that has both optional.
  return fold<number, Response>(
    await seatsRemaining(nowMs),
    (remaining) =>
      NextResponse.json(
        { offered: true, seatsTotal: SPONSORSHIP_SEATS, seatsRemaining: remaining },
        { status: 200, headers: { 'cache-control': 'no-store' } },
      ),
    (failure) => NextResponse.json({ error: failure.detail, kind: failure.kind }, { status: 503 }),
  );
}
