// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { verifyAction } from '@/lib/identity';
import { operatorConflict, recordDeclaration, validateDeclaration } from '@/lib/agents';
import { markDeclarationRequestFiled } from '@/lib/agent-declarations';
import { markOfferFiled, markSeekingClaimed } from '@/lib/agent-seeking';
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

  const byAgent = await verifyAction({
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
