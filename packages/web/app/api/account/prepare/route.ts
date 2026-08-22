// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { prepareOpenAccount, type CheckoutQuote } from '@/lib/checkout';

export const dynamic = 'force-dynamic';

/**
 * Build and simulate opening an account, without signing it.
 *
 * The same gate as every other transaction here. It matters especially at registration, because
 * this is the first thing a user ever signs: `open` aborts if the handle was taken in the seconds
 * since it was checked, if the address already has an account, or if the platform has creation
 * paused — and an abort code is a poor introduction to a product.
 *
 * Submission goes through `/api/checkout/submit`, which returns the bytes unchanged.
 */
export async function POST(request: Request) {
  const limited = rateLimit(request, 'simulate');
  if (limited !== null) return limited;

  const body = (await request.json()) as {
    sender?: string;
    handle?: string;
    referrer?: string | null;
  };

  if (!body.sender || !body.handle) {
    return NextResponse.json({ error: 'sender and handle are required' }, { status: 400 });
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
