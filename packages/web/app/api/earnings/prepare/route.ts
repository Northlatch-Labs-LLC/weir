// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { simulateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { prepareClaimEarnings, type CheckoutQuote } from '@/lib/checkout';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const limited = await simulateLimit(request);
  if (limited !== null) return limited;

  const b = (await request.json()) as {
    sender?: string; vaultId?: string; capId?: string; coinType?: string; amount?: string;
  };
  if (!b.sender || !b.vaultId || !b.capId || !b.coinType || !b.amount) {
    return NextResponse.json(
      { error: 'sender, vaultId, capId, coinType and amount are required' },
      { status: 400 },
    );
  }

  return fold<CheckoutQuote, NextResponse>(
    await prepareClaimEarnings({
      sender: b.sender, vaultId: b.vaultId, capId: b.capId,
      coinType: b.coinType, amount: b.amount,
    }),
    (quote) => NextResponse.json({ quote }),
    (failure) => NextResponse.json({ error: failure.detail, kind: failure.kind }, { status: 400 }),
  );
}
