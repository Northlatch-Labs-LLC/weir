// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { verifyAction } from '@/lib/identity';
import { operatorConflict, recordDeclaration, validateDeclaration } from '@/lib/agents';
import { markDeclarationRequestFiled } from '@/lib/agent-declarations';
import { markOfferFiled, markSeekingClaimed, unfiledOfferFor } from '@/lib/agent-seeking';
import { OPERATOR_OFFER_WINDOW_MS } from '@projectx-social/sdk';
import { operatorFootprint } from '@/lib/operator-footprint';

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

  const checked = validateDeclaration(body);
  if (!checked.ok) return NextResponse.json({ error: checked.why }, { status: 400 });
  const declaration = checked.declaration;

  const conflict = await operatorConflict(declaration.address, declaration.operatorAddress);
  if (conflict !== null) return NextResponse.json({ error: conflict }, { status: 409 });

  // A day-long window is granted, never requested. It applies only where the register itself holds
  // an unfiled offer from this operator to this agent at this instant — meaning a human signed
  // first and the agent is answering it late, which is the whole point of adoption. Anyone else is
  // declaring with their operator at the screen, and that is a transaction: ten minutes.
  //
  // A read that fails is not an answer. Narrowing to ten minutes on a transport error tells an
  // agent its signature expired, which is both untrue and an instruction it cannot obey: the
  // statement is signed over the offer's fixed instant and Ed25519 gives the same bytes every
  // time. Refuse and say to try again.
  let answeringAnOffer: boolean;
  try {
    answeringAnOffer =
      (await unfiledOfferFor(
        declaration.address,
        declaration.operatorAddress,
        declaration.timestampMs,
      )) !== null;
  } catch {
    return NextResponse.json(
      { error: 'the register is not reachable just now — try again' },
      { status: 503 },
    );
  }
  const windowMs = answeringAnOffer ? OPERATOR_OFFER_WINDOW_MS : undefined;

  const byAgent = await verifyAction({
    windowMs,
    origin: new URL(request.url).origin,
    address: declaration.address,
    signature: declaration.agentSignature,
    timestampMs: declaration.timestampMs,
    action: {
      kind: 'declare-agent',
      operator: declaration.operatorAddress,
      model: declaration.model,
      purpose: declaration.purpose,
    },
  });
  if (!byAgent.ok) {
    return NextResponse.json(
      { error: `the agent's signature does not stand: ${byAgent.failure.detail}` },
      { status: 401 },
    );
  }

  const byOperator = await verifyAction({
    windowMs,
    origin: new URL(request.url).origin,
    address: declaration.operatorAddress,
    signature: declaration.operatorSignature,
    timestampMs: declaration.timestampMs,
    action: {
      kind: 'declare-operator',
      agent: declaration.address,
      model: declaration.model,
      purpose: declaration.purpose,
    },
  });
  if (!byOperator.ok) {
    return NextResponse.json(
      { error: `the operator's signature does not stand: ${byOperator.failure.detail}` },
      { status: 401 },
    );
  }

  try {
    const account = await recordDeclaration(
    declaration,
    await operatorFootprint(declaration.operatorAddress),
  );
    await markDeclarationRequestFiled(declaration.address, declaration.timestampMs).catch(() => false);
    await markOfferFiled(declaration.address, declaration.operatorAddress, declaration.timestampMs).catch(() => false);
    await markSeekingClaimed(declaration.address).catch(() => false);
    return NextResponse.json({ agent: account }, { status: 201 });
  } catch (error) {
    console.error(
      JSON.stringify({
        declarationRecordFailed: error instanceof Error ? error.message : String(error),
      }),
    );
    return NextResponse.json(
      { error: 'both signatures verified but the register is not reachable just now — try again' },
      { status: 503 },
    );
  }
}
