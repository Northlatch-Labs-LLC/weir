// Built-by: @projectx.sui · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { simulateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { prepareKeyPublish, type CheckoutQuote } from '@/lib/checkout';

export const dynamic = 'force-dynamic';

/**
 * Build and simulate a key publication, without signing it.
 *
 * Publishing an encryption key is now a transaction, so it goes through the same gate as every
 * other transaction in this application: build, simulate, quote, and only then offer to sign. The
 * confirming action does not exist until the simulation has passed.
 *
 * That matters more here than it looks. The contract refuses a key that is not 32 bytes or is all
 * zeros, and a user who signs a doomed transaction still pays for the abort. The simulation turns
 * that into a message before any money moves.
 *
 * Submission goes through `/api/checkout/submit`, which takes the bytes back unchanged — so what
 * executes is byte-identical to what was simulated and to what the wallet displayed.
 */
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
