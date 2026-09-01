// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { simulateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { findCreatorCaps, prepareSetContentPrice, type CheckoutQuote } from '@/lib/checkout';
import { normaliseAddress } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const limited = await simulateLimit(request);
  if (limited !== null) return limited;

  const b = (await request.json()) as {
    sender?: string; vaultId?: string; coinType?: string; contentKey?: string; price?: string;
  };
  if (!b.sender || !b.vaultId || !b.coinType || !b.contentKey || !b.price) {
    return NextResponse.json(
      { error: 'sender, vaultId, coinType, contentKey and price are required' },
      { status: 400 },
    );
  }

  /*
    The cap that governs *this* vault, not whichever one came back first.

    A `CreatorCap` carries the id of the single vault it governs and `assert_cap` checks it, so a
    creator with two vaults holds two caps. `findCreatorCap` returns the first and is correct only
    for a single-vault creator; this route then built a quote pairing that cap with a `vaultId` taken
    from the request. The chain aborts, so nothing could be stolen — but a two-vault creator paid gas
    for a transaction that could never succeed, and the failure named neither the cap nor the vault.
  */
  const caps = await findCreatorCaps(b.sender);
  if (!caps.ok) return NextResponse.json({ error: caps.failure.detail }, { status: 503 });

  const capId = caps.value.get(normaliseAddress(b.vaultId));
  if (capId === undefined) {
    // A real answer: this wallet holds no capability over the vault it named.
    return NextResponse.json({ blocked: 'no-creator-cap' });
  }

  const quote = await prepareSetContentPrice({
    sender: b.sender, vaultId: b.vaultId, capId,
    coinType: b.coinType, contentKey: b.contentKey, price: b.price,
  });
  return fold<CheckoutQuote, NextResponse>(
    quote,
    (v) => NextResponse.json({ quote: v }),
    (f) => NextResponse.json({ error: f.detail, kind: f.kind }, { status: 422 }),
  );
}
