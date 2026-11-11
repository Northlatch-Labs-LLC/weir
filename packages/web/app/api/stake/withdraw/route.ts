// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { simulateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { prepareWithdrawStake, type CheckoutQuote } from '@/lib/checkout';
import { recordFailure } from '@/lib/error-log';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {try {
  const limited = await simulateLimit(request);
  if (limited !== null) return limited;

  const body = (await request.json()) as Record<string, string | undefined>;

  const missing = ['sender', 'vaultId', 'accountId', 'amountMist'].filter(
    (key) => body[key] === undefined || body[key] === '',
  );
  if (missing.length > 0) {
    return NextResponse.json({ error: `missing: ${missing.join(', ')}` }, { status: 400 });
  }

  return fold<CheckoutQuote, NextResponse>(
    await prepareWithdrawStake(body as never),
    (quote) => NextResponse.json({ quote }),
    (failure) =>
      NextResponse.json({ error: failure.detail, kind: failure.kind }, { status: 400 }),
  );
} catch (error) {
  await recordFailure({
    source: 'api route',
    detail: error instanceof Error ? error.message : String(error),
    route: '/api/stake/withdraw',
  });
  return NextResponse.json({ error: 'this failed; the cause is recorded' }, { status: 500 });
}}
