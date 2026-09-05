// Built-by: @projectx.sui · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { readEarnings, type CreatorEarnings } from '@/lib/earnings';

export const dynamic = 'force-dynamic';

const SUI_ADDRESS = /^(0x)?[0-9a-fA-F]{1,64}$/;

/**
 * What this address has earned and can withdraw.
 *
 * Read from the vault objects on chain, never totalled from the content store. A failure is
 * reported as a failure: a creator shown a zero balance because a node was unreachable would
 * reasonably conclude nobody had paid them.
 *
 * `bigint` values leave as strings. `JSON.stringify` throws on a bigint, and `Number()` above 2^53
 * loses precision silently — for large balances only, which is the worst possible schedule for a
 * rounding error in somebody's earnings.
 */
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
          // Sent so the client formats with the coin's own scale rather than assuming one. Not a
          // string: it is a small integer, not an amount, and amounts are the things that must
          // never become numbers.
          decimals: v.decimals,
          capId: v.capId,
        })),
      }),
    (failure) => NextResponse.json({ error: failure.detail, kind: failure.kind }, { status: 424 }),
  );
}
