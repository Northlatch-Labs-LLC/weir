// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { reverseName } from '@/lib/names';

export const dynamic = 'force-dynamic';

const SUI_ADDRESS = /^0x[0-9a-fA-F]{1,64}$/;

/**
 * The `.sui` name an address answers to, or `null` when it has set none.
 *
 * A failure is reported as one rather than as "no name", because the caller renders those
 * differently: no name means show the address, and a failed lookup means show the address *and*
 * keep the possibility of a name open on the next read.
 */
export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const address = new URL(request.url).searchParams.get('address');
  if (address === null || !SUI_ADDRESS.test(address)) {
    return NextResponse.json({ error: 'address must be a Sui address' }, { status: 400 });
  }

  return fold<string | null, NextResponse>(
    await reverseName(address),
    (name) => NextResponse.json({ name }),
    (failure) => NextResponse.json({ error: failure.detail, kind: failure.kind }, { status: 502 }),
  );
}
