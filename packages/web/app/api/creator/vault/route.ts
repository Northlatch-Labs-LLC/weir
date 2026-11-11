// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { simulateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { prepareOpenVault, type CheckoutQuote } from '@/lib/checkout';
import { recordFailure } from '@/lib/error-log';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {try {
  const limited = await simulateLimit(request);
  if (limited !== null) return limited;

  const b = (await request.json()) as {
    sender?: string; accountId?: string; coinType?: string; creationFeeMist?: string;
  };
  if (!b.sender || !b.accountId || !b.coinType || b.creationFeeMist === undefined) {
    return NextResponse.json(
      { error: 'sender, accountId, coinType and creationFeeMist are required' },
      { status: 400 },
    );
  }

  return fold<CheckoutQuote, NextResponse>(
    await prepareOpenVault({
      sender: b.sender, accountId: b.accountId, coinType: b.coinType,
      creationFeeMist: b.creationFeeMist,
    }),
    (quote) => NextResponse.json({ quote }),
    (failure) => NextResponse.json({ error: failure.detail, kind: failure.kind }, { status: 400 }),
  );
} catch (error) {
  await recordFailure({
    source: 'api route',
    detail: error instanceof Error ? error.message : String(error),
    route: '/api/creator/vault',
  });
  return NextResponse.json({ error: 'this failed; the cause is recorded' }, { status: 500 });
}}
