// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { simulateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { prepareKeyPublish, type CheckoutQuote } from '@/lib/checkout';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const limited = await simulateLimit(request);
  if (limited !== null) return limited;

  const body = (await request.json()) as { sender?: string; x25519Public?: string };
  if (!body.sender || !body.x25519Public) {
    return NextResponse.json(
      { error: 'sender and x25519Public are required' },
      { status: 400 },
    );
  }

  const quote = await prepareKeyPublish({
    sender: body.sender,
    x25519PublicBase64: body.x25519Public,
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
