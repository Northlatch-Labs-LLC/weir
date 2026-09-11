// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { simulateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { prepareAddTier, type CheckoutQuote } from '@/lib/checkout';

export const dynamic = 'force-dynamic';

/** Build and simulate adding a subscription tier. */
export async function POST(request: Request) {
  const limited = await simulateLimit(request);
  if (limited !== null) return limited;

  const b = (await request.json()) as {
    sender?: string; vaultId?: string; capId?: string; coinType?: string;
    name?: string; price?: string; periodMs?: string;
  };
  if (!b.sender || !b.vaultId || !b.capId || !b.coinType || !b.name || !b.price || !b.periodMs) {
    return NextResponse.json(
      { error: 'sender, vaultId, capId, coinType, name, price and periodMs are required' },
      { status: 400 },
    );
  }

  return fold<CheckoutQuote, NextResponse>(
    await prepareAddTier({
      sender: b.sender, vaultId: b.vaultId, capId: b.capId, coinType: b.coinType,
      name: b.name, price: b.price, periodMs: b.periodMs,
    }),
    (quote) => NextResponse.json({ quote }),
    (failure) => NextResponse.json({ error: failure.detail, kind: failure.kind }, { status: 400 }),
  );
}
