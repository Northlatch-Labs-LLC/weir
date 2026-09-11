// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { simulateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { findCreatorCaps, prepareSetContentPrice, type CheckoutQuote } from '@/lib/checkout';
import { normaliseAddress } from '@/lib/db';
import { machineBodyState } from '@/lib/content';
import { NO_MACHINE_BODY, humanContentKey, isMachineContentKey } from '@/lib/machine-pricing';

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

  if (isMachineContentKey(b.contentKey)) {
    const human = humanContentKey(b.contentKey);
    if (!human.ok) {
      return NextResponse.json({ error: human.failure.detail, kind: 'reserved' }, { status: 400 });
    }
    const state = await machineBodyState(b.vaultId, human.value);
    if (state === 'absent') {
      return NextResponse.json(
        { error: `"${human.value}" ${NO_MACHINE_BODY}`, kind: 'no-machine-body', machineBody: state },
        { status: 409 },
      );
    }
  }

  const caps = await findCreatorCaps(b.sender);
  if (!caps.ok) return NextResponse.json({ error: caps.failure.detail }, { status: 503 });

  const capId = caps.value.get(normaliseAddress(b.vaultId));
  if (capId === undefined) {
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
