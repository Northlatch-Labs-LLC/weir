// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { simulateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { prepareClaimRebate, type CheckoutQuote } from '@/lib/checkout';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const limited = await simulateLimit(request);
  if (limited !== null) return limited;

  const body = (await request.json()) as Record<string, string | undefined>;

  const missing = ['sender', 'vaultId', 'accountId'].filter(
    (key) => body[key] === undefined || body[key] === '',
  );
  if (missing.length > 0) {
    return NextResponse.json({ error: `missing: ${missing.join(', ')}` }, { status: 400 });
  }

  return fold<CheckoutQuote, NextResponse>(
    await prepareClaimRebate(body as never),
    (quote) => NextResponse.json({ quote }),
    (failure) =>
      NextResponse.json({ error: failure.detail, kind: failure.kind }, { status: 400 }),
  );
}
