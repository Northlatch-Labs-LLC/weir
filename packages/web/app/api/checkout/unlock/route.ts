// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { simulateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { findProfileByVault } from '@/lib/content';
import { prepareUnlock, type SubscribeBlocker, type UnlockQuote } from '@/lib/checkout';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const limited = await simulateLimit(request);
  if (limited !== null) return limited;

  const b = (await request.json()) as {
    sender?: string; vaultId?: string;
    contentKey?: string; expectedPrice?: string;
  };
  if (!b.sender || !b.vaultId || !b.contentKey || !b.expectedPrice) {
    return NextResponse.json(
      { error: 'sender, vaultId, contentKey and expectedPrice are required' },
      { status: 400 },
    );
  }

  /*
    The coin type comes from the vault, not from the request.

    `unlock<T>` is a generic call, so `coinType` chooses which instantiation executes. Taking it
    from the body let a caller name a different coin than the vault actually holds — the same shape
    as the authorship checks that compared a public value against one the caller supplied. The
    vault's own denomination is the only correct answer, and there is nothing to fall back to: a
    guessed type parameter builds a transaction against a vault that does not exist.
  */
  const profile = await findProfileByVault(b.vaultId);
  if (profile?.coinType == null || profile.coinType === '') {
    return NextResponse.json(
      { error: 'this vault has no known denomination, so nothing can be priced against it' },
      { status: 409 },
    );
  }

  const result = await prepareUnlock({
    sender: b.sender, vaultId: b.vaultId, coinType: profile.coinType,
    contentKey: b.contentKey, expectedPrice: b.expectedPrice,
  });
  return fold<UnlockQuote | { blocked: SubscribeBlocker }, NextResponse>(
    result,
    (v) => ('blocked' in v ? NextResponse.json({ blocked: v.blocked }) : NextResponse.json({ quote: v })),
    (f) => NextResponse.json({ error: f.detail, kind: f.kind }, { status: 422 }),
  );
}
