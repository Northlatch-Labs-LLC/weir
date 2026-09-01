// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { simulateLimit } from '@/lib/rate-limit';
import { isSuiId } from '@/lib/db';
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

  /*
    Both addresses are shape-checked, and `referrer` is the one that matters.

    `referrer` decides who receives the referral share of this account's fee, so it is a
    revenue-bearing field arriving from a request body. Passing it on unchecked means a malformed
    value reaches transaction construction, where the failure is a build error describing a Move
    argument rather than a caller describing a bad address — and the caller is the only one who can
    fix it.

    `null` stays valid and means no referrer, which is the ordinary case. Only a value that is
    present and not an address is refused.
  */
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
