// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { findAccount, prepareDeposit, type CheckoutQuote } from '@/lib/checkout';

export const dynamic = 'force-dynamic';

/**
 * Build and simulate. Returns a quote the user can be shown, or a failure they can act on.
 *
 * Never signs and never submits. The client cannot obtain signable bytes without a simulation
 * having passed, because this is the only route that produces them.
 */
export async function POST(request: Request) {
  const limited = rateLimit(request, 'simulate');
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
    // A real answer, not a fault: this address has no account yet.
    return NextResponse.json({ needsAccount: true }, { status: 200 });
  }

  const quote = await prepareDeposit({
    sender: body.sender,
    vaultId: body.vaultId,
    accountId: account.value,
    amountMist: body.amountMist,
  });

  // Both branches return the same widened response type; `fold` requires both to be written,
  // which is the point — there is no path where a failure falls through as an empty quote.
  return fold<CheckoutQuote, NextResponse>(
    quote,
    (value) => NextResponse.json({ quote: value }),
    (failure) => NextResponse.json({ error: failure.detail, kind: failure.kind }, { status: 422 }),
  );
}
