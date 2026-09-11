// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { createClient, fold, readDecimals } from '@projectx-social/sdk';
import { siteConfig } from '@/lib/chain';
import { readPurchases, type Purchases } from '@/lib/purchases';

export const dynamic = 'force-dynamic';

const SUI_ADDRESS = /^(0x)?[0-9a-fA-F]{1,64}$/;

export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const buyer = new URL(request.url).searchParams.get('buyer');
  if (buyer === null || !SUI_ADDRESS.test(buyer)) {
    return NextResponse.json({ error: 'buyer must be a Sui address' }, { status: 400 });
  }

  const purchases = await readPurchases(buyer);

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
        subscriptions: p.subscriptions.map((s) => ({ ...s, pricePaid: s.pricePaid.toString(), ...coinFields(s.coinType) })),
        unlocks: p.unlocks.map((u) => ({ ...u, pricePaid: u.pricePaid.toString(), ...coinFields(u.coinType) })),
        truncated: p.truncated,
      }),
    (failure) => NextResponse.json({ error: failure.detail, kind: failure.kind }, { status: 424 }),
  );
}
