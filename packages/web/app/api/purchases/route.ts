// Built-by: @projectx.sui · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { createClient, fold, readDecimals } from '@projectx-social/sdk';
import { siteConfig } from '@/lib/chain';
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

  const purchases = await readPurchases(buyer);

  /*
    Decimals per coin, once per distinct coin type on this receipt, from the coin's own metadata.
    A receipt used to scale every amount as USDC; a SUI vault's purchase read a thousand times too
    large. An unreadable coin is `decimals: null` and the page says "not measured" — never a guess.
  */
  const decimalsOf = new Map<string, number | null>();
  if (purchases.ok) {
    const config = siteConfig();
    const client = config.ok ? createClient(config.value) : null;
    const coins = new Set(
      [...purchases.value.subscriptions, ...purchases.value.unlocks].map((r) => r.coinType).filter((c): c is string => c !== null),
    );
    for (const coinType of coins) {
      const read = client === null ? null : await readDecimals(client, coinType);
      decimalsOf.set(coinType, read !== null && read.ok ? read.value : null);
    }
  }
  const coinFields = (coinType: string | null) => ({
    coinType,
    decimals: coinType === null ? null : (decimalsOf.get(coinType) ?? null),
    symbol: coinType === null ? null : (coinType.split('::').pop() ?? null),
  });

  return fold<Purchases, NextResponse>(
    purchases,
    (p) =>
      NextResponse.json({
        // bigint out as strings: JSON.stringify throws on one, and Number() above 2^53 loses
        // precision silently — for large amounts only, the worst possible schedule.
        // `decimals` per row, from the coin's own metadata; null when unread, never a guess.
        subscriptions: p.subscriptions.map((s) => ({ ...s, pricePaid: s.pricePaid.toString(), ...coinFields(s.coinType) })),
        unlocks: p.unlocks.map((u) => ({ ...u, pricePaid: u.pricePaid.toString(), ...coinFields(u.coinType) })),
        truncated: p.truncated,
      }),
    (failure) => NextResponse.json({ error: failure.detail, kind: failure.kind }, { status: 424 }),
  );
}
