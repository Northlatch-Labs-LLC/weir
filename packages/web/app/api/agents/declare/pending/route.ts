// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import {
  isSignatureSpent,
  spendSignature,
  sweepUsedSignatures,
  verifyActionDeferringSpend,
} from '@/lib/identity';
import { operatorConflict, validateAgentHalf } from '@/lib/agents';
import { pendingDeclarationsFor, recordDeclarationRequest, requestExpiresAtMs } from '@/lib/agent-declarations';
import { db, normaliseAddress } from '@/lib/db';
import { recordFailure } from '@/lib/error-log';

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

  const checked = validateAgentHalf(body);
  if (!checked.ok) return NextResponse.json({ error: checked.why }, { status: 400 });
  const half = checked.half;

  const conflict = await operatorConflict(half.address, half.operatorAddress);
  if (conflict !== null) return NextResponse.json({ error: conflict }, { status: 409 });

  // Spent, not just proved: a verified-but-unspent declare half replayed for its whole
  // ten-minute window, pre-filing declarations under a captured signature. The spend commits
  // with the row so a failed write never strands one (Security F1 keeps its fixed sentence).
  const proof = await verifyActionDeferringSpend({
    origin: new URL(request.url).origin,
    address: half.address,
    signature: half.agentSignature,
    timestampMs: half.timestampMs,
    action: { kind: 'declare-agent', operator: half.operatorAddress, model: half.model, purpose: half.purpose },
  });
  if (!proof.ok) {
    return NextResponse.json({ error: `the agent's signature does not stand: ${proof.failure.detail}` }, { status: 401 });
  }
  if (proof.value !== null) {
    const spent = await isSignatureSpent(proof.value);
    if (!spent.ok) {
      await recordFailure({
        source: 'api route',
        detail: `${spent.failure.kind}: ${spent.failure.detail}`,
        route: '/api/agents/declare/pending',
      });
      return NextResponse.json({ error: spent.failure.detail }, { status: 503 });
    }
    if (spent.value) {
      return NextResponse.json({ error: 'this signature has already been used — sign again' }, { status: 401 });
    }
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    if (proof.value !== null) {
      const spent = await spendSignature(client, proof.value);
      if (!spent.ok) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: spent.failure.detail }, { status: 401 });
      }
    }
    const stored = await recordDeclarationRequest({
      address: half.address,
      operatorAddress: half.operatorAddress,
      model: half.model,
      purpose: half.purpose,
      issuedAtMs: half.timestampMs,
      agentSignature: half.agentSignature,
    }, client);
    await client.query('COMMIT');
    void sweepUsedSignatures();
    return NextResponse.json(
      {
        request: stored,
        expiresAtMs: requestExpiresAtMs(stored),
        operatorPage: '/agents/declare',
      },
      { status: 201 },
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error(
      JSON.stringify({
        declarationRequestRecordFailed: error instanceof Error ? error.message : String(error),
      }),
    );
    await recordFailure({
      source: 'api route',
      detail: error instanceof Error ? error.message : String(error),
      route: '/api/agents/declare/pending',
    });
    return NextResponse.json(
      { error: 'the request verified but the register is not reachable just now — try again' },
      { status: 503 },
    );
  } finally {
    client.release();
  }
}

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
