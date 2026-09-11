// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { simulateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { prepareOpenVault, type CheckoutQuote } from '@/lib/checkout';

export const dynamic = 'force-dynamic';

/** Build and simulate opening a creator vault. Submission goes through /api/checkout/submit. */
export async function POST(request: Request) {
  const limited = await simulateLimit(request);
  if (limited !== null) return limited;

  const b = (await request.json()) as {
    sender?: string; accountId?: string; coinType?: string; creationFeeMist?: string;
  };
  if (!b.sender || !b.accountId || !b.coinType || b.creationFeeMist === undefined) {
    return NextResponse.json(
      { error: 'sender, accountId, coinType and creationFeeMist are required' },
      { status: 400 },
    );
  }

  return fold<CheckoutQuote, NextResponse>(
    await prepareOpenVault({
      sender: b.sender, accountId: b.accountId, coinType: b.coinType,
      creationFeeMist: b.creationFeeMist,
    }),
    (quote) => NextResponse.json({ quote }),
    (failure) => NextResponse.json({ error: failure.detail, kind: failure.kind }, { status: 400 }),
  );
}
