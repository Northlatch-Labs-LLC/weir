// Built-by: @projectx.sui · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { simulateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { prepareSetRebate, type CheckoutQuote } from '@/lib/checkout';

export const dynamic = 'force-dynamic';

/**
 * Set the supporters' share of yield, out of the creator's own share.
 *
 * Builds and simulates only. Submission goes through `/api/checkout/submit`, which returns the
 * bytes unchanged — so what executes is byte-identical to what was simulated and to what the
 * wallet displayed. There is no path here that both builds and submits.
 */
export async function POST(request: Request) {
  const limited = await simulateLimit(request);
  if (limited !== null) return limited;

  const body = (await request.json()) as Record<string, string | undefined>;

  // Named individually rather than checked as a group, so the message says which one is missing.
  const missing = ['sender', 'vaultId', 'capId', 'rebateBps'].filter(
    (key) => body[key] === undefined || body[key] === '',
  );
  if (missing.length > 0) {
    return NextResponse.json({ error: `missing: ${missing.join(', ')}` }, { status: 400 });
  }

  return fold<CheckoutQuote, NextResponse>(
    await prepareSetRebate(body as never),
    (quote) => NextResponse.json({ quote }),
    (failure) =>
      NextResponse.json({ error: failure.detail, kind: failure.kind }, { status: 400 }),
  );
}
