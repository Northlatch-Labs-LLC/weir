// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { simulateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { prepareSetStakeAccepting, type CheckoutQuote } from '@/lib/checkout';
import { recordFailure } from '@/lib/error-log';

export const dynamic = 'force-dynamic';

/*
  Open or close a stake vault to new deposits. The creator's cap is the only key, so this asks for
  one and simulates against it; nothing here decides who may call set_accepting, the contract does.
*/
export async function POST(request: Request) {try {
  const limited = await simulateLimit(request);
  if (limited !== null) return limited;

  const body = (await request.json()) as {
    sender?: string;
    vaultId?: string;
    capId?: string;
    accepting?: boolean;
  };

  if (!body.sender || !body.vaultId || !body.capId || typeof body.accepting !== 'boolean') {
    return NextResponse.json(
      { error: 'sender, vaultId, capId and accepting are required' },
      { status: 400 },
    );
  }

  return fold<CheckoutQuote, NextResponse>(
    await prepareSetStakeAccepting({
      sender: body.sender,
      vaultId: body.vaultId,
      capId: body.capId,
      accepting: body.accepting,
    }),
    (quote) => NextResponse.json({ quote }),
    (failure) => NextResponse.json({ error: failure.detail, kind: failure.kind }, { status: 400 }),
  );
} catch (error) {
  await recordFailure({
    source: 'api route',
    detail: error instanceof Error ? error.message : String(error),
    route: '/api/stake/accepting',
  });
  return NextResponse.json({ error: 'this failed; the cause is recorded' }, { status: 500 });
}}
