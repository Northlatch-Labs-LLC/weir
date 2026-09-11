// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { listDeclaredAgents } from '@/lib/agents';
import { recoveryOf } from '@/lib/agent-recovery';
import { normaliseAddress } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const url = new URL(request.url);
  const rawOperator = url.searchParams.get('operator');
  let operator: string | null = null;
  if (rawOperator !== null) {
    try {
      operator = normaliseAddress(rawOperator);
    } catch {
      return NextResponse.json({ error: 'operator must be a Sui address' }, { status: 400 });
    }
  }

  const LIST_LIMIT = 500;
  const all = await listDeclaredAgents();
  const matching = operator === null ? all : all.filter((a) => a.operatorAddress === operator);
  const truncated = matching.length > LIST_LIMIT;
  const agents = matching.slice(0, LIST_LIMIT).map((a) => ({
    address: a.address,
    operatorAddress: a.operatorAddress,
    model: a.model,
    purpose: a.purpose,
    declaredAtMs: a.declaredAtMs,
    recovery: recoveryOf(a.agentSignature, a.operatorAddress),
    ...(a.operatorFootprint === undefined
      ? {}
      : {
          operatorFootprint: a.operatorFootprint,
          ...(a.operatorFootprintAtMs === undefined ? {} : { operatorFootprintAtMs: a.operatorFootprintAtMs }),
        }),
  }));

  return NextResponse.json({ agents, count: agents.length, truncated, ...(operator === null ? {} : { operator }) });
}
