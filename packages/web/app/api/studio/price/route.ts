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

  /*
    The cap that governs *this* vault, not whichever one came back first.

    A `CreatorCap` carries the id of the single vault it governs and `assert_cap` checks it, so a
    creator with two vaults holds two caps. `findCreatorCap` returns the first and is correct only
    for a single-vault creator; this route then built a quote pairing that cap with a `vaultId` taken
    from the request. The chain aborts, so nothing could be stolen — but a two-vault creator paid gas
    for a transaction that could never succeed, and the failure named neither the cap nor the vault.
  */
  /*
    The guard: a machine edition is priced only where it can be delivered.

    A machine key is `<key>#machine`, derived by the composer from the human key. Pricing it makes
    `creator::unlock` mint an `Unlock` for that identity, and an `Unlock` cannot be withdrawn — so
    before a quote is built, the posts under the human key are asked whether they carry a machine
    body. Three answers: nothing published yet (allowed; publish seals both), every sealed post
    carries one (allowed), or at least one was sealed before migration 034 and never for machines
    (refused, 409, naming why). Before the cap lookup and the simulation: a refusal should cost
    nothing on chain.
  */
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
