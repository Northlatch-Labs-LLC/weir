// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { readPurchases, type Purchases } from '@/lib/purchases';

export const dynamic = 'force-dynamic';

const SUI_ADDRESS = /^(0x)?[0-9a-fA-F]{1,64}$/;

/**
 * What this address has bought.
 *
 * Read from the Subscription and Unlock objects the buyer owns. There is no orders table here, and
 * that is the point: those objects cannot be revoked by this platform, edited by it, or lost when
 * it is. The receipt is read from the thing that makes the claim true.
 *
 * Naming an address grants nothing — the objects are public and their contents are the buyer's
 * receipt, not their secret. Nothing is released by this route that entitlement does not already
 * decide independently.
 */
export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const buyer = new URL(request.url).searchParams.get('buyer');
  if (buyer === null || !SUI_ADDRESS.test(buyer)) {
    return NextResponse.json({ error: 'buyer must be a Sui address' }, { status: 400 });
  }

  return fold<Purchases, NextResponse>(
    await readPurchases(buyer),
    (p) =>
      NextResponse.json({
        // bigint out as strings: JSON.stringify throws on one, and Number() above 2^53 loses
        // precision silently — for large amounts only, the worst possible schedule.
        subscriptions: p.subscriptions.map((s) => ({ ...s, pricePaid: s.pricePaid.toString() })),
        unlocks: p.unlocks.map((u) => ({ ...u, pricePaid: u.pricePaid.toString() })),
        truncated: p.truncated,
      }),
    (failure) => NextResponse.json({ error: failure.detail, kind: failure.kind }, { status: 502 }),
  );
}
