// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { submitSigned } from '@/lib/checkout';

export const dynamic = 'force-dynamic';

/**
 * Execute bytes the wallet signed.
 *
 * Deliberately cannot build a transaction. It submits what it is given, which is what was
 * simulated and what the wallet displayed — there is no path here that constructs something new.
 */
export async function POST(request: Request) {
  const limited = rateLimit(request, 'simulate');
  if (limited !== null) return limited;

  const body = (await request.json()) as { bytes?: string; signature?: string };
  if (!body.bytes || !body.signature) {
    return NextResponse.json({ error: 'bytes and signature are required' }, { status: 400 });
  }

  const result = await submitSigned({ bytes: body.bytes, signature: body.signature });
  return fold<string, NextResponse>(
    result,
    (digest) => NextResponse.json({ digest }),
    (failure) => NextResponse.json({ error: failure.detail, kind: failure.kind }, { status: 424 }),
  );
}
