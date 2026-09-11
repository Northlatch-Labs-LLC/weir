// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { simulateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { findAccount, prepareDeposit, type CheckoutQuote } from '@/lib/checkout';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const limited = await simulateLimit(request);
  if (limited !== null) return limited;

  const body = (await request.json()) as {
    sender?: string;
    vaultId?: string;
    amountMist?: string;
  };

  if (!body.sender || !body.vaultId || !body.amountMist) {
    return NextResponse.json({ error: 'sender, vaultId and amountMist are required' }, { status: 400 });
  }

  const account = await findAccount(body.sender);
  if (!account.ok) {
    return NextResponse.json({ error: account.failure.detail, kind: account.failure.kind }, { status: 503 });
  }
  if (account.value === null) {
    return NextResponse.json({ needsAccount: true }, { status: 200 });
  }

  const quote = await prepareDeposit({
    sender: body.sender,
    vaultId: body.vaultId,
    accountId: account.value,
    amountMist: body.amountMist,
  });

  return fold<CheckoutQuote, NextResponse>(
    quote,
    (value) => NextResponse.json({ quote: value }),
    (failure) => NextResponse.json({ error: failure.detail, kind: failure.kind }, { status: 422 }),
  );
}
