// Built-by: @projectx.sui · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { simulateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { prepareNamePurchase, type NamePurchaseQuote } from '@/lib/names-purchase';

export const dynamic = 'force-dynamic';

/**
 * Build and simulate a verified registration, without signing it.
 *
 * The same gate as every other transaction here, and the one place it carries the most weight: this
 * quote covers a real purchase rather than only gas, and it is the first thing a new user signs.
 *
 * Submission goes through `/api/checkout/submit`, which returns the bytes unchanged. They are never
 * rebuilt between simulating and signing — a rebuilt transaction is a different transaction, and
 * the signature would then be over something nobody was shown.
 */
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
    // One year unless asked otherwise. `quoteNamePurchase` rejects anything outside 1–5 rather than
    // clamping it: a silently corrected term is a different price from the one requested.
    years: body.years ?? 1,
  });

  return fold<NamePurchaseQuote, NextResponse>(
    quote,
    (value) => NextResponse.json({ quote: value }),
    (failure) =>
      NextResponse.json(
        { error: failure.detail, kind: failure.kind },
        // `unconfigured` is the deployment's fault, not the caller's — a paused registrar or a
        // missing package id is a 503. Returning 400 would send them to correct input that was
        // never wrong.
        { status: failure.kind === 'unconfigured' ? 503 : 400 },
      ),
  );
}
