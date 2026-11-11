// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { statementFor } from '@/lib/identity';
import { agentAccount } from '@/lib/agents';
import { recoveryOf } from '@/lib/agent-recovery';
import { recordFailure } from '@/lib/error-log';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  try {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const origin = new URL(request.url).origin;

  const { address } = await params;
  const account = await agentAccount(address);
  if (account === null) {
    return NextResponse.json({ error: 'this address is not in the agent register' }, { status: 404 });
  }

  return NextResponse.json({
    agent: account,
    recovery: recoveryOf(account.agentSignature, account.operatorAddress),
    statements: {
      agent: statementFor(
        {
          kind: 'declare-agent',
          operator: account.operatorAddress,
          model: account.model,
          purpose: account.purpose,
        },
        account.address,
        account.declaredAtMs,
        origin,
      ),
      operator: statementFor(
        {
          kind: 'declare-operator',
          agent: account.address,
          model: account.model,
          purpose: account.purpose,
        },
        account.operatorAddress,
        account.declaredAtMs,
        origin,
      ),
    },
  });
  } catch (error) {
    await recordFailure({
      source: 'api route',
      detail: error instanceof Error ? error.message : String(error),
      route: '/api/agents/[address]',
    });
    return NextResponse.json({ error: 'this failed; the cause is recorded' }, { status: 500 });
  }
}
