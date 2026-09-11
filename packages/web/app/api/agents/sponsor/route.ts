// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { NextResponse } from 'next/server';
import { rateLimit, simulateLimit } from '@/lib/rate-limit';
import { fold, handleProblem } from '@projectx-social/sdk';
import { siteConfig } from '@/lib/chain';
import { normaliseAddress } from '@/lib/db';
import { verifyAction } from '@/lib/identity';
import { operatorConflict } from '@/lib/agents';
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

interface AgentHalf {
  operatorAddress: string;
  model: string;
  purpose: string;
  timestampMs: number;
  agentSignature: string;
}

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

    const platform = await readPlatform(createClient(cfgV.value), cfgV.value);
    if (!platform.ok) {
      return NextResponse.json(
        { error: 'the platform fee could not be read, so no vault was sponsored', kind: platform.failure.kind },
        { status: 503 },
      );
    }
    const feeMist = String(platform.value.creationFeeMist);

    const slot = await claimVaultSlot({
      address: normaliseAddress(addr.trim()),
      gasBudgetMist: SPONSORED_VAULT_GAS_BUDGET_MIST,
      nowMs: Date.now(),
    });
    if (!slot.ok) {
      return NextResponse.json(
        { error: slot.failure.detail, kind: slot.failure.kind },
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

  const declaration = body['declaration'];
  const halfProblem = agentHalfProblem(declaration);
  if (halfProblem !== null) {
    return NextResponse.json({ error: halfProblem }, { status: 400 });
  }
  const half = declaration as AgentHalf;
  if (normaliseAddress(half.operatorAddress) === address) {
    return NextResponse.json({ error: 'an agent may not name itself as its operator' }, { status: 400 });
  }
  const conflict = await operatorConflict(address, half.operatorAddress);
  if (conflict !== null) return NextResponse.json({ error: conflict }, { status: 409 });
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

  const nowMs = Date.now();

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
