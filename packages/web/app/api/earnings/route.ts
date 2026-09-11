// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { readEarnings, type CreatorEarnings } from '@/lib/earnings';

export const dynamic = 'force-dynamic';

const SUI_ADDRESS = /^(0x)?[0-9a-fA-F]{1,64}$/;

export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const owner = new URL(request.url).searchParams.get('owner');
  if (owner === null || !SUI_ADDRESS.test(owner)) {
    return NextResponse.json({ error: 'owner must be a Sui address' }, { status: 400 });
  }

  return fold<CreatorEarnings[], NextResponse>(
    await readEarnings(owner),
    (vaults) =>
      NextResponse.json({
        vaults: vaults.map((v) => ({
          handle: v.handle,
          vaultId: v.vaultId,
          coinType: v.coinType,
          earnings: v.earnings.toString(),
          grossVolume: v.grossVolume.toString(),
          platformFees: v.platformFees.toString(),
          subscriptionsSold: v.subscriptionsSold.toString(),
          feeBpsSnapshot: v.feeBpsSnapshot.toString(),
          decimals: v.decimals,
          capId: v.capId,
        })),
      }),
    (failure) => NextResponse.json({ error: failure.detail, kind: failure.kind }, { status: 424 }),
  );
}
