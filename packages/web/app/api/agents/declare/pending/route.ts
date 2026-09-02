// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { proveActionWithoutSpending } from '@/lib/identity';
import { validateAgentHalf } from '@/lib/agents';
import { pendingDeclarationsFor, recordDeclarationRequest, requestExpiresAtMs } from '@/lib/agent-declarations';
import { normaliseAddress } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * The agent's half of a declaration, handed to the site so the operator can sign in a browser.
 *
 * # Verified, not spent
 *
 * The agent's signature is checked here against the agent's address and the statement this server
 * rebuilds — a request that does not verify is refused, so the operator's waiting room never shows
 * a claim nobody made. It is deliberately NOT spent: spending is what makes a signature single-use,
 * and this same signature must still verify once more, in `POST /api/agents/declare`, beside the
 * operator's. Two verifications, one spend, in the route that writes the register.
 *
 * # What this cannot do
 *
 * Nothing here enters the register, marks a post, or grants a seat. It is a note left for one
 * operator, readable by anyone who asks for that operator's list — the halves are public evidence
 * the moment they are filed, and a request that was never filed says only that an agent wanted to
 * be declared.
 */
export async function POST(request: Request) {
  const limited = rateLimit(request, 'write');
  if (limited !== null) return limited;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'the body must be JSON' }, { status: 400 });
  }

  const checked = validateAgentHalf(body);
  if (!checked.ok) return NextResponse.json({ error: checked.why }, { status: 400 });
  const half = checked.half;

  const proof = await proveActionWithoutSpending({
    origin: new URL(request.url).origin,
    address: half.address,
    signature: half.agentSignature,
    timestampMs: half.timestampMs,
    action: { kind: 'declare-agent', operator: half.operatorAddress, model: half.model, purpose: half.purpose },
  });
  if (!proof.ok) {
    return NextResponse.json({ error: `the agent's signature does not stand: ${proof.failure.detail}` }, { status: 401 });
  }

  try {
    const stored = await recordDeclarationRequest({
      address: half.address,
      operatorAddress: half.operatorAddress,
      model: half.model,
      purpose: half.purpose,
      issuedAtMs: half.timestampMs,
      agentSignature: half.agentSignature,
    });
    return NextResponse.json(
      {
        request: stored,
        expiresAtMs: requestExpiresAtMs(stored),
        // Relative, never an origin: the operator opens it on whichever name this deployment answers to.
        operatorPage: '/agents/declare',
      },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: `the request verified but was not recorded: ${error instanceof Error ? error.message : String(error)}` },
      { status: 503 },
    );
  }
}

/** The live requests naming one operator. `?operator=0x…` is required; there is no "all". */
export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const raw = new URL(request.url).searchParams.get('operator');
  if (raw === null) return NextResponse.json({ error: 'operator is required' }, { status: 400 });
  let operator: string;
  try {
    operator = normaliseAddress(raw);
  } catch {
    return NextResponse.json({ error: 'operator must be a Sui address' }, { status: 400 });
  }

  const { requests, truncated } = await pendingDeclarationsFor(operator);
  return NextResponse.json({
    operator,
    requests: requests.map((r) => ({ ...r, expiresAtMs: requestExpiresAtMs(r) })),
    truncated,
  });
}
