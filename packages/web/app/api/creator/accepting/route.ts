// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { simulateLimit } from '@/lib/rate-limit';
import { fold } from '@projectx-social/sdk';
import { prepareSetAccepting, type CheckoutQuote } from '@/lib/checkout';

export const dynamic = 'force-dynamic';

/**
 * Build and simulate closing a creator vault to new payments, or reopening it.
 *
 * # Why a vault is closed rather than deleted
 *
 * `creator.move` has no destroy, close or delete, and should not: a `CreatorVault` is shared, and
 * the subscriptions and unlocks already sold point at it. Removing it would orphan things people
 * paid for. Retiring a page therefore means refusing new money, which is what this does.
 *
 * The application could open a vault and had no way to close one — so a creator who stopped
 * publishing left a page that kept taking subscriptions.
 *
 * # Nothing here decides authority
 *
 * The capability does, on chain. This builds a transaction naming the `CreatorCap` and asks the
 * node; `assert_cap` aborts if the sender does not hold the one that governs that vault. The
 * simulation is the check, and it is the same code that runs at execution.
 */
export async function POST(request: Request) {
  const limited = await simulateLimit(request);
  if (limited !== null) return limited;

  const b = (await request.json()) as {
    sender?: string; vaultId?: string; capId?: string; coinType?: string; accepting?: boolean;
  };
  if (!b.sender || !b.vaultId || !b.capId || !b.coinType || typeof b.accepting !== 'boolean') {
    return NextResponse.json(
      { error: 'sender, vaultId, capId, coinType and accepting are required' },
      { status: 400 },
    );
  }

  return fold<CheckoutQuote, NextResponse>(
    await prepareSetAccepting({
      sender: b.sender, vaultId: b.vaultId, capId: b.capId, coinType: b.coinType,
      accepting: b.accepting,
    }),
    (quote) => NextResponse.json({ quote }),
    (failure) => NextResponse.json({ error: failure.detail, kind: failure.kind }, { status: 400 }),
  );
}
