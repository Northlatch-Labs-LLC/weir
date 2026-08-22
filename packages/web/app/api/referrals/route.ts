// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { readReferrals, type ReferralEarnings } from '@/lib/referrals';

export const dynamic = 'force-dynamic';

const SUI_ADDRESS = /^(0x)?[0-9a-fA-F]{1,64}$/;

/** Who this address referred and what it has been paid, both from chain events. */
export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const address = new URL(request.url).searchParams.get('address');
  if (address === null || !SUI_ADDRESS.test(address)) {
    return NextResponse.json({ error: 'address must be a Sui address' }, { status: 400 });
  }

  return fold<ReferralEarnings, NextResponse>(
    await readReferrals(address),
    (r) => NextResponse.json({ ...r, earned: r.earned.toString() }),
    (failure) => NextResponse.json({ error: failure.detail, kind: failure.kind }, { status: 502 }),
  );
}
