// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { prepareSubscribe, type SubscribeBlocker, type SubscribeQuote } from '@/lib/checkout';

export const dynamic = 'force-dynamic';

/**
 * Build and simulate a subscription. Never signs, never submits.
 *
 * A "blocked" response is a 200: it is a real, measured answer about the buyer's situation, not a
 * fault. Returning 4xx for "you have no USDC" would make an ordinary state look like an error and
 * bury it among transport failures.
 */
export async function POST(request: Request) {
  const limited = rateLimit(request, 'simulate');
  if (limited !== null) return limited;

  const body = (await request.json()) as {
    sender?: string;
    vaultId?: string;
    coinType?: string;
    tierIndex?: number;
  };

  if (!body.sender || !body.vaultId || !body.coinType || body.tierIndex === undefined) {
    return NextResponse.json(
      { error: 'sender, vaultId, coinType and tierIndex are required' },
      { status: 400 },
    );
  }

  const result = await prepareSubscribe({
    sender: body.sender,
    vaultId: body.vaultId,
    coinType: body.coinType,
    tierIndex: body.tierIndex,
  });

  return fold<SubscribeQuote | { blocked: SubscribeBlocker }, NextResponse>(
    result,
    (value) =>
      'blocked' in value
        ? NextResponse.json({ blocked: value.blocked })
        : NextResponse.json({ quote: value }),
    (failure) => NextResponse.json({ error: failure.detail, kind: failure.kind }, { status: 422 }),
  );
}
