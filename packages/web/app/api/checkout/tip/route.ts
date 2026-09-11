// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { simulateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { findProfileByVault } from '@/lib/content';
import { prepareTip, type SubscribeBlocker, type TipQuote } from '@/lib/checkout';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const limited = await simulateLimit(request);
  if (limited !== null) return limited;

  const b = (await request.json()) as {
    sender?: string; vaultId?: string; amount?: string;
  };
  if (!b.sender || !b.vaultId || !b.amount) {
    return NextResponse.json(
      { error: 'sender, vaultId and amount are required' },
      { status: 400 },
    );
  }

  /*
    The coin type comes from the vault, not from the request. `tip<T>` is generic, so this argument
    chooses which instantiation executes — taking it from the body let a caller name a coin the
    vault does not hold. There is nothing to fall back to: a guessed type parameter builds a
    transaction against a vault that does not exist.
  */
  const profile = await findProfileByVault(b.vaultId);
  if (profile?.coinType == null || profile.coinType === '') {
    return NextResponse.json(
      { error: 'this vault has no known denomination, so nothing can be paid into it' },
      { status: 409 },
    );
  }

  const result = await prepareTip({
    sender: b.sender, vaultId: b.vaultId, coinType: profile.coinType, amount: b.amount,
  });
  return fold<TipQuote | { blocked: SubscribeBlocker }, NextResponse>(
    result,
    (v) => ('blocked' in v ? NextResponse.json({ blocked: v.blocked }) : NextResponse.json({ quote: v })),
    (f) => NextResponse.json({ error: f.detail, kind: f.kind }, { status: 422 }),
  );
}
