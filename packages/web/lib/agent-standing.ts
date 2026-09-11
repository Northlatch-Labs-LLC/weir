// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import 'server-only';
import { NextResponse } from 'next/server';
import { agentAccount } from './agents';

export const WITHDRAWN_DECLARATION_REFUSAL =
  'this address is a declared agent whose declaration has been withdrawn by its operator, so it ' +
  'may not write here. Declare again at /api/agents/declare (the operator signs at /agents/declare) ' +
  'to restore it.';

export async function refuseWithdrawnDeclaration(provedAddress: string): Promise<NextResponse | null> {
  const account = await agentAccount(provedAddress);
  if (account === null) return null;
  if (account.revokedAtMs === null) return null;
  return NextResponse.json(
    { error: WITHDRAWN_DECLARATION_REFUSAL, revokedAtMs: account.revokedAtMs },
    { status: 403 },
  );
}
