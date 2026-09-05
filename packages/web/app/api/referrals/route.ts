// Built-by: @projectx.sui · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { createClient, readDecimals } from '@projectx-social/sdk';
import { siteConfig } from '@/lib/chain';
import { findProfileByVault } from '@/lib/content';
import { readReferrals } from '@/lib/referrals';

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

  const referrals = await readReferrals(address);
  if (!referrals.ok) {
    return NextResponse.json(
      { error: referrals.failure.detail, kind: referrals.failure.kind },
      { status: 424 },
    );
  }
  const r = referrals.value;

  /*
    `earnedByVault` is raw integers per vault. A vault denominated in SUI and one in USDC do not
    share a scale, so they cannot be summed until each is grouped by its own coin's decimals — the
    same bug this shape once had that `readEarnings` and `readPurchases` already fixed: formatting
    every vault's cut as USDC read a SUI-vault referral a thousand times off.

    The coin type per vault comes from the content store's profile row, the same join
    `chests-data.tsx` does for `readChestPots`'s `byVault`. A vault with no named profile (not yet
    published, or the store could not be read) is grouped under `coinType: null` and shown as
    unmeasured rather than guessed.
  */
  const config = siteConfig();
  const client = config.ok ? createClient(config.value) : null;
  const decimalsByCoin = new Map<string, number | null>();

  const totals = new Map<string, { coinType: string | null; symbol: string | null; decimals: number | null; amount: bigint }>();
  for (const [vaultId, cut] of r.earnedByVault) {
    const profile = await findProfileByVault(vaultId);
    const coinType = profile?.coinType ?? null;

    let decimals: number | null = null;
    if (coinType !== null) {
      let cached = decimalsByCoin.get(coinType);
      if (cached === undefined) {
        const read = client === null ? null : await readDecimals(client, coinType);
        cached = read !== null && read.ok ? read.value : null;
        decimalsByCoin.set(coinType, cached);
      }
      decimals = cached;
    }

    const key = coinType ?? '__unknown__';
    const existing = totals.get(key);
    if (existing === undefined) {
      totals.set(key, {
        coinType,
        symbol: coinType === null ? null : (coinType.split('::').pop() ?? null),
        decimals,
        amount: cut,
      });
    } else {
      existing.amount += cut;
    }
  }

  return NextResponse.json({
    referred: r.referred,
    earned: [...totals.values()].map((t) => ({ ...t, amount: t.amount.toString() })),
    payments: r.payments,
    truncated: r.truncated,
  });
}
