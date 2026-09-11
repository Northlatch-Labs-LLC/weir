// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { simulateLimit } from '@/lib/rate-limit';
import { isSuiId } from '@/lib/db';
import { fold } from '@projectx-social/sdk';
import { prepareOpenAccount, type CheckoutQuote } from '@/lib/checkout';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const limited = await simulateLimit(request);
  if (limited !== null) return limited;

  const body = (await request.json()) as {
    sender?: string;
    handle?: string;
    referrer?: string | null;
  };

  if (!body.sender || !body.handle) {
    return NextResponse.json({ error: 'sender and handle are required' }, { status: 400 });
  }

  if (!isSuiId(body.sender)) {
    return NextResponse.json(
      { error: 'sender must be 0x followed by hex digits' },
      { status: 400 },
    );
  }
  if (body.referrer !== null && body.referrer !== undefined && !isSuiId(body.referrer)) {
    return NextResponse.json(
      { error: 'referrer must be 0x followed by hex digits, or omitted' },
      { status: 400 },
    );
  }

  const quote = await prepareOpenAccount({
    sender: body.sender,
    handle: body.handle,
    referrer: body.referrer ?? null,
  });

  return fold<CheckoutQuote, NextResponse>(
    quote,
    (value) => NextResponse.json({ quote: value }),
    (failure) =>
      NextResponse.json(
        { error: failure.detail, kind: failure.kind },
        { status: failure.kind === 'unconfigured' ? 503 : 400 },
      ),
  );
}
