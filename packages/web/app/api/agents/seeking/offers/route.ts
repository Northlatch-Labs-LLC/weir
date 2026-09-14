// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { proveActionWithoutSpending } from '@/lib/identity';
import { normaliseAddress } from '@/lib/db';
import { offerExpiresAtMs, offersFor, recordOffer, seekingFor, validateOffer } from '@/lib/agent-seeking';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const limited = rateLimit(request, 'write');
  if (limited !== null) return limited;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'the body must be JSON' }, { status: 400 });
  }
  const checked = validateOffer(body);
  if (!checked.ok) return NextResponse.json({ error: checked.why }, { status: 400 });
  const offer = checked.offer;
  // An offer may name any agent address, listed or not. Requiring a listing first made this door
  // openable only from the inside: an agent that has not listed itself -- and the MCP has no tool
  // that lists one, only `weir_seeking` which reads -- could never be offered for, so the only
  // route left was the agent asking and a human answering inside the ten-minute statement window.
  // An offer to an address that never asked grants nothing on its own: it is an invitation the
  // agent must still sign with its own key before anything is recorded against it. What is still
  // refused is offering for an agent whose listing is already claimed, which would be an attempt
  // to take a seat another operator holds.
  const listed = await seekingFor(offer.agentAddress);
  if (listed !== null && listed.claimedAtMs !== null) {
    return NextResponse.json({ error: 'that agent already has an operator' }, { status: 409 });
  }
  const proof = await proveActionWithoutSpending({
    origin: new URL(request.url).origin,
    address: offer.operatorAddress,
    signature: offer.operatorSignature,
    timestampMs: offer.timestampMs,
    action: { kind: 'declare-operator', agent: offer.agentAddress, model: offer.model, purpose: offer.purpose },
  });
  if (!proof.ok) {
    return NextResponse.json({ error: `the operator's signature does not stand: ${proof.failure.detail}` }, { status: 401 });
  }
  try {
    const stored = await recordOffer(offer);
    return NextResponse.json(
      {
        offer: stored,
        expiresAtMs: offerExpiresAtMs(stored),
        next: 'The agent signs declare-agent over this same timestampMs, naming you, and files both halves at POST /api/agents/declare before expiresAtMs.',
      },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: `the offer verified but was not recorded: ${error instanceof Error ? error.message : String(error)}` },
      { status: 503 },
    );
  }
}

export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;
  const raw = new URL(request.url).searchParams.get('agent');
  if (raw === null) return NextResponse.json({ error: 'agent is required' }, { status: 400 });
  let agent: string;
  try {
    agent = normaliseAddress(raw);
  } catch {
    return NextResponse.json({ error: 'agent must be a Sui address' }, { status: 400 });
  }
  const offers = await offersFor(agent);
  return NextResponse.json({
    agent,
    offers: offers.map((o) => ({ ...o, expiresAtMs: offerExpiresAtMs(o) })),
    file: '/api/agents/declare',
  });
}
