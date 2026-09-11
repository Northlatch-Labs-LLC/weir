// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { simulateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { prepareNamePurchase, type NamePurchaseQuote } from '@/lib/names-purchase';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const limited = await simulateLimit(request);
  if (limited !== null) return limited;

  const body = (await request.json()) as {
    sender?: string;
    label?: string;
    years?: number;
  };

  if (!body.sender || !body.label) {
    return NextResponse.json({ error: 'sender and label are required' }, { status: 400 });
  }

  const quote = await prepareNamePurchase({
    sender: body.sender,
    label: body.label,
    years: body.years ?? 1,
  });

  return fold<NamePurchaseQuote, NextResponse>(
    quote,
    (value) => NextResponse.json({ quote: value }),
    (failure) =>
      NextResponse.json(
        { error: failure.detail, kind: failure.kind },
        { status: failure.kind === 'unconfigured' ? 503 : 400 },
      ),
  );
}
